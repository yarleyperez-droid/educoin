import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'argon2';
import { Prisma } from '../../generated/prisma/client';
import { MENSAJE_SIN_ROL } from '../../common/guards/roles.guard';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../autorizacion/autorizacion.service';
import type { SesionesActivasService } from '../auth/sesiones-activas.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UsersService,
  MENSAJE_ACTUALIZACION_PERFIL_VACIA,
  MENSAJE_ACTUALIZACION_VACIA,
  MENSAJE_CONTRASENA_ACTUAL_INCORRECTA,
  MENSAJE_CORREO_DUPLICADO,
  MENSAJE_CORREO_ACTUAL_REQUERIDO,
  MENSAJE_CREDENCIALES_ACTUALIZADAS,
  MENSAJE_ESPECIALIDAD_SOLO_PROFESOR,
  MENSAJE_IDENTIFICACION_ERRONEA,
  MENSAJE_ORGANIZACION_INVALIDA,
  MENSAJE_PERFIL_ACTUALIZADO,
  MENSAJE_TOKEN_NO_FRESCO,
  MENSAJE_USERNAME_DUPLICADO,
  MENSAJE_USUARIO_CREADO,
} from './users.service';
import type { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import type { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import type { ListarUsuariosQueryDto } from './dto/listar-usuarios.dto';

type ConsultaFind = { where: object; select: object };
type ConsultaCreate = { data: object; select: object };
type ConsultaListar = {
  where: object;
  select: object;
  orderBy: object;
  skip: number;
  take: number;
};
type ConsultaCount = { where: object };
type ConsultaUpdate = { where: object; data: object; select: object };
type ConsultaDelete = { where: object };

interface PrismaMock {
  users: {
    findFirst: jest.Mock<Promise<unknown>, [ConsultaFind]>;
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    findMany: jest.Mock<Promise<unknown[]>, [ConsultaListar]>;
    count: jest.Mock<Promise<number>, [ConsultaCount]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
    delete: jest.Mock<Promise<unknown>, [ConsultaDelete]>;
  };
  organizations: {
    findFirst: jest.Mock<Promise<unknown>, [ConsultaFind]>;
  };
}

interface SesionesMock {
  revocarUsuario: jest.Mock<void, [string]>;
}

const ADMIN: UsuarioAutenticado = {
  id: '1',
  username: 'admin',
  role: 'admin',
  organizacionId: null,
  debeCambiarContrasena: false,
};

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

/**
 * Fila que devuelve el mock de users.create/findMany: refleja el select
 * CAMPOS_USUARIO (sin password_hash ni last_login — prueba de que el
 * mapper no los necesita).
 */
const USUARIO = {
  id: BigInt(12),
  organization_id: BigInt(1),
  role: 'teacher' as const,
  username: 'prof.unit',
  email: 'prof.unit@educoins.test',
  first_name: 'Ana',
  last_name: 'Unit',
  specialty: 'Mathematics',
  must_change_password: true,
  is_active: true,
  created_at: new Date('2026-10-15T10:00:00.000Z'),
};

const USUARIO_RESPUESTA = {
  id: '12',
  usuario: 'prof.unit',
  correo: 'prof.unit@educoins.test',
  rol: 'teacher',
  nombre: 'Ana',
  apellido: 'Unit',
  especialidad: 'Mathematics',
  organizacionId: '1',
  debeCambiarContrasena: true,
  activo: true,
  creadoEn: '2026-10-15T10:00:00.000Z',
};

/**
 * Factory del DTO de creación: devuelve objetos planos NUEVOS en cada
 * llamada (esparcir una instancia de clase perdería su prototipo,
 * warning no-misused-spread de oxlint) y permite sobrescribir campos
 * por prueba.
 */
const dtoCrear = (
  sobrescrituras: Partial<CrearUsuarioDto> = {},
): CrearUsuarioDto => ({
  rol: 'teacher',
  usuario: 'prof.unit',
  correo: 'prof.unit@educoins.test',
  nombre: 'Ana',
  apellido: 'Unit',
  organizacionId: '1',
  especialidad: 'Mathematics',
  ...sobrescrituras,
});

function errorDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`username`)',
    { code: 'P2002', meta: { target: ['username'] }, clientVersion: 'test' },
  );
}

