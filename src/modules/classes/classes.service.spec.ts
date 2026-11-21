import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import {
  ClassesService,
  MENSAJE_ACTUALIZACION_VACIA,
  MENSAJE_INSCRIPCION_NO_ACTIVA,
  MENSAJE_YA_INSCRIPTO,
  mensajeClaseCreada,
  mensajeUnidoAClase,
} from './classes.service';
import type { BuscarClasesQueryDto } from './dto/buscar-clases.dto';

type ConsultaProfesor = { where: object; select: object };
type ConsultaClase = { where: object; select: object };
type ConsultaCreate = { data: object; select: object };
type ConsultaUpdate = { where: object; data: object; select: object };

interface PrismaMock {
  users: {
    findFirst: jest.Mock<Promise<{ id: bigint } | null>, [ConsultaProfesor]>;
  };
  classes: {
    findFirst: jest.Mock<Promise<unknown>, [ConsultaClase]>;
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
  };
  enrollments: {
    findFirst: jest.Mock<Promise<unknown>, [{ where: object; select: object }]>;
    create: jest.Mock<Promise<unknown>, [{ data: object; select: object }]>;
    findMany: jest.Mock<Promise<unknown[]>, [object]>;
    count: jest.Mock<Promise<number>, [object]>;
  };
  $queryRaw: jest.Mock<Promise<unknown[]>, [Prisma.Sql]>;
}

interface AutorizacionMock {
  verificarPertenencia: jest.Mock<
    Promise<void>,
    [string, string, UsuarioAutenticado]
  >;
}

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const ESTUDIANTE: UsuarioAutenticado = {
  id: '3',
  username: 'est.perez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const ADMIN: UsuarioAutenticado = {
  id: '1',
  username: 'admin',
  role: 'admin',
  organizacionId: null,
  debeCambiarContrasena: false,
};

const FILA_ENCONTRADA = {
  id: BigInt(1),
  name: 'Mathematics 10A',
  status: 'active' as const,
  created_at: new Date('2026-10-08T02:53:19.614Z'),
  first_name: 'Ana',
  last_name: 'López',
};

const INSCRIPCION_ENCONTRADA = {
  id: BigInt(1),
  status: 'active' as const,
  enrolled_at: new Date('2026-10-08T02:53:19.000Z'),
  users: {
    id: BigInt(3),
    username: 'est.perez',
    first_name: 'Juan',
    last_name: 'Pérez',
  },
};

const CLASE_CREADA = {
  id: BigInt(5),
  teacher_id: BigInt(2),
  name: 'Proyecto integrador Prueba',
  code: 'AB12CD34',
  status: 'active' as const,
  created_at: new Date('2026-10-12T10:00:00.000Z'),
  updated_at: new Date('2026-10-12T10:00:00.000Z'),
};

function errorDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`lower(name)`)',
    { code: 'P2002', meta: { target: ['name'] }, clientVersion: 'test' },
  );
}

