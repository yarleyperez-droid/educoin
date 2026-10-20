import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import type { user_role } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { MENSAJE_SESION_CERRADA } from '../../common/guards/jwt-auth.guard';
import { SesionesActivasService } from './sesiones-activas.service';
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
    private readonly sesiones: SesionesActivasService,
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

  /**
   * Firma el access token (vida corta) y el refresh token (cookie httpOnly).
   * Ambos viajan con un jti único y quedan REGISTRADOS en
   * SesionesActivasService: el guard global exige sesiones vivas, así que
   * todo token que no salga de aquí (o cuyo registro se haya borrado) está
   * muerto. Cubre también el refresh, que rota llamando a este método.
   */
  async login(usuario: UsuarioRespuestaDto): Promise<SesionInterna> {
    const expiraEn = this.configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    );
    const jtiAccess = randomUUID();
    const accessToken = await this.jwtService.signAsync(
      { ...this.aPayload(usuario), jti: jtiAccess },
      {
        expiresIn: expiracionASegundos(expiraEn),
      },
    );
    const refresh = await this.generarRefreshToken(usuario.id);
    this.sesiones.registrar(usuario.id, jtiAccess, refresh.jti);
    return { accessToken, refreshToken: refresh.token, expiraEn, usuario };
  }

  /**
   * Canjea el refresh token de la cookie por una sesión nueva (access token
   * nuevo y refresh rotado). El usuario debe seguir existiendo y activo.
   *
   * El refresh es de USO ÚNICO: su jti debe seguir registrado y se consume
   * en el mismo canje — una cookie ya usada (o revocada por un cambio de
   * credenciales, o tras un reinicio) responde 401.
   */
  async refrescar(refreshToken: string): Promise<SesionInterna> {
    const secretoRefresh =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    let payload: { id: string; jti?: string };
    try {
      payload = await this.jwtService.verifyAsync<{ id: string; jti?: string }>(
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

    if (
      payload.jti === undefined ||
      !this.sesiones.esValida(payload.id, payload.jti)
    ) {
      throw new UnauthorizedException(MENSAJE_SESION_CERRADA);
    }
    this.sesiones.consumir(payload.id, payload.jti);

    const usuario = await this.buscarUsuarioActivoPorId(payload.id);
    return this.login(usuario);
  }

  /**
   * Logout: consume la sesión del refresh token de la cookie para que el
   * token MUERA también en el servidor, no solo al expirar la cookie en
   * el navegador. Un token inválido/corrupto/expirado no lanza: no hay
   * sesión que revocar y el endpoint debe responder 204 igualmente.
   */
  async cerrarSesion(refreshToken: string): Promise<void> {
    try {
      const secretoRefresh =
        this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
      const payload = await this.jwtService.verifyAsync<{
        id: string;
        jti?: string;
      }>(refreshToken, { secret: secretoRefresh });
      if (payload.jti !== undefined) {
        this.sesiones.consumir(payload.id, payload.jti);
      }
    } catch {
      // Token corrupto, expirado o revocado: nada que consumir.
    }
  }

  /** Perfil fresco desde la BD para el usuario del token de acceso. */
  async obtenerPerfil(id: string): Promise<UsuarioRespuestaDto> {
    return this.buscarUsuarioActivoPorId(id);
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

  private async generarRefreshToken(
    id: string,
  ): Promise<{ token: string; jti: string }> {
    const secretoRefresh =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const expiraEn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const jti = randomUUID();
    const token = await this.jwtService.signAsync(
      { id, jti },
      {
        secret: secretoRefresh,
        expiresIn: expiracionASegundos(expiraEn),
      },
    );
    return { token, jti };
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
