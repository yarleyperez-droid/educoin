import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import type { user_role } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import type { UsuarioRespuestaDto } from './dto/sesion-respuesta.dto';
import { expiracionASegundos } from './cookies';

/** Mensaje 401 único para todo fallo de credenciales (evita enumerar usuarios). */
export const MENSAJE_CREDENCIALES_INVALIDAS =
  'El usuario o la contraseña son erróneos.';

export interface SesionInterna {
  accessToken: string;
  refreshToken: string;
  expiraEn: string;
  usuario: UsuarioRespuestaDto;
}

/** Campos leídos de la tabla users (AGENTS.md §5: nombres reales de la BD). */
interface UsuarioEncontrado {
  id: bigint;
  username: string;
  email: string;
  password_hash: string;
  role: user_role;
  first_name: string;
  last_name: string;
  organization_id: bigint | null;
  must_change_password: boolean;
  is_active: boolean;
}

const CAMPOS_USUARIO = {
  id: true,
  username: true,
  email: true,
  password_hash: true,
  role: true,
  first_name: true,
  last_name: true,
  organization_id: true,
  must_change_password: true,
  is_active: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Valida credenciales contra la tabla users. Busca por username O email
   * (CITEXT compara sin distinguir mayúsculas), verifica la contraseña con
   * argon2 y comprueba que la cuenta esté activa. Cualquier fallo produce
   * el mismo 401 genérico para no revelar si el usuario existe.
   */
  async validarUsuario(
    usuarioOEmail: string,
    contrasena: string,
  ): Promise<UsuarioRespuestaDto> {
    const entradaValida =
      typeof usuarioOEmail === 'string' &&
      usuarioOEmail.trim() !== '' &&
      typeof contrasena === 'string' &&
      contrasena !== '';
    if (!entradaValida) {
      throw new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS);
    }

    const usuario = await this.prisma.users.findFirst({
      where: { OR: [{ username: usuarioOEmail }, { email: usuarioOEmail }] },
      select: CAMPOS_USUARIO,
    });

    if (usuario === null || !usuario.is_active) {
      throw new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS);
    }

    let contrasenaValida: boolean;
    try {
      contrasenaValida = await verify(usuario.password_hash, contrasena);
    } catch {
      // Hash corrupto o con formato desconocido: se trata como credencial
      // inválida en lugar de derivar en un 500 que filtre detalles internos.
      contrasenaValida = false;
    }
    if (!contrasenaValida) {
      throw new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS);
    }

    await this.prisma.users.update({
      where: { id: usuario.id },
      data: { last_login: new Date() },
    });

    return this.aUsuarioRespuesta(usuario);
  }

  /** Firma el access token (vida corta) y el refresh token (cookie httpOnly). */
  async login(usuario: UsuarioRespuestaDto): Promise<SesionInterna> {
    const expiraEn = this.configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    );
    const accessToken = await this.jwtService.signAsync(
      this.aPayload(usuario),
      {
        expiresIn: expiracionASegundos(expiraEn),
      },
    );
    const refreshToken = await this.generarRefreshToken(usuario.id);
    return { accessToken, refreshToken, expiraEn, usuario };
  }

  /**
   * Canjea el refresh token de la cookie por una sesión nueva (access token
   * nuevo y refresh rotado). El usuario debe seguir existiendo y activo.
   */
  async refrescar(refreshToken: string): Promise<SesionInterna> {
    const secretoRefresh =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    let payload: { id: string };
    try {
      payload = await this.jwtService.verifyAsync<{ id: string }>(
        refreshToken,
        {
          secret: secretoRefresh,
        },
      );
    } catch {
      throw new UnauthorizedException(
        'Sesión expirada, inicia sesión nuevamente.',
      );
    }

    const usuario = await this.buscarUsuarioActivoPorId(payload.id);
    return this.login(usuario);
  }

  /** Perfil fresco desde la BD para el usuario del token de acceso. */
  async obtenerPerfil(id: string): Promise<UsuarioRespuestaDto> {
    return this.buscarUsuarioActivoPorId(id);
  }

  async cambiarContrasena(
    id: string,
    contrasenaActual: string,
    contrasenaNueva: string,
  ): Promise<void> {
    let idNumerico: bigint;

    try {
      idNumerico = BigInt(id);
    } catch {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    const usuario = await this.prisma.users.findFirst({
      where: {
        id: idNumerico,
        is_active: true,
      },
      select: {
        id: true,
        password_hash: true,
      },
    });

    if (!usuario) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    let contrasenaValida: boolean;

    try {
      contrasenaValida = await verify(usuario.password_hash, contrasenaActual);
    } catch {
      contrasenaValida = false;
    }

    if (!contrasenaValida) {
      throw new UnauthorizedException('La contraseña actual es incorrecta.');
    }

    const nuevoHash = await hash(contrasenaNueva);

    await this.prisma.users.update({
      where: { id: usuario.id },
      data: {
        password_hash: nuevoHash,
        must_change_password: false,
      },
    });
  }
  private async buscarUsuarioActivoPorId(
    id: string,
  ): Promise<UsuarioRespuestaDto> {
    let idNumerico: bigint;
    try {
      idNumerico = BigInt(id);
    } catch {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    const usuario = await this.prisma.users.findFirst({
      where: { id: idNumerico, is_active: true },
      select: CAMPOS_USUARIO,
    });

    if (usuario === null) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }
    return this.aUsuarioRespuesta(usuario);
  }

  private aPayload(usuario: UsuarioRespuestaDto): UsuarioAutenticado {
    return {
      id: usuario.id,
      username: usuario.username,
      role: usuario.role,
      organizacionId: usuario.organizacionId,
      debeCambiarContrasena: usuario.debeCambiarContrasena,
    };
  }

  private async generarRefreshToken(id: string): Promise<string> {
    const secretoRefresh =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const expiraEn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    return this.jwtService.signAsync(
      { id },
      {
        secret: secretoRefresh,
        expiresIn: expiracionASegundos(expiraEn),
      },
    );
  }

  private aUsuarioRespuesta(usuario: UsuarioEncontrado): UsuarioRespuestaDto {
    return {
      id: usuario.id.toString(),
      username: usuario.username,
      email: usuario.email,
      role: usuario.role,
      nombre: usuario.first_name,
      apellido: usuario.last_name,
      organizacionId:
        usuario.organization_id === null
          ? null
          : usuario.organization_id.toString(),
      debeCambiarContrasena: usuario.must_change_password,
    };
  }
}