describe('ClassesService', () => {
  let classesService: ClassesService;
  let prisma: PrismaMock;
  let autorizacion: AutorizacionMock;

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn<
          Promise<{ id: bigint } | null>,
          [ConsultaProfesor]
        >(),
      },
      classes: {
        findFirst: jest.fn<Promise<unknown>, [ConsultaClase]>(),
        create: jest.fn<Promise<unknown>, [ConsultaCreate]>(),
        update: jest.fn<Promise<unknown>, [ConsultaUpdate]>(),
      },
      enrollments: {
        findFirst: jest.fn<
          Promise<unknown>,
          [{ where: object; select: object }]
        >(),
        create: jest.fn<Promise<unknown>, [{ data: object; select: object }]>(),
        findMany: jest.fn<Promise<unknown[]>, [object]>(),
        count: jest.fn<Promise<number>, [object]>(),
      },
      $queryRaw: jest.fn<Promise<unknown[]>, [Prisma.Sql]>(),
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    classesService = new ClassesService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
    );
  });

  describe('crear', () => {
    it('crea la clase SIN enviar el código: lo genera la BD', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      const resultado = await classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );

      const llamada = prisma.classes.create.mock.calls[0][0];
      expect(llamada.data).toEqual({
        teacher_id: BigInt(2),
        name: 'Proyecto integrador Prueba',
      });
      // El código, estado y fechas jamás viajan en el INSERT: son defaults
      // de la BD (AGENTS.md §7).
      expect(llamada.data).not.toHaveProperty('code');
      expect(llamada.data).not.toHaveProperty('status');
      expect(llamada.data).not.toHaveProperty('created_at');

      expect(resultado).toEqual({
        mensaje: mensajeClaseCreada('AB12CD34'),
        clase: {
          id: '5',
          profesorId: '2',
          nombre: 'Proyecto integrador Prueba',
          codigo: 'AB12CD34',
          estado: 'active',
          creadoEn: '2026-10-12T10:00:00.000Z',
          actualizadoEn: '2026-10-12T10:00:00.000Z',
        },
      });
    });

    it('el mensaje de éxito menciona el código que la BD generó', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      const resultado = await classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );

      expect(resultado.mensaje).toBe(
        'Clase creada con éxito. Comparte el código AB12CD34 con tus estudiantes.',
      );
    });

    it('verifica en la BD que el profesor exista y esté activo antes de crear', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      await classesService.crear('Proyecto integrador Prueba', PROFESOR);

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(2), role: 'teacher', is_active: true },
        select: expect.any(Object),
      });
    });

    it('usa el teacher_id del token y nunca lo recibe del cuerpo', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      await classesService.crear('Proyecto integrador Prueba', PROFESOR);

      expect(prisma.classes.create.mock.calls[0][0].data).toEqual({
        teacher_id: BigInt(2),
        name: 'Proyecto integrador Prueba',
      });
    });

    it('rechaza con 404 estándar si el profesor no existe o está inactivo', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        classesService.crear('Proyecto integrador Prueba', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.create).not.toHaveBeenCalled();
    });

    it('rechaza con 401 ids del token no numéricos sin consultar la BD', async () => {
      const tokenCorrupto: UsuarioAutenticado = {
        ...PROFESOR,
        id: 'no-soy-numero',
      };

      await expect(
        classesService.crear('Proyecto integrador Prueba', tokenCorrupto),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.classes.create).not.toHaveBeenCalled();
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockRejectedValue(errorDuplicado());

      const promesa = classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );
      await expect(promesa).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('obtener', () => {
    it('mapea la clase OWN a ClaseRespuestaDto (con el código de unión)', async () => {
      autorizacion.verificarPertenencia.mockResolvedValue();
      prisma.classes.findFirst.mockResolvedValue(CLASE_CREADA);

      const resultado = await classesService.obtener('5', PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '5',
        PROFESOR,
      );
      expect(prisma.classes.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(5) },
        select: {
          id: true,
          teacher_id: true,
          name: true,
          code: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      });
      expect(resultado).toEqual({
        id: '5',
        profesorId: '2',
        nombre: 'Proyecto integrador Prueba',
        codigo: 'AB12CD34',
        estado: 'active',
        creadoEn: '2026-10-12T10:00:00.000Z',
        actualizadoEn: '2026-10-12T10:00:00.000Z',
      });
    });

    it('re-verifica la pertenencia antes de leer (segunda capa)', async () => {
      autorizacion.verificarPertenencia.mockResolvedValue();
      prisma.classes.findFirst.mockResolvedValue(CLASE_CREADA);

      await classesService.obtener('5', PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '5',
        PROFESOR,
      );
    });

    it('clase ajena o inexistente: propaga el 404 de la pertenencia sin leer la fila', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        classesService.obtener('999', ESTUDIANTE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });

    it('fila ausente tras la pertenencia: 404 estándar (defensa en profundidad)', async () => {
      autorizacion.verificarPertenencia.mockResolvedValue();
      prisma.classes.findFirst.mockResolvedValue(null);

      await expect(classesService.obtener('5', PROFESOR)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
    });
  });

  describe('actualizar', () => {
    it('renombra la clase tocando solo el nombre en el UPDATE', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        name: 'Proyecto integrador Renombrado',
      });

      const resultado = await classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado' },
        PROFESOR,
      );

      // Segunda capa de pertenencia antes del UPDATE (AGENTS.md §8).
      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '5',
        PROFESOR,
      );
      expect(prisma.classes.update).toHaveBeenCalledWith({
        where: { id: BigInt(5) },
        data: { name: 'Proyecto integrador Renombrado' },
        select: expect.any(Object),
      });
      expect(resultado).toEqual({
        id: '5',
        profesorId: '2',
        nombre: 'Proyecto integrador Renombrado',
        codigo: 'AB12CD34',
        estado: 'active',
        creadoEn: '2026-10-12T10:00:00.000Z',
        actualizadoEn: '2026-10-12T10:00:00.000Z',
      });
    });

    it('archiva cambiando el estado a archived', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        status: 'archived' as const,
      });

      await classesService.actualizar('5', { estado: 'archived' }, PROFESOR);

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        status: 'archived',
      });
    });

    it('reactiva cambiando el estado a active', async () => {
      prisma.classes.update.mockResolvedValue(CLASE_CREADA);

      await classesService.actualizar('5', { estado: 'active' }, PROFESOR);

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        status: 'active',
      });
    });

    it('actualiza nombre y estado juntos cuando llegan ambos', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        name: 'Proyecto integrador Renombrado',
        status: 'archived' as const,
      });

      await classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado', estado: 'archived' },
        PROFESOR,
      );

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        name: 'Proyecto integrador Renombrado',
        status: 'archived',
      });
    });

    it('jamás setea updated_at ni teacher_id en el UPDATE (trigger BD)', async () => {
      prisma.classes.update.mockResolvedValue(CLASE_CREADA);

      await classesService.actualizar('5', { estado: 'archived' }, PROFESOR);

      const data = prisma.classes.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('updated_at');
      expect(data).not.toHaveProperty('teacher_id');
      expect(data).not.toHaveProperty('code');
    });

    it('rechaza con 400 un cuerpo sin campos para actualizar', async () => {
      await expect(
        classesService.actualizar('5', {}, PROFESOR),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ACTUALIZACION_VACIA));
      expect(prisma.classes.update).not.toHaveBeenCalled();
    });

    it('propaga el 404 de la pertenencia (clase ajena o inexistente) sin tocar la BD de escritura', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        classesService.actualizar('999', { estado: 'archived' }, PROFESOR),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.classes.update).not.toHaveBeenCalled();
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.classes.update.mockRejectedValue(errorDuplicado());

      const promesa = classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado' },
        PROFESOR,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('buscar', () => {
    /** Texto y valores del SQL capturado en la llamada n de $queryRaw. */
    const sqlDe = (indice: number): { sql: string; values: unknown[] } => {
      const captura = prisma.$queryRaw.mock.calls[indice][0] as unknown as {
        sql: string;
        values: unknown[];
      };
      return captura;
    };

    const consulta = (
      sobrescrituras: Partial<BuscarClasesQueryDto> = {},
    ): BuscarClasesQueryDto => ({
      q: 'matema',
      ...sobrescrituras,
    });

    it('mapea filas y meta de la paginación estándar { data, meta }', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([FILA_ENCONTRADA])
        .mockResolvedValueOnce([{ total: BigInt(12) }]);

      const resultado = await classesService.buscar(
        consulta({ page: 2, limit: 20 }),
        ESTUDIANTE,
      );

      expect(resultado).toEqual({
        data: [
          {
            id: '1',
            nombre: 'Mathematics 10A',
            estado: 'active',
            profesorNombre: 'Ana López',
            creadoEn: '2026-10-08T02:53:19.614Z',
          },
        ],
        meta: { total: 12, page: 2, limit: 20 },
      });
    });

    it('usa la página 1 y 20 filas por defecto', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      const resultado = await classesService.buscar(consulta(), ESTUDIANTE);

      expect(resultado.meta).toEqual({ total: 0, page: 1, limit: 20 });
    });

    it('el SQL combina similitud trigram con subcadena y ordena por similitud', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta({ q: 'matema' }), ESTUDIANTE);

      const { sql } = sqlDe(0);
      expect(sql).toContain('c.name % ?');
      expect(sql).toContain('c.name ILIKE ?');
      expect(sql).toContain('ORDER BY similarity(c.name, ?)');
      expect(sql).toContain('LIMIT ?');
      expect(sql).toContain('OFFSET ?');
    });

    it('calcula el OFFSET por página y límite', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta({ page: 3, limit: 20 }), ADMIN);

      expect(sqlDe(0).values).toContain(40);
    });

    it('el profesor solo busca SUS clases: condición teacher_id con su id', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta(), PROFESOR);

      const { sql, values } = sqlDe(0);
      expect(sql).toContain('c.teacher_id = ?');
      expect(values).toContain(BigInt(2));
      expect(sql).not.toContain('organization_id');
    });

    it('el estudiante solo ve clases activas de SU organización', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta(), ESTUDIANTE);

      const { sql, values } = sqlDe(0);
      expect(sql).toContain('u.organization_id = ?');
      expect(sql).toContain("c.status = 'active'");
      expect(values).toContain(BigInt(1));
      expect(sql).not.toContain('teacher_id = ?');
    });

    it('un estudiante sin organización no recibe resultados (condición false)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta(), {
        ...ESTUDIANTE,
        organizacionId: null,
      });

      const { sql } = sqlDe(0);
      expect(sql).toContain('AND false');
    });

    it('el admin no recibe filtro adicional', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta(), ADMIN);

      const { sql } = sqlDe(0);
      expect(sql).toContain('AND true');
      expect(sql).not.toContain('teacher_id = ?');
      expect(sql).not.toContain('organization_id = ?');
    });

    it('escapa los wildcards % y _ del ILIKE para que busquen literal', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      await classesService.buscar(consulta({ q: '100%_a' }), ADMIN);

      const { values } = sqlDe(0);
      expect(values).toContain('%100\\%\\_a%');
    });

    it('el conteo del total repite el mismo WHERE en una segunda query', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(7) }]);

      const resultado = await classesService.buscar(consulta(), PROFESOR);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const conteo = sqlDe(1);
      expect(conteo.sql).toContain('count(*) AS total');
      expect(conteo.sql).toContain('c.name % ?');
      expect(conteo.values).toContain(BigInt(2));
      expect(resultado.meta.total).toBe(7);
    });

    it('tolera filas sin resultados y conteo vacío (meta.total 0)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);

      const resultado = await classesService.buscar(consulta(), ADMIN);

      expect(resultado).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('sin q lista todas las clases por creación descendente, sin similitud ni ILIKE', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([FILA_ENCONTRADA])
        .mockResolvedValueOnce([{ total: BigInt(3) }]);

      const resultado = await classesService.buscar({}, PROFESOR);

      const { sql } = sqlDe(0);
      expect(sql).not.toContain('c.name % ?');
      expect(sql).not.toContain('c.name ILIKE ?');
      expect(sql).toContain('ORDER BY c.created_at DESC');
      expect(sql).toContain('c.teacher_id = ?');
      expect(resultado.meta).toEqual({ total: 3, page: 1, limit: 20 });
      expect(resultado.data).toHaveLength(1);
    });

    it('un q vacío o en blanco se trata como ausente (listado completo)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);

      await classesService.buscar({ q: '   ' }, ADMIN);

      const { sql } = sqlDe(0);
      expect(sql).toContain('ORDER BY c.created_at DESC');
      expect(sql).not.toContain('ILIKE');
    });
  });

  describe('listarEstudiantes', () => {
    it('mapea inscripciones a identidad + estado con { data, meta }', async () => {
      prisma.enrollments.findMany.mockResolvedValue([INSCRIPCION_ENCONTRADA]);
      prisma.enrollments.count.mockResolvedValue(2);

      const resultado = await classesService.listarEstudiantes(
        '1',
        { page: 1, limit: 20 },
        PROFESOR,
      );

      expect(resultado).toEqual({
        data: [
          {
            id: '1',
            estudianteId: '3',
            username: 'est.perez',
            nombre: 'Juan Pérez',
            estado: 'active',
            inscritoEn: '2026-10-08T02:53:19.000Z',
          },
        ],
        meta: { total: 2, page: 1, limit: 20 },
      });
    });

    it('re-verifica la pertenencia de la clase antes de consultar (segunda capa)', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      await classesService.listarEstudiantes('1', {}, PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '1',
        PROFESOR,
      );
      expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { class_id: BigInt(1) } }),
      );
    });

    it('la consulta no lee monedas ni email (mínima exposición)', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      await classesService.listarEstudiantes('1', {}, PROFESOR);

      const consulta = prisma.enrollments.findMany.mock.calls[0][0] as Record<
        string,
        Record<string, unknown>
      >;
      const camposLeidos = Object.keys(consulta.select);
      expect(camposLeidos).not.toContain('coins_earned');
      expect(camposLeidos).not.toContain('coins_spent');
      expect(camposLeidos).not.toContain('coins_available');
      const camposUsuario = Object.keys(
        consulta.select.users as Record<string, unknown>,
      );
      expect(camposUsuario).not.toContain('email');
      expect(camposUsuario).not.toContain('password_hash');
    });

    it('pagina con skip/take según page y limit (defaults 1 y 20)', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      await classesService.listarEstudiantes(
        '1',
        { page: 3, limit: 10 },
        PROFESOR,
      );

      expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );

      await classesService.listarEstudiantes('1', {}, PROFESOR);
      expect(prisma.enrollments.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('clase ajena o inexistente: propaga el 404 sin consultar enrollments', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        classesService.listarEstudiantes('999', {}, PROFESOR),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.enrollments.findMany).not.toHaveBeenCalled();
      expect(prisma.enrollments.count).not.toHaveBeenCalled();
    });

    it('clase sin inscriptos devuelve lista vacía con total 0', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      const resultado = await classesService.listarEstudiantes(
        '1',
        {},
        PROFESOR,
      );

      expect(resultado).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });
  });

  describe('listarInscripciones', () => {
    const INSCRIPCION_DEL_ESTUDIANTE = {
      id: BigInt(7),
      status: 'active' as const,
      enrolled_at: new Date('2026-10-08T02:53:19.000Z'),
      classes: {
        id: BigInt(5),
        name: 'Matemática 5A',
      },
    };

    it('mapea inscripciones activas a { data, meta } con id y nombre de clase', async () => {
      prisma.enrollments.findMany.mockResolvedValue([
        INSCRIPCION_DEL_ESTUDIANTE,
      ]);
      prisma.enrollments.count.mockResolvedValue(1);

      const resultado = await classesService.listarInscripciones(
        { page: 1, limit: 20 },
        ESTUDIANTE,
      );

      expect(resultado).toEqual({
        data: [
          {
            id: '7',
            clase: { id: '5', nombre: 'Matemática 5A' },
            estado: 'active',
            inscritoEn: '2026-10-08T02:53:19.000Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 20 },
      });
    });

    it('filtra por student_id y status active + clase active', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      await classesService.listarInscripciones({}, ESTUDIANTE);

      const whereEsperado = {
        student_id: BigInt(3),
        status: 'active',
        classes: { status: 'active' },
      };
      expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: whereEsperado }),
      );
      expect(prisma.enrollments.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: whereEsperado }),
      );
    });

    it('usa page=1 y limit=50 por defecto', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      await classesService.listarInscripciones({}, ESTUDIANTE);

      expect(prisma.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('devuelve lista vacía con total 0 cuando el estudiante no tiene inscripciones', async () => {
      prisma.enrollments.findMany.mockResolvedValue([]);
      prisma.enrollments.count.mockResolvedValue(0);

      const resultado = await classesService.listarInscripciones(
        {},
        ESTUDIANTE,
      );

      expect(resultado).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });
    });
  });

  describe('flujo: un profesor busca una clase por nombre y la archiva', () => {
    it('el id que devuelve la búsqueda sirve para archivar la propia clase', async () => {
      const claseDelFlujo = {
        ...FILA_ENCONTRADA,
        id: BigInt(9),
        name: 'Flujo Unit Clase',
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([claseDelFlujo])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const busqueda = await classesService.buscar(
        { q: 'Flujo Unit' },
        PROFESOR,
      );

      expect(busqueda.data).toEqual([
        {
          id: '9',
          nombre: 'Flujo Unit Clase',
          estado: 'active',
          profesorNombre: 'Ana López',
          creadoEn: '2026-10-08T02:53:19.614Z',
        },
      ]);

      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        id: BigInt(9),
        status: 'archived' as const,
      });

      const archivada = await classesService.actualizar(
        busqueda.data[0].id,
        { estado: 'archived' },
        PROFESOR,
      );

      // El id del resultado de la búsqueda es el que llega al UPDATE.
      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '9',
        PROFESOR,
      );
      expect(prisma.classes.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BigInt(9) } }),
      );
      expect(archivada.estado).toBe('archived');
    });

    it('el guard corta el flujo si la clase a archivar no es suya (404, sin UPDATE)', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        classesService.actualizar('999', { estado: 'archived' }, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.update).not.toHaveBeenCalled();
    });
  });

  describe('unirse', () => {
    const CLASE_PARA_UNIRSE = { id: BigInt(7), name: 'Clase Unión Unit' };

    it('rechaza con 401 si el id del token no es numérico', async () => {
      await expect(
        classesService.unirse('AB12CD34', { ...ESTUDIANTE, id: 'abc' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('verifica en la BD que el estudiante exista y esté activo (404 estándar si no)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        classesService.unirse('AB12CD34', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(3), role: 'student', is_active: true },
        select: { id: true },
      });
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });

    it('código inexistente o clase no activa → 404 sin consultar inscripciones', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(null);

      await expect(
        classesService.unirse('NOEXISTE9', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      // Solo se aceptan clases activas: archivada e inexistente son iguales.
      expect(prisma.classes.findFirst).toHaveBeenCalledWith({
        where: { code: 'NOEXISTE9', status: 'active' },
        select: { id: true, name: true },
      });
      expect(prisma.enrollments.findFirst).not.toHaveBeenCalled();
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
    });

    it('CA 3: inscripción previa active → 409 sin llegar al INSERT', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(CLASE_PARA_UNIRSE);
      prisma.enrollments.findFirst.mockResolvedValue({ status: 'active' });

      await expect(
        classesService.unirse('AB12CD34', ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_YA_INSCRIPTO));
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
    });

    it('CA 4: inscripción previa withdrawn → 422 sin reactivar (sin INSERT)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(CLASE_PARA_UNIRSE);
      prisma.enrollments.findFirst.mockResolvedValue({ status: 'withdrawn' });

      await expect(
        classesService.unirse('AB12CD34', ESTUDIANTE),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_INSCRIPCION_NO_ACTIVA),
      );
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
    });

    it('CA 4: inscripción previa blocked → 422 sin reactivar (sin INSERT)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(CLASE_PARA_UNIRSE);
      prisma.enrollments.findFirst.mockResolvedValue({ status: 'blocked' });

      await expect(
        classesService.unirse('AB12CD34', ESTUDIANTE),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_INSCRIPCION_NO_ACTIVA),
      );
      expect(prisma.enrollments.create).not.toHaveBeenCalled();
    });

    it('éxito: INSERT sin status (default de la BD) y DTO con inscripción active', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(CLASE_PARA_UNIRSE);
      prisma.enrollments.findFirst.mockResolvedValue(null);
      prisma.enrollments.create.mockResolvedValue({
        status: 'active' as const,
        enrolled_at: new Date('2026-10-19T10:00:00.000Z'),
      });

      // La normalización a mayúsculas vive en el DTO (@Transform); el
      // service recibe el código ya normalizado desde el controller.
      const resultado = await classesService.unirse('AB12CD34', ESTUDIANTE);

      const llamada = prisma.enrollments.create.mock.calls[0][0];
      expect(llamada.data).toEqual({
        class_id: BigInt(7),
        student_id: BigInt(3),
      });
      // status nace en 'active' por DEFAULT de la BD, jamás se envía (AGENTS.md §7).
      expect(llamada.data).not.toHaveProperty('status');
      expect(resultado).toEqual({
        mensaje: mensajeUnidoAClase('Clase Unión Unit'),
        clase: { id: '7', nombre: 'Clase Unión Unit' },
        inscripcion: {
          estado: 'active',
          inscritoEn: '2026-10-19T10:00:00.000Z',
        },
      });
    });

    it('carrera concurrente: el P2002 del INSERT se propaga sin traducir (filtro global → 409)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(3) });
      prisma.classes.findFirst.mockResolvedValue(CLASE_PARA_UNIRSE);
      prisma.enrollments.findFirst.mockResolvedValue(null);
      prisma.enrollments.create.mockRejectedValue(errorDuplicado());

      await expect(
        classesService.unirse('AB12CD34', ESTUDIANTE),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });
});
