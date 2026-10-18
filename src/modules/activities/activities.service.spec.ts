import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import {
  ActivitiesService,
  MENSAJE_ACTIVIDAD_CREADA,
  MENSAJE_ACTUALIZACION_ACTIVIDAD_VACIA,
  MENSAJE_CIERRE_FUTURO,
  MENSAJE_PUBLICADA_NO_EDITABLE,
  MENSAJE_YA_PUBLICADA,
} from './activities.service';
import type {
  ListarActividadesPublicadasQueryDto,
  ListarActividadesQueryDto,
} from './dto/listar-actividades.dto';
import type { Pregunta } from './dto/preguntas.schema';

type ConsultaCreate = { data: object; select: object };
type ConsultaUpdate = { where: object; data: object; select?: object };
type ConsultaUnica = { where: object; select: object };
type ConsultaListado = { where: object; select: object; orderBy: object };
type ConsultaConteo = { where: object };

interface PrismaMock {
  activities: {
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
    findMany: jest.Mock<Promise<unknown[]>, [ConsultaListado]>;
    count: jest.Mock<Promise<number>, [ConsultaConteo]>;
    delete: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
  };
  enrollments: {
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
  };
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

/** Preguntas con la MISMA estructura del JSONB de la seed (§7). */
const PREGUNTAS_SEED: Pregunta[] = [
  {
    position: 1,
    type: 'test',
    prompt: 'What is x in 2x + 4 = 10?',
    score: 5,
    options: [
      { text: '2', is_correct: false },
      { text: '3', is_correct: true },
      { text: '4', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Complete: the solution of x + 1 = 5 is x = ___',
    score: 5,
    expected_answer: '4',
  },
];

const ACTIVIDAD = {
  id: BigInt(7),
  class_id: BigInt(1),
  title: 'Challenge 2: Fractions',
  description: 'Solve the following exercises',
  reward_coins: 120,
  status: 'draft' as const,
  questions: PREGUNTAS_SEED,
  published_at: null,
  closes_at: null,
  created_at: new Date('2026-10-12T10:00:00.000Z'),
  updated_at: new Date('2026-10-12T10:00:00.000Z'),
  deleted_at: null,
};

const ACTIVIDAD_LISTADO = {
  id: BigInt(7),
  title: 'Challenge 2: Fractions',
  status: 'draft' as const,
  reward_coins: 120,
  published_at: null,
  closes_at: null,
  created_at: new Date('2026-10-12T10:00:00.000Z'),
};

const CIERRA_EN_FUTURO = new Date(
  Date.now() + 86_400_000,
).toISOString() satisfies string;

/** Misma actividad, ya publicada (como la vería el estudiante inscrito). */
const ACTIVIDAD_PUBLICADA = {
  ...ACTIVIDAD,
  status: 'published' as const,
  published_at: new Date('2026-10-12T11:00:00.000Z'),
};

const RESPUESTA_ACTIVIDAD = {
  id: '7',
  claseId: '1',
  titulo: 'Challenge 2: Fractions',
  descripcion: 'Solve the following exercises',
  recompensaMonedas: 120,
  estado: 'draft',
  preguntas: PREGUNTAS_SEED,
  publicadaEn: null,
  cierraEn: null,
  creadoEn: '2026-10-12T10:00:00.000Z',
  actualizadoEn: '2026-10-12T10:00:00.000Z',
  eliminadaEn: null,
} as const;

/** Vista del estudiante: mismas preguntas SIN is_correct/expected_answer. */
const RESPUESTA_ACTIVIDAD_ESTUDIANTE = {
  id: '7',
  claseId: '1',
  titulo: 'Challenge 2: Fractions',
  descripcion: 'Solve the following exercises',
  recompensaMonedas: 120,
  estado: 'published',
  preguntas: [
    {
      position: 1,
      type: 'test',
      prompt: 'What is x in 2x + 4 = 10?',
      score: 5,
      options: [{ text: '2' }, { text: '3' }, { text: '4' }],
    },
    {
      position: 2,
      type: 'completion',
      prompt: 'Complete: the solution of x + 1 = 5 is x = ___',
      score: 5,
    },
  ],
  publicadaEn: '2026-10-12T11:00:00.000Z',
  cierraEn: null,
  creadoEn: '2026-10-12T10:00:00.000Z',
} as const;

function errorNoEncontrado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'An operation failed because it depends on one or more records that were required but not found',
    { code: 'P2025', clientVersion: 'test' },
  );
}

describe('ActivitiesService', () => {
  let activitiesService: ActivitiesService;
  let prisma: PrismaMock;
  let autorizacion: AutorizacionMock;

  beforeEach(() => {
    prisma = {
      activities: {
        create: jest.fn<Promise<unknown>, [ConsultaCreate]>(),
        findUniqueOrThrow: jest
          .fn<Promise<unknown>, [ConsultaUnica]>()
          .mockResolvedValue({
            status: 'draft',
            closes_at: null,
          }),
        update: jest.fn<Promise<unknown>, [ConsultaUpdate]>(),
        findMany: jest.fn<Promise<unknown[]>, [ConsultaListado]>(),
        count: jest.fn<Promise<number>, [ConsultaConteo]>(),
        delete: jest.fn<Promise<unknown>, [ConsultaUnica]>(),
      },
      enrollments: {
        findUniqueOrThrow: jest
          .fn<Promise<unknown>, [ConsultaUnica]>()
          .mockResolvedValue({
            status: 'active',
            class_id: BigInt(1),
          }),
      },
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    activitiesService = new ActivitiesService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
    );
  });

  describe('crear', () => {
    it('crea la actividad EN BORRADOR sin enviar status ni fechas: son defaults de la BD', async () => {
      prisma.activities.create.mockResolvedValue(ACTIVIDAD);

      const resultado = await activitiesService.crear(
        '1',
        {
          titulo: 'Challenge 2: Fractions',
          descripcion: 'Solve the following exercises',
          recompensaMonedas: 120,
          preguntas: PREGUNTAS_SEED,
        },
        PROFESOR,
      );

      const data = prisma.activities.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({
        class_id: BigInt(1),
        title: 'Challenge 2: Fractions',
        description: 'Solve the following exercises',
        reward_coins: 120,
        questions: PREGUNTAS_SEED,
      });
      // draft/published_at/deleted_at jamás viajan en el INSERT: toda
      // actividad nace en borrador por DEFAULT de la BD.
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('published_at');
      expect(data).not.toHaveProperty('deleted_at');
      expect(data).not.toHaveProperty('created_at');
      expect(data).not.toHaveProperty('updated_at');

      expect(resultado).toEqual({
        mensaje: MENSAJE_ACTIVIDAD_CREADA,
        actividad: RESPUESTA_ACTIVIDAD,
      });
    });

    it('omite description y reward_coins del INSERT cuando no viajan (defaults de la BD)', async () => {
      prisma.activities.create.mockResolvedValue({
        ...ACTIVIDAD,
        description: null,
        reward_coins: 0,
      });

      await activitiesService.crear(
        '1',
        { titulo: 'Challenge 2: Fractions', preguntas: PREGUNTAS_SEED },
        PROFESOR,
      );

      const data = prisma.activities.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('description');
      expect(data).not.toHaveProperty('reward_coins');
      expect(data).not.toHaveProperty('closes_at');
    });

    it('convierte cierraEn (ISO 8601) a closes_at en el INSERT', async () => {
      prisma.activities.create.mockResolvedValue(ACTIVIDAD);

      await activitiesService.crear(
        '1',
        {
          titulo: 'Challenge 2: Fractions',
          preguntas: PREGUNTAS_SEED,
          cierraEn: CIERRA_EN_FUTURO,
        },
        PROFESOR,
      );

      const data = prisma.activities.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.closes_at).toBeInstanceOf(Date);
      expect((data.closes_at as Date).toISOString()).toBe(CIERRA_EN_FUTURO);
    });

    it('re-verifica con AutorizacionService que la clase sea suya (segunda capa)', async () => {
      prisma.activities.create.mockResolvedValue(ACTIVIDAD);

      await activitiesService.crear(
        '1',
        { titulo: 'Challenge 2: Fractions', preguntas: PREGUNTAS_SEED },
        PROFESOR,
      );

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '1',
        PROFESOR,
      );
    });

    it('clase ajena o inexistente: propaga el 404 sin crear nada', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        activitiesService.crear(
          '999',
          { titulo: 'Challenge 2: Fractions', preguntas: PREGUNTAS_SEED },
          PROFESOR,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('id de clase no numérico: 404 estándar sin consultar la BD de escritura', async () => {
      await expect(
        activitiesService.crear(
          'abc',
          { titulo: 'Challenge 2: Fractions', preguntas: PREGUNTAS_SEED },
          PROFESOR,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 preguntas vacías (la actividad nace con su JSONB)', async () => {
      await expect(
        activitiesService.crear(
          '1',
          { titulo: 'Challenge 2: Fractions', preguntas: [] },
          PROFESOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 una pregunta test sin options', async () => {
      const invalidas = [
        { position: 1, type: 'test', prompt: '¿2+2?', score: 5 },
      ];

      await expect(
        activitiesService.crear(
          '1',
          { titulo: 'Challenge 2: Fractions', preguntas: invalidas },
          PROFESOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 una pregunta test sin opción correcta única', async () => {
      const invalidas: unknown[] = [
        {
          position: 1,
          type: 'test',
          prompt: '¿2+2?',
          score: 5,
          options: [
            { text: '4', is_correct: true },
            { text: '5', is_correct: true },
          ],
        },
      ];

      await expect(
        activitiesService.crear(
          '1',
          { titulo: 'Challenge 2: Fractions', preguntas: invalidas },
          PROFESOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un completion sin expected_answer', async () => {
      const invalidas: unknown[] = [
        { position: 1, type: 'completion', prompt: 'x = ___', score: 5 },
      ];

      await expect(
        activitiesService.crear(
          '1',
          { titulo: 'Challenge 2: Fractions', preguntas: invalidas },
          PROFESOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('rechaza con 400 posiciones no secuenciales desde 1', async () => {
      const invalidas: unknown[] = [
        {
          position: 2,
          type: 'file',
          prompt: 'Adjunta tu solución',
          score: 5,
        },
      ];

      await expect(
        activitiesService.crear(
          '1',
          { titulo: 'Challenge 2: Fractions', preguntas: invalidas },
          PROFESOR,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.create).not.toHaveBeenCalled();
    });

    it('el mensaje de error de zod indica la ubicación del problema', async () => {
      const invalidas: unknown[] = [
        { position: 1, type: 'file', prompt: '', score: 5 },
      ];

      const promesa = activitiesService.crear(
        '1',
        { titulo: 'Challenge 2: Fractions', preguntas: invalidas },
        PROFESOR,
      );

      await expect(promesa).rejects.toThrow(BadRequestException);
      await expect(promesa).rejects.toThrow(/prompt/);
    });
  });

  describe('listar', () => {
    const query = (
      sobrescrituras: Partial<ListarActividadesQueryDto> = {},
    ): ListarActividadesQueryDto => ({ ...sobrescrituras });

    it('re-verifica la pertenencia de la clase antes de consultar', async () => {
      prisma.activities.findMany.mockResolvedValue([]);
      prisma.activities.count.mockResolvedValue(0);

      await activitiesService.listar('1', query(), PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '1',
        PROFESOR,
      );
    });

    it('lista SIN filtro de estado cuando ?estado no viaja', async () => {
      prisma.activities.findMany.mockResolvedValue([ACTIVIDAD_LISTADO]);
      prisma.activities.count.mockResolvedValue(1);

      const resultado = await activitiesService.listar('1', query(), PROFESOR);

      expect(prisma.activities.findMany.mock.calls[0][0].where).toEqual({
        class_id: BigInt(1),
      });
      expect(prisma.activities.count.mock.calls[0][0].where).toEqual({
        class_id: BigInt(1),
      });
      expect(resultado).toEqual({
        data: [
          {
            id: '7',
            titulo: 'Challenge 2: Fractions',
            estado: 'draft',
            recompensaMonedas: 120,
            publicadaEn: null,
            cierraEn: null,
            creadoEn: '2026-10-12T10:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 20 },
      });
    });

    it('filtra por ?estado cuando viaja (enum real activity_status)', async () => {
      prisma.activities.findMany.mockResolvedValue([]);
      prisma.activities.count.mockResolvedValue(0);

      await activitiesService.listar(
        '1',
        query({ estado: 'published' }),
        PROFESOR,
      );

      expect(prisma.activities.findMany.mock.calls[0][0].where).toEqual({
        class_id: BigInt(1),
        status: 'published',
      });
    });

    it('pagina con skip/take según page y limit (defaults 1 y 20)', async () => {
      prisma.activities.findMany.mockResolvedValue([]);
      prisma.activities.count.mockResolvedValue(0);

      await activitiesService.listar(
        '1',
        query({ page: 3, limit: 10 }),
        PROFESOR,
      );

      expect(prisma.activities.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );

      await activitiesService.listar('1', query(), PROFESOR);
      expect(prisma.activities.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('clase ajena: propaga el 404 sin consultar la BD', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        activitiesService.listar('999', query(), PROFESOR),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.activities.findMany).not.toHaveBeenCalled();
      expect(prisma.activities.count).not.toHaveBeenCalled();
    });
  });

  describe('detalle', () => {
    it('re-verifica la pertenencia (regla actividadVisible) y consulta por su id', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue(ACTIVIDAD);

      await activitiesService.detalle('7', PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividadVisible',
        '7',
        PROFESOR,
      );
      expect(prisma.activities.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        select: expect.any(Object),
      });
    });

    it('teacher: devuelve el detalle completo con el JSONB de preguntas (vista del dueño)', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue(ACTIVIDAD);

      const resultado = await activitiesService.detalle('7', PROFESOR);

      expect(resultado).toEqual(RESPUESTA_ACTIVIDAD);
    });

    it('student: devuelve el DTO sanitizado SIN is_correct ni expected_answer', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue(
        ACTIVIDAD_PUBLICADA,
      );

      const resultado = await activitiesService.detalle('7', ESTUDIANTE);

      expect(resultado).toEqual(RESPUESTA_ACTIVIDAD_ESTUDIANTE);
      // Doble verificación profunda: ninguna clave sensible en ninguna
      // parte de la respuesta (AGENTS.md §9.5).
      expect(JSON.stringify(resultado)).not.toContain('is_correct');
      expect(JSON.stringify(resultado)).not.toContain('expected_answer');
    });

    it('student: las opciones de test solo llevan text', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue(
        ACTIVIDAD_PUBLICADA,
      );

      const resultado = await activitiesService.detalle('7', ESTUDIANTE);

      const primera = (resultado as { preguntas: { options?: unknown[] }[] })
        .preguntas[0];
      expect(primera.options).toEqual([
        { text: '2' },
        { text: '3' },
        { text: '4' },
      ]);
    });

    it('propaga el P2025 de una actividad inexistente (el filtro global lo traduce a 404)', async () => {
      prisma.activities.findUniqueOrThrow.mockRejectedValue(
        errorNoEncontrado(),
      );

      const promesa = activitiesService.detalle('999', PROFESOR);
      await expect(promesa).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  describe('listarPublicadas', () => {
    const query = (
      sobrescrituras: Partial<ListarActividadesPublicadasQueryDto> = {},
    ): ListarActividadesPublicadasQueryDto => ({ ...sobrescrituras });

    it('re-verifica la pertenencia de la inscripción antes de consultar', async () => {
      prisma.activities.findMany.mockResolvedValue([]);
      prisma.activities.count.mockResolvedValue(0);

      await activitiesService.listarPublicadas('1', query(), ESTUDIANTE);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'inscripcion',
        '1',
        ESTUDIANTE,
      );
    });

    it('solo consulta actividades PUBLISHED de la clase de la inscripción', async () => {
      prisma.activities.findMany.mockResolvedValue([ACTIVIDAD_LISTADO]);
      prisma.activities.count.mockResolvedValue(1);

      await activitiesService.listarPublicadas('1', query(), ESTUDIANTE);

      const where = { class_id: BigInt(1), status: 'published' };
      expect(prisma.activities.findMany.mock.calls[0][0].where).toEqual(where);
      expect(prisma.activities.count.mock.calls[0][0].where).toEqual(where);
    });

    it('inscripción retirada o bloqueada: 404 estándar sin listar nada', async () => {
      prisma.enrollments.findUniqueOrThrow.mockResolvedValue({
        status: 'withdrawn',
        class_id: BigInt(1),
      });

      await expect(
        activitiesService.listarPublicadas('1', query(), ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.findMany).not.toHaveBeenCalled();
      expect(prisma.activities.count).not.toHaveBeenCalled();
    });

    it('pagina con skip/take y devuelve { data, meta } sin preguntas por fila', async () => {
      prisma.activities.findMany.mockResolvedValue([ACTIVIDAD_LISTADO]);
      prisma.activities.count.mockResolvedValue(1);

      const resultado = await activitiesService.listarPublicadas(
        '1',
        query({ page: 2, limit: 10 }),
        ESTUDIANTE,
      );

      expect(prisma.activities.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(resultado).toEqual({
        data: [
          {
            id: '7',
            titulo: 'Challenge 2: Fractions',
            estado: 'draft',
            recompensaMonedas: 120,
            publicadaEn: null,
            cierraEn: null,
            creadoEn: '2026-10-12T10:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 2, limit: 10 },
      });
      expect(JSON.stringify(resultado)).not.toContain('is_correct');
    });

    it('inscripción ajena: propaga el 404 de la pertenencia sin consultar', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        activitiesService.listarPublicadas('2', query(), ESTUDIANTE),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.enrollments.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.activities.findMany).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('en borrador: renombra tocando solo title en el UPDATE', async () => {
      prisma.activities.update.mockResolvedValue({
        ...ACTIVIDAD,
        title: 'Challenge 2: Fractions (v2)',
      });

      const resultado = await activitiesService.actualizar(
        '7',
        { titulo: 'Challenge 2: Fractions (v2)' },
        PROFESOR,
      );

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividad',
        '7',
        PROFESOR,
      );
      expect(prisma.activities.update).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        data: { title: 'Challenge 2: Fractions (v2)' },
        select: expect.any(Object),
      });
      expect(resultado.titulo).toBe('Challenge 2: Fractions (v2)');
    });

    it('en borrador: reemplaza las preguntas tras validarlas con zod', async () => {
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.actualizar(
        '7',
        { preguntas: PREGUNTAS_SEED },
        PROFESOR,
      );

      expect(prisma.activities.update.mock.calls[0][0].data).toEqual({
        questions: PREGUNTAS_SEED,
      });
    });

    it('en borrador: setea closes_at con cierraEn futuro', async () => {
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.actualizar(
        '7',
        { cierraEn: CIERRA_EN_FUTURO },
        PROFESOR,
      );

      const data = prisma.activities.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.closes_at).toBeInstanceOf(Date);
    });

    it('rechaza con 422 un cierraEn pasado (aunque esté en borrador)', async () => {
      const pasado = new Date(Date.now() - 86_400_000).toISOString();

      await expect(
        activitiesService.actualizar('7', { cierraEn: pasado }, PROFESOR),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_CIERRE_FUTURO),
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('publicada: solo acepta cierraEn — tocar cualquier otra cosa es 409', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'published',
      });

      await expect(
        activitiesService.actualizar('7', { titulo: 'Nuevo título' }, PROFESOR),
      ).rejects.toThrow(new ConflictException(MENSAJE_PUBLICADA_NO_EDITABLE));
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('publicada: cierraEn futuro SÍ pasa y solo toca closes_at', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'published',
      });
      prisma.activities.update.mockResolvedValue({
        ...ACTIVIDAD,
        status: 'published',
      });

      await activitiesService.actualizar(
        '7',
        { cierraEn: CIERRA_EN_FUTURO },
        PROFESOR,
      );

      expect(prisma.activities.update.mock.calls[0][0].data).toEqual({
        closes_at: expect.any(Date),
      });
    });

    it('eliminada: responde el 404 estándar (para mutaciones ya no existe)', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'deleted',
      });

      await expect(
        activitiesService.actualizar('7', { titulo: 'X' }, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un cuerpo sin campos para actualizar', async () => {
      await expect(
        activitiesService.actualizar('7', {}, PROFESOR),
      ).rejects.toThrow(
        new BadRequestException(MENSAJE_ACTUALIZACION_ACTIVIDAD_VACIA),
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('rechaza con 400 preguntas inválidas sin tocar la BD', async () => {
      const invalidas: unknown[] = [
        { position: 1, type: 'minigame', prompt: 'Juega', score: 0 },
      ];

      await expect(
        activitiesService.actualizar('7', { preguntas: invalidas }, PROFESOR),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });
  });

  describe('publicar', () => {
    it('pasa de draft a published seteando published_at (ningún trigger lo hace)', async () => {
      prisma.activities.update.mockResolvedValue({
        ...ACTIVIDAD,
        status: 'published',
        published_at: new Date('2026-10-12T11:00:00.000Z'),
      });

      const resultado = await activitiesService.publicar('7', {}, PROFESOR);

      expect(prisma.activities.update).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        data: { status: 'published', published_at: expect.any(Date) },
        select: expect.any(Object),
      });
      expect(resultado.estado).toBe('published');
      expect(resultado.publicadaEn).toBe('2026-10-12T11:00:00.000Z');
    });

    it('con cierraEn: publica fijando también la fecha de cierre', async () => {
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.publicar(
        '7',
        { cierraEn: CIERRA_EN_FUTURO },
        PROFESOR,
      );

      const data = prisma.activities.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({
        status: 'published',
        published_at: expect.any(Date),
        closes_at: expect.any(Date),
      });
    });

    it('sin cierraEn: conserva la fecha de cierre que ya tenía', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'draft',
        closes_at: new Date(Date.now() + 3_600_000),
      });
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.publicar('7', {}, PROFESOR);

      const data = prisma.activities.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('closes_at');
    });

    it('ya publicada: 409 sin tocar la BD de escritura', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'published',
        closes_at: null,
      });

      await expect(
        activitiesService.publicar('7', {}, PROFESOR),
      ).rejects.toThrow(new ConflictException(MENSAJE_YA_PUBLICADA));
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('eliminada: 404 estándar', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'deleted',
        closes_at: null,
      });

      await expect(
        activitiesService.publicar('7', {}, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('rechaza con 422 un cierraEn pasado (ck_activity_dates: closes_at > published_at)', async () => {
      const pasado = new Date(Date.now() - 86_400_000).toISOString();

      await expect(
        activitiesService.publicar('7', { cierraEn: pasado }, PROFESOR),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_CIERRE_FUTURO),
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('rechaza con 422 si la fecha de cierre heredada del borrador ya pasó', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'draft',
        closes_at: new Date(Date.now() - 86_400_000),
      });

      await expect(
        activitiesService.publicar('7', {}, PROFESOR),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_CIERRE_FUTURO),
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('re-verifica la pertenencia de la actividad antes de publicar', async () => {
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.publicar('7', {}, PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividad',
        '7',
        PROFESOR,
      );
    });
  });

  describe('eliminar', () => {
    it('borra LÓGICAMENTE: status deleted + deleted_at, jamás un DELETE físico', async () => {
      prisma.activities.update.mockResolvedValue({
        ...ACTIVIDAD,
        status: 'deleted',
        deleted_at: new Date('2026-10-12T12:00:00.000Z'),
      });

      await activitiesService.eliminar('7', PROFESOR);

      expect(prisma.activities.update).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        data: { status: 'deleted', deleted_at: expect.any(Date) },
        select: expect.any(Object),
      });
      expect(prisma.activities.delete).not.toHaveBeenCalled();
    });

    it('también elimina una actividad publicada (published → deleted)', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'published',
      });
      prisma.activities.update.mockResolvedValue(ACTIVIDAD);

      await activitiesService.eliminar('7', PROFESOR);

      expect(prisma.activities.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'deleted', deleted_at: expect.any(Date) },
        }),
      );
    });

    it('eliminar dos veces: 404 estándar (ya no existe para mutaciones)', async () => {
      prisma.activities.findUniqueOrThrow.mockResolvedValue({
        status: 'deleted',
      });

      await expect(activitiesService.eliminar('7', PROFESOR)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });

    it('actividad ajena: propaga el 404 de la pertenencia sin actualizar', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(activitiesService.eliminar('999', PROFESOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.activities.update).not.toHaveBeenCalled();
    });
  });
});
