import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'argon2';
import type { users } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, MENSAJE_CREDENCIALES_INVALIDAS } from './auth.service';

type UsuarioDePrueba = users;

const CONTRASENA_VALIDA = 'Admin123!';

type ConsultaPrisma = { where: object; select: object };

interface PrismaMock {
  users: {
    findFirst: jest.Mock<Promise<users | null>, [ConsultaPrisma]>;
    update: jest.Mock<Promise<unknown>, [{ where: object; data: object }]>;
  };
}

interface JwtMock {
  signAsync: jest.Mock<
    Promise<string>,
    [payload: object, opciones?: { secret?: string; expiresIn?: number }]
  >;
  verifyAsync: jest.Mock<
    Promise<{ id: string }>,
    [token: string, opciones: { secret: string }]
  >;
}

interface ConfigMock {
  getOrThrow: jest.Mock<string, [clave: string]>;
  get: jest.Mock<string | undefined, [clave: string]>;
}

async function crearUsuarioDePrueba(
  sobrescrituras: Partial<UsuarioDePrueba> = {},
): Promise<UsuarioDePrueba> {
  return {
    id: BigInt(1),
    organization_id: null,
    role: 'admin',
    username: 'admin',
    email: 'admin@educoins.test',
    password_hash: await hash(CONTRASENA_VALIDA),
    must_change_password: true,
    first_name: 'Ada',
    last_name: 'Admin',
    specialty: null,
    is_active: true,
    last_login: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...sobrescrituras,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: PrismaMock;
  let jwtService: JwtMock;
  let valoresConfig: Record<string, string>;
  let configService: ConfigMock;

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn<Promise<users | null>, [ConsultaPrisma]>(),
        update: jest.fn<Promise<unknown>, [{ where: object; data: object }]>(),
      },
    };
    jwtService = {
      signAsync: jest.fn<
        Promise<string>,
        [payload: object, opciones?: { secret?: string; expiresIn?: number }]
      >(),
      verifyAsync: jest.fn<
        Promise<{ id: string }>,
        [token: string, opciones: { secret: string }]
      >(),
    };
    valoresConfig = {
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'secreto-refresh-de-pruebas-12345678',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    configService = {
      getOrThrow: jest.fn<string, [string]>((clave: string) => {
        const valor = valoresConfig[clave];
        if (valor === undefined) {
          throw new Error(`Variable no configurada: ${clave}`);
        }
        return valor;
      }),
      get: jest.fn<string | undefined, [string]>(
        (clave: string) => valoresConfig[clave],
      ),
    };
    authService = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
    jwtService.signAsync.mockImplementation(
      async (
        _payload: object,
        opciones?: { secret?: string; expiresIn?: number },
      ) =>
        opciones?.secret ? 'refresh-token-firmado' : 'access-token-firmado',
    );
  });

  describe('validarUsuario', () => {
    it('autentica por nombre de usuario y actualiza last_login', async () => {
      const usuario = await crearUsuarioDePrueba();
      prisma.users.findFirst.mockResolvedValue(usuario);

      const resultado = await authService.validarUsuario(
        'admin',
        CONTRASENA_VALIDA,
      );

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ username: 'admin' }, { email: 'admin' }] },
        select: expect.any(Object),
      });
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(1) },
        data: { last_login: expect.any(Date) },
      });
      expect(resultado).toEqual({
        id: '1',
        username: 'admin',
        email: 'admin@educoins.test',
        role: 'admin',
        nombre: 'Ada',
        apellido: 'Admin',
        organizacionId: null,
        debeCambiarContrasena: true,
      });
      expect(resultado).not.toHaveProperty('password_hash');
    });

    it('busca por correo electrónico como alternativa al usuario', async () => {
      const usuario = await crearUsuarioDePrueba();
      prisma.users.findFirst.mockResolvedValue(usuario);

      await authService.validarUsuario(
        'admin@educoins.test',
        CONTRASENA_VALIDA,
      );

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { username: 'admin@educoins.test' },
            { email: 'admin@educoins.test' },
          ],
        },
        select: expect.any(Object),
      });
    });

    it('rechaza con 401 genérico cuando la contraseña es incorrecta', async () => {
      const usuario = await crearUsuarioDePrueba();
      prisma.users.findFirst.mockResolvedValue(usuario);

      await expect(
        authService.validarUsuario('admin', 'ContrasenaIncorrecta!'),
      ).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('devuelve EXACTAMENTE el mismo mensaje cuando el usuario no existe', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        authService.validarUsuario('fantasma', CONTRASENA_VALIDA),
      ).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
    });

    it('devuelve el mismo mensaje genérico cuando la cuenta está inactiva', async () => {
      const usuario = await crearUsuarioDePrueba({ is_active: false });
      prisma.users.findFirst.mockResolvedValue(usuario);

      await expect(
        authService.validarUsuario('admin', CONTRASENA_VALIDA),
      ).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('trata un hash corrupto (placeholder del seed) como credencial inválida, no como 500', async () => {
      const usuario = await crearUsuarioDePrueba({
        password_hash: 'HASH_ADMIN',
      });
      prisma.users.findFirst.mockResolvedValue(usuario);

      await expect(
        authService.validarUsuario('admin', CONTRASENA_VALIDA),
      ).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
    });

    it('no consulta la BD si la entrada está vacía', async () => {
      await expect(
        authService.validarUsuario('', CONTRASENA_VALIDA),
      ).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
      await expect(authService.validarUsuario('admin', '')).rejects.toThrow(
        new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS),
      );
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('acepta mayúsculas y minúsculas (CITEXT) sin normalizar la consulta', async () => {
      const usuario = await crearUsuarioDePrueba();
      prisma.users.findFirst.mockResolvedValue(usuario);

      await authService.validarUsuario('ADMIN', CONTRASENA_VALIDA);

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ username: 'ADMIN' }, { email: 'ADMIN' }] },
        select: expect.any(Object),
      });
    });
  });

  describe('login', () => {
    it('firma access token corto y refresh token con secreto propio', async () => {
      const usuarioDto = {
        id: '1',
        username: 'admin',
        email: 'admin@educoins.test',
        role: 'admin' as const,
        nombre: 'Ada',
        apellido: 'Admin',
        organizacionId: null,
        debeCambiarContrasena: true,
      };

      const sesion = await authService.login(usuarioDto);

      expect(sesion).toEqual({
        accessToken: 'access-token-firmado',
        refreshToken: 'refresh-token-firmado',
        expiraEn: '15m',
        usuario: usuarioDto,
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        {
          id: '1',
          username: 'admin',
          role: 'admin',
          organizacionId: null,
          debeCambiarContrasena: true,
        },
        { expiresIn: 900 },
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { id: '1' },
        { secret: valoresConfig['JWT_REFRESH_SECRET'], expiresIn: 604800 },
      );
    });
  });

  describe('refrescar', () => {
    it('canjea un refresh token válido por una sesión nueva', async () => {
      const usuario = await crearUsuarioDePrueba();
      jwtService.verifyAsync.mockResolvedValue({ id: '1' });
      prisma.users.findFirst.mockResolvedValue(usuario);

      const sesion = await authService.refrescar('refresh-valido');

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('refresh-valido', {
        secret: valoresConfig['JWT_REFRESH_SECRET'],
      });
      expect(sesion.accessToken).toBe('access-token-firmado');
      expect(sesion.usuario.id).toBe('1');
      // El refresh NO es un login: no debe tocar last_login.
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('rechaza un refresh token inválido o expirado', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(authService.refrescar('refresh-invalido')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza si el usuario del refresh ya no existe o está inactivo', async () => {
      jwtService.verifyAsync.mockResolvedValue({ id: '99' });
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(authService.refrescar('refresh-valido')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('obtenerPerfil', () => {
    it('devuelve el usuario de la BD por el id del token', async () => {
      const usuario = await crearUsuarioDePrueba();
      prisma.users.findFirst.mockResolvedValue(usuario);

      const perfil = await authService.obtenerPerfil('1');

      expect(perfil.id).toBe('1');
      expect(perfil).not.toHaveProperty('password_hash');
    });

    it('rechaza ids no numéricos y usuarios inexistentes', async () => {
      await expect(authService.obtenerPerfil('no-soy-numero')).rejects.toThrow(
        UnauthorizedException,
      );
      prisma.users.findFirst.mockResolvedValue(null);
      await expect(authService.obtenerPerfil('99')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