function errorNoEncontrado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'An operation failed because it depends on one or more records that were required but not found.',
    { code: 'P2025', clientVersion: 'test' },
  );
}

/** Contraseña actual de las fixtures de actualizarPerfil (hash real argon2). */
const CONTRASENA_PERFIL = 'ContrasenaPerfil123!';

describe('UsersService', () => {
  let usersService: UsersService;
  let prisma: PrismaMock;
  let sesiones: SesionesMock;
  /** Hash argon2 REAL de CONTRASENA_PERFIL, calculado una sola vez. */
  let hashPerfil: string;

  beforeAll(async () => {
    hashPerfil = await hash(CONTRASENA_PERFIL);
  });

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn<Promise<unknown>, [ConsultaFind]>(),
        create: jest.fn<Promise<unknown>, [ConsultaCreate]>(),
        findMany: jest.fn<Promise<unknown[]>, [ConsultaListar]>(),
        count: jest.fn<Promise<number>, [ConsultaCount]>(),
        update: jest.fn<Promise<unknown>, [ConsultaUpdate]>(),
        delete: jest.fn<Promise<unknown>, [ConsultaDelete]>(),
      },
      organizations: {
        findFirst: jest.fn<Promise<unknown>, [ConsultaFind]>(),
      },
    };
    sesiones = {
      revocarUsuario: jest.fn<void, [string]>(),
    };
    usersService = new UsersService(
      prisma as unknown as PrismaService,
      sesiones as unknown as SesionesActivasService,
    );
  });

  describe('crear', () => {
    it('crea el profesor con los campos del body y responde mensaje + contraseña + DTO', async () => {
      // Secuencia de users.findFirst: 1º admin activo, 2º duplicados.
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue(USUARIO);

      const resultado = await usersService.crear(dtoCrear(), ADMIN);

      expect(resultado.mensaje).toBe(MENSAJE_USUARIO_CREADO);
      // La contraseña inicial generada: 16 chars base64url.
      expect(resultado.contrasenaInicial).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(resultado.usuario).toEqual(USUARIO_RESPUESTA);

      const llamada = prisma.users.create.mock.calls[0][0];
      expect(llamada.data).toEqual(
        expect.objectContaining({
          organization_id: BigInt(1),
          role: 'teacher',
          username: 'prof.unit',
          email: 'prof.unit@educoins.test',
          first_name: 'Ana',
          last_name: 'Unit',
          specialty: 'Mathematics',
        }),
      );
      // La contraseña se guarda HASHEADA (argon2), jamás el texto plano
      // que se devolvió al admin (AGENTS.md §9.3).
      const data = llamada.data as Record<string, unknown>;
      expect(data.password_hash).not.toBe(resultado.contrasenaInicial);
      expect(String(data.password_hash)).toMatch(/^\$argon2/);
      // must_change_password, is_active, last_login y las fechas jamás
      // viajan en el INSERT: son defaults de la BD (AGENTS.md §7).
      expect(data).not.toHaveProperty('must_change_password');
      expect(data).not.toHaveProperty('is_active');
      expect(data).not.toHaveProperty('last_login');
      expect(data).not.toHaveProperty('created_at');
      expect(data).not.toHaveProperty('updated_at');
    });

    it('genera una contraseña inicial DISTINTA en cada creación', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue(USUARIO);

      const primera = await usersService.crear(dtoCrear(), ADMIN);
      const segunda = await usersService.crear(dtoCrear(), ADMIN);

      expect(primera.contrasenaInicial).not.toBe(segunda.contrasenaInicial);
    });

    it('re-verifica en la BD que el admin exista y esté activo antes del INSERT', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue(USUARIO);

      await usersService.crear(dtoCrear(), ADMIN);

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), role: 'admin', is_active: true },
        select: expect.any(Object),
      });
    });

    it('busca duplicados de username y correo en una sola consulta', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue(USUARIO);

      await usersService.crear(dtoCrear(), ADMIN);

      // La 2ª llamada a users.findFirst es el pre-check de duplicados.
      const duplicados = prisma.users.findFirst.mock.calls[1][0];
      expect(duplicados.where).toEqual({
        OR: [{ username: 'prof.unit' }, { email: 'prof.unit@educoins.test' }],
      });
    });

    it('rechaza con 409 y mensaje de username cuando el usuario ya existe', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce({
          username: 'Prof.Unit',
          email: 'otro@educoins.test',
        });

      await expect(usersService.crear(dtoCrear(), ADMIN)).rejects.toThrow(
        new ConflictException(MENSAJE_USERNAME_DUPLICADO),
      );
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 409 y mensaje de correo cuando el email ya existe (aunque cambien las mayúsculas)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce({
          username: 'otro.usuario',
          email: 'PROF.UNIT@educoins.test',
        });

      await expect(usersService.crear(dtoCrear(), ADMIN)).rejects.toThrow(
        new ConflictException(MENSAJE_CORREO_DUPLICADO),
      );
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('crea estudiantes con specialty null', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue({
        ...USUARIO,
        role: 'student',
        specialty: null,
      });

      const resultado = await usersService.crear(
        dtoCrear({ rol: 'student', especialidad: undefined }),
        ADMIN,
      );

      const data = prisma.users.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.role).toBe('student');
      expect(data.specialty).toBeNull();
      expect(resultado.usuario.rol).toBe('student');
      expect(resultado.usuario.especialidad).toBeNull();
    });

    it('teacher sin especialidad la guarda como null (columna nullable)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockResolvedValue({
        ...USUARIO,
        specialty: null,
      });

      await usersService.crear(dtoCrear({ especialidad: undefined }), ADMIN);

      const data = prisma.users.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.specialty).toBeNull();
    });

    it('rechaza con 400 la especialidad en una cuenta de estudiante, sin tocar la BD', async () => {
      await expect(
        usersService.crear(
          dtoCrear({ rol: 'student', especialidad: 'Trucos' }),
          ADMIN,
        ),
      ).rejects.toThrow(
        new BadRequestException(MENSAJE_ESPECIALIDAD_SOLO_PROFESOR),
      );
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 404 estándar si el admin no existe o está inactivo', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(usersService.crear(dtoCrear(), ADMIN)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 401 ids del token no numéricos sin consultar la BD', async () => {
      const tokenCorrupto: UsuarioAutenticado = {
        ...ADMIN,
        id: 'no-soy-numero',
      };

      await expect(
        usersService.crear(dtoCrear(), tokenCorrupto),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un organizacionId no numérico (defensa interna: el DTO lo impide por HTTP)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);

      await expect(
        usersService.crear(dtoCrear({ organizacionId: 'abc' }), ADMIN),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ORGANIZACION_INVALIDA));
      expect(prisma.organizations.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 404 estándar si la organización no existe (antes que un P2003 de FK)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue(null);

      await expect(usersService.crear(dtoCrear(), ADMIN)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('propaga el P2002 de una carrera concurrente (el filtro global lo traduce a 409)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce(null);
      prisma.organizations.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.users.create.mockRejectedValue(errorDuplicado());

      const promesa = usersService.crear(dtoCrear(), ADMIN);
      await expect(promesa).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rechaza con 409 de username cuando usuario Y correo colisionan con el mismo registro', async () => {
      // El pre-check encuentra UNA fila que ya tiene ambos valores: el
      // mensaje corresponde al username (primera rama determinística).
      prisma.users.findFirst
        .mockResolvedValueOnce({ id: BigInt(1) })
        .mockResolvedValueOnce({
          username: 'Prof.Unit',
          email: 'prof.unit@educoins.test',
        });

      await expect(
        usersService.crear(
          dtoCrear({
            usuario: 'prof.unit',
            correo: 'prof.unit@educoins.test',
          }),
          ADMIN,
        ),
      ).rejects.toThrow(new ConflictException(MENSAJE_USERNAME_DUPLICADO));
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a roles que no son admin (segunda capa del service)', async () => {
      await expect(usersService.crear(dtoCrear(), PROFESOR)).rejects.toThrow(
        new ForbiddenException(MENSAJE_SIN_ROL),
      );
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.create).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('mapea usuarios y meta de la paginación estándar { data, meta }', async () => {
      prisma.users.findMany.mockResolvedValue([USUARIO]);
      prisma.users.count.mockResolvedValue(4);

      const resultado = await usersService.listar(
        { page: 2, limit: 10 } as ListarUsuariosQueryDto,
        ADMIN,
      );

      expect(resultado).toEqual({
        data: [USUARIO_RESPUESTA],
        meta: { total: 4, page: 2, limit: 10 },
      });
    });

    it('sin filtros consulta todos con la página 1 y 20 filas por defecto, orden created_at DESC', async () => {
      prisma.users.findMany.mockResolvedValue([]);
      prisma.users.count.mockResolvedValue(0);

      const resultado = await usersService.listar({}, ADMIN);

      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: {},
        select: expect.any(Object),
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(prisma.users.count).toHaveBeenCalledWith({ where: {} });
      expect(resultado.meta).toEqual({ total: 0, page: 1, limit: 20 });
    });

    it('construye el WHERE con los filtros de texto, rol, organización y activa', async () => {
      prisma.users.findMany.mockResolvedValue([]);
      prisma.users.count.mockResolvedValue(0);

      await usersService.listar(
        {
          q: 'unit',
          rol: 'teacher',
          organizacionId: '1',
          activa: true,
          page: 2,
          limit: 10,
        } as ListarUsuariosQueryDto,
        ADMIN,
      );

      const where = {
        OR: [
          { username: { contains: 'unit', mode: 'insensitive' } },
          { email: { contains: 'unit', mode: 'insensitive' } },
          { first_name: { contains: 'unit', mode: 'insensitive' } },
          { last_name: { contains: 'unit', mode: 'insensitive' } },
        ],
        role: 'teacher',
        organization_id: BigInt(1),
        is_active: true,
      };
      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where, skip: 10, take: 10 }),
      );
      // El conteo repite el mismo WHERE para que el total sea coherente.
      expect(prisma.users.count).toHaveBeenCalledWith({ where });
    });

    it('rechaza con 400 un organizacionId de filtro no numérico (defensa interna)', async () => {
      await expect(
        usersService.listar(
          { organizacionId: 'abc' } as ListarUsuariosQueryDto,
          ADMIN,
        ),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ORGANIZACION_INVALIDA));
      expect(prisma.users.findMany).not.toHaveBeenCalled();
      expect(prisma.users.count).not.toHaveBeenCalled();
    });

    it('una página más allá del total devuelve data vacía con meta coherente', async () => {
      prisma.users.findMany.mockResolvedValue([]);
      prisma.users.count.mockResolvedValue(3);

      const resultado = await usersService.listar(
        { page: 999, limit: 20 } as ListarUsuariosQueryDto,
        ADMIN,
      );

      expect(resultado).toEqual({
        data: [],
        meta: { total: 3, page: 999, limit: 20 },
      });
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(usersService.listar({}, PROFESOR)).rejects.toThrow(
        new ForbiddenException(MENSAJE_SIN_ROL),
      );
      expect(prisma.users.findMany).not.toHaveBeenCalled();
      expect(prisma.users.count).not.toHaveBeenCalled();
    });
  });

  describe('eliminar (borrado lógico)', () => {
    it('desactiva con UPDATE is_active=false y jamás DELETE físico', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue({ id: BigInt(12) });

      const resultado = await usersService.eliminar('12', ADMIN);

      expect(resultado).toBeUndefined();
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(12) },
        data: { is_active: false },
        select: expect.any(Object),
      });
      expect(prisma.users.delete).not.toHaveBeenCalled();
    });

    it('el pre-check exige un objetivo teacher/student existente', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue({ id: BigInt(12) });

      await usersService.eliminar('12', ADMIN);

      // Un admin como objetivo NO casa con el filtro de rol y cae en
      // el mismo null que un inexistente (anti-enumeración).
      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(12), role: { in: ['teacher', 'student'] } },
        select: expect.any(Object),
      });
    });

    it('id no numérico → 404 estándar sin UPDATE', async () => {
      await expect(usersService.eliminar('abc', ADMIN)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('inexistente → 404 estándar sin UPDATE', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(usersService.eliminar('999', ADMIN)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('es idempotente: repetir el borrado vuelve a responder sin error', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue({ id: BigInt(12) });

      await expect(usersService.eliminar('12', ADMIN)).resolves.toBeUndefined();
      await expect(usersService.eliminar('12', ADMIN)).resolves.toBeUndefined();
      expect(prisma.users.update).toHaveBeenCalledTimes(2);
    });

    it('propaga el P2025 del inexistente (el filtro global lo traduce a 404)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockRejectedValue(errorNoEncontrado());

      const promesa = usersService.eliminar('999', ADMIN);
      await expect(promesa).rejects.toMatchObject({ code: 'P2025' });
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(usersService.eliminar('12', PROFESOR)).rejects.toThrow(
        new ForbiddenException(MENSAJE_SIN_ROL),
      );
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('actualizar (reactivar/desactivar)', () => {
    it('reactiva con activa=true y devuelve el DTO mapeado', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue(USUARIO);

      const resultado = await usersService.actualizar(
        '12',
        { activa: true } as ActualizarUsuarioDto,
        ADMIN,
      );

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(12) },
        data: { is_active: true },
        select: expect.any(Object),
      });
      expect(resultado).toEqual(USUARIO_RESPUESTA);
    });

    it('desactiva con activa=false (la misma vía que el DELETE)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue(USUARIO);

      await usersService.actualizar(
        '12',
        { activa: false } as ActualizarUsuarioDto,
        ADMIN,
      );

      const data = prisma.users.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.is_active).toBe(false);
    });

    it('jamás escribe updated_at ni must_change_password en el UPDATE (trigger/defaults BD)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(12) });
      prisma.users.update.mockResolvedValue(USUARIO);

      await usersService.actualizar(
        '12',
        { activa: true } as ActualizarUsuarioDto,
        ADMIN,
      );

      const data = prisma.users.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('updated_at');
      expect(data).not.toHaveProperty('created_at');
      expect(data).not.toHaveProperty('must_change_password');
      expect(data).not.toHaveProperty('role');
    });

    it('rechaza con 400 un cuerpo sin campos para actualizar', async () => {
      await expect(
        usersService.actualizar('12', {} as ActualizarUsuarioDto, ADMIN),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ACTUALIZACION_VACIA));
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('id no numérico → 404 estándar sin UPDATE', async () => {
      await expect(
        usersService.actualizar(
          'abc',
          { activa: true } as ActualizarUsuarioDto,
          ADMIN,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('inexistente → 404 estándar sin UPDATE', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        usersService.actualizar(
          '999',
          { activa: true } as ActualizarUsuarioDto,
          ADMIN,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(
        usersService.actualizar(
          '12',
          { activa: true } as ActualizarUsuarioDto,
          PROFESOR,
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_SIN_ROL));
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('actualizarPerfil (PATCH /users/me)', () => {
    /**
     * Fila que devuelve el mock de users.findFirst en el paso de
     * re-verificación: refleja el select CAMPOS_PERFIL (email, hash y
     * rol) — el hash SOLO se usa para verificar la contraseña actual.
     * El id es el del TOKEN (PROFESOR.id): el objetivo de /me nunca
     * llega por la petición.
     */
    const perfilActual = (): Record<string, unknown> => ({
      id: BigInt(2),
      email: 'prof.unit@educoins.test',
      password_hash: hashPerfil,
      role: 'teacher',
    });

    /** Token del profesor con iat RECIENTE (dentro de los 5 minutos). */
    const profesorFresco = (): UsuarioAutenticado => ({
      ...PROFESOR,
      iat: Math.floor(Date.now() / 1000),
    });

    /** Factory del DTO: objetos planos nuevos con la contraseña actual. */
    const dtoPerfil = (
      sobrescrituras: Partial<ActualizarPerfilDto> = {},
    ): ActualizarPerfilDto => ({
      contrasena: CONTRASENA_PERFIL,
      ...sobrescrituras,
    });

    it('actualiza campos genéricos con la contraseña correcta y NO cierra sesión', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      prisma.users.update.mockResolvedValue(USUARIO);

      const resultado = await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({
          nombre: 'Nuevo',
          apellido: 'Apellido',
          especialidad: 'Biology',
        }),
      );

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(2) },
        data: {
          first_name: 'Nuevo',
          last_name: 'Apellido',
          specialty: 'Biology',
        },
        select: expect.any(Object),
      });
      expect(resultado).toEqual({
        mensaje: MENSAJE_PERFIL_ACTUALIZADO,
        sesionCerrada: false,
        usuario: USUARIO_RESPUESTA,
      });
      expect(sesiones.revocarUsuario).not.toHaveBeenCalled();
    });

    it('la contraseña actual se verifica con argon2: incorrecta → 403 sin UPDATE', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({ contrasena: 'Incorrecta123!', nombre: 'Nuevo' }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(MENSAJE_CONTRASENA_ACTUAL_INCORRECTA),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('un hash corrupto se trata como contraseña incorrecta, no como 500', async () => {
      prisma.users.findFirst.mockResolvedValue({
        ...perfilActual(),
        password_hash: 'HASH_CORRUPTO',
      });

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({ nombre: 'Nuevo' }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(MENSAJE_CONTRASENA_ACTUAL_INCORRECTA),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('solo la contraseña (nada que actualizar) → 400', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());

      await expect(
        usersService.actualizarPerfil(profesorFresco(), dtoPerfil()),
      ).rejects.toThrow(
        new BadRequestException(MENSAJE_ACTUALIZACION_PERFIL_VACIA),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('un estudiante no puede tocar la especialidad → 400', async () => {
      prisma.users.findFirst.mockResolvedValue({
        ...perfilActual(),
        role: 'student',
      });

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({ especialidad: 'Trucos' }),
        ),
      ).rejects.toThrow(
        new BadRequestException(MENSAJE_ESPECIALIDAD_SOLO_PROFESOR),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('especialidad null LIMPIA y un campo ausente no se toca', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      prisma.users.update.mockResolvedValue({ ...USUARIO, specialty: null });

      await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({ especialidad: null }),
      );

      // Solo el campo presente llega al UPDATE: ni first_name ni
      // last_name ni nada más.
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(2) },
        data: { specialty: null },
        select: expect.any(Object),
      });
    });

    it('cambia username con identificación completa y cierra TODAS las sesiones', async () => {
      // 1º findFirst: re-verificación; 2º: duplicados auto-excluido.
      prisma.users.findFirst
        .mockResolvedValueOnce(perfilActual())
        .mockResolvedValueOnce(null);
      prisma.users.update.mockResolvedValue(USUARIO);

      const resultado = await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({
          correoActual: 'prof.unit@educoins.test',
          usuario: 'prof.nuevo',
        }),
      );

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: BigInt(2) },
        data: { username: 'prof.nuevo' },
        select: expect.any(Object),
      });
      expect(sesiones.revocarUsuario).toHaveBeenCalledWith('2');
      expect(resultado).toEqual({
        mensaje: MENSAJE_CREDENCIALES_ACTUALIZADAS,
        sesionCerrada: true,
        usuario: USUARIO_RESPUESTA,
      });
    });

    it('el pre-check de duplicados se auto-excluye (NOT id propio)', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(perfilActual())
        .mockResolvedValueOnce(null);
      prisma.users.update.mockResolvedValue(USUARIO);

      await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({
          correoActual: 'prof.unit@educoins.test',
          usuario: 'prof.unit',
        }),
      );

      expect(prisma.users.findFirst).toHaveBeenLastCalledWith({
        where: { OR: [{ username: 'prof.unit' }], NOT: { id: BigInt(2) } },
        select: { username: true, email: true },
      });
      expect(prisma.users.update).toHaveBeenCalled();
    });

    it('token antiguo (> 5 min) → 401 de token no fresco, sin UPDATE', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      const tokenViejo: UsuarioAutenticado = {
        ...PROFESOR,
        iat: Math.floor(Date.now() / 1000) - 400,
      };

      await expect(
        usersService.actualizarPerfil(
          tokenViejo,
          dtoPerfil({
            correoActual: 'prof.unit@educoins.test',
            contrasenaNueva: 'NuevaClave123!',
          }),
        ),
      ).rejects.toThrow(new UnauthorizedException(MENSAJE_TOKEN_NO_FRESCO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('token sin iat → 401 (fail-closed)', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());

      await expect(
        usersService.actualizarPerfil(
          PROFESOR,
          dtoPerfil({
            correoActual: 'prof.unit@educoins.test',
            contrasenaNueva: 'NuevaClave123!',
          }),
        ),
      ).rejects.toThrow(new UnauthorizedException(MENSAJE_TOKEN_NO_FRESCO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('credencial sin correoActual → 400', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({ contrasenaNueva: 'NuevaClave123!' }),
        ),
      ).rejects.toThrow(
        new BadRequestException(MENSAJE_CORREO_ACTUAL_REQUERIDO),
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('correoActual que no coincide → 403 con mensaje único', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({
            correoActual: 'otro@educoins.test',
            contrasenaNueva: 'NuevaClave123!',
          }),
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_IDENTIFICACION_ERRONEA));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('correoActual coincide aunque cambien las mayúsculas (CITEXT)', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      prisma.users.update.mockResolvedValue(USUARIO);

      await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({
          correoActual: 'PROF.UNIT@EDUCOINS.TEST',
          contrasenaNueva: 'NuevaClave123!',
        }),
      );

      expect(prisma.users.update).toHaveBeenCalled();
    });

    it('contrasenaNueva se guarda como hash argon2 y baja must_change_password', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      prisma.users.update.mockResolvedValue(USUARIO);

      const resultado = await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({
          correoActual: 'prof.unit@educoins.test',
          contrasenaNueva: 'NuevaClave123!',
        }),
      );

      const data = prisma.users.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      // La contraseña nueva jamás en texto plano: hash argon2 real.
      expect(data.password_hash).not.toBe('NuevaClave123!');
      expect(String(data.password_hash)).toMatch(/^\$argon2/);
      expect(data.must_change_password).toBe(false);
      expect(resultado.sesionCerrada).toBe(true);
      expect(resultado.usuario.debeCambiarContrasena).toBe(true); // valor del fixture USUARIO
    });

    it('username duplicado en OTRA cuenta → 409', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(perfilActual())
        .mockResolvedValueOnce({
          username: 'Prof.Nuevo',
          email: 'ajeno@educoins.test',
        });

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({
            correoActual: 'prof.unit@educoins.test',
            usuario: 'prof.nuevo',
          }),
        ),
      ).rejects.toThrow(new ConflictException(MENSAJE_USERNAME_DUPLICADO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('correo duplicado (incluso con otras mayúsculas) → 409', async () => {
      prisma.users.findFirst
        .mockResolvedValueOnce(perfilActual())
        .mockResolvedValueOnce({
          username: 'ajeno',
          email: 'NUEVO@EDUCOINS.TEST',
        });

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({
            correoActual: 'prof.unit@educoins.test',
            correo: 'nuevo@educoins.test',
          }),
        ),
      ).rejects.toThrow(new ConflictException(MENSAJE_CORREO_DUPLICADO));
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('usuario inactivo o inexistente → 401 (re-verificación en BD)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        usersService.actualizarPerfil(
          profesorFresco(),
          dtoPerfil({ nombre: 'Nuevo' }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('id del token no numérico → 401 sin consultar la BD', async () => {
      const tokenCorrupto: UsuarioAutenticado = {
        ...PROFESOR,
        id: 'no-soy-numero',
      };

      await expect(
        usersService.actualizarPerfil(
          tokenCorrupto,
          dtoPerfil({ nombre: 'Nuevo' }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('jamás escribe role ni organization_id en el UPDATE (imposibles de cambiar)', async () => {
      prisma.users.findFirst.mockResolvedValue(perfilActual());
      prisma.users.update.mockResolvedValue(USUARIO);

      await usersService.actualizarPerfil(
        profesorFresco(),
        dtoPerfil({ nombre: 'Nuevo', apellido: 'Apellido' }),
      );

      const data = prisma.users.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('role');
      expect(data).not.toHaveProperty('organization_id');
      expect(data).not.toHaveProperty('updated_at');
      expect(data).not.toHaveProperty('is_active');
    });
  });
});
