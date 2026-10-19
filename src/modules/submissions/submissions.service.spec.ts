import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import {
  SubmissionsService,
  MENSAJE_ACTIVIDAD_CERRADA,
  MENSAJE_BORRADOR_GUARDADO,
  MENSAJE_ENTREGA_CALIFICADA,
  MENSAJE_ENTREGA_CALIFICADA_PROFESOR,
  MENSAJE_ENTREGA_DUPLICADA,
  MENSAJE_ENTREGA_NO_PENDIENTE,
  MENSAJE_ENTREGA_PENDIENTE,
  MENSAJE_ENTREGA_RECHAZADA,
  MENSAJE_ENTREGA_UMBRAL,
  MENSAJE_ENTREGA_YA_ENVIADA,
  MENSAJE_PUNTAJE_FUERA_DE_RANGO,
  MENSAJE_PUNTAJE_NO_EN_RECHAZO,
  MENSAJE_PUNTAJE_REQUERIDO,
} from './submissions.service';
import type { Pregunta } from '../activities/dto/preguntas.schema';
import type { CrearEntregaDto } from './dto/crear-entrega.dto';
import type { GuardarBorradorDto } from './dto/guardar-borrador.dto';
import type { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import type { AdjuntarArchivoDto } from './dto/adjuntar-archivo.dto';
import type { ArchivoRespuesta } from './dto/respuestas.schema';
import type { ArchivosService } from './archivos.service';
import {
  MENSAJE_ARCHIVO_DEMASIADO_GRANDE,
  MENSAJE_ARCHIVOS_ADJUNTADOS,
  MENSAJE_ARCHIVO_AJENO,
  MENSAJE_MIME_INVALIDO,
  MENSAJE_PREGUNTA_NO_ES_FILE,
  MENSAJE_SIN_ARCHIVOS,
} from './validar-archivo';

type ConsultaCreate = { data: object; select: object };
type ConsultaUpdate = { where: object; data: object; select: object };
type ConsultaUpdateMany = { where: object; data: object };
type ConsultaUnica = { where: object; select: object };
type ConsultaActividad = { where: object; select: object };
type ConsultaInscripcion = { where: object; select: object };
type ConsultaMuchos = {
  where: object;
  select: object;
  orderBy: object;
  skip: number;
  take: number;
};
type ConsultaConteo = { where: object };
type TransaccionCallback = (tx: unknown) => Promise<unknown>;

interface PrismaMock {
  $transaction: jest.Mock<Promise<unknown>, [TransaccionCallback]>;
  activities: {
    findFirst: jest.Mock<Promise<unknown>, [ConsultaActividad]>;
  };
  enrollments: {
    findFirst: jest.Mock<Promise<unknown>, [ConsultaInscripcion]>;
  };
  submissions: {
    findUnique: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
    findUniqueOrThrow: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
    findFirst: jest.Mock<Promise<unknown>, [ConsultaUnica]>;
    updateMany: jest.Mock<Promise<{ count: number }>, [ConsultaUpdateMany]>;
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
    findMany: jest.Mock<Promise<unknown>, [ConsultaMuchos]>;
    count: jest.Mock<Promise<number>, [ConsultaConteo]>;
  };
}

interface AutorizacionMock {
  verificarPertenencia: jest.Mock<
    Promise<void>,
    [string, string, UsuarioAutenticado]
  >;
}

/** Mock del almacén de archivos: disco y configuración (ArchivosService). */
interface ArchivosMock {
  limiteBytes: jest.Mock<number, []>;
  guardar: jest.Mock<
    Promise<ArchivoRespuesta>,
    [bigint, bigint, Buffer, ArchivoRespuesta['mime']]
  >;
  verificar: jest.Mock<Promise<void>, [bigint, bigint, ArchivoRespuesta]>;
  leer: jest.Mock<Promise<Buffer | null>, [bigint, string]>;
}

const ESTUDIANTE: UsuarioAutenticado = {
  id: '3',
  username: 'est.perez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

/** Profesor dueño de la actividad 7 (clase 1) para la cola. */
const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
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

/** Pregunta file: la subida de archivos está pendiente (AGENTS.md §2). */
const PREGUNTA_FILE: Pregunta = {
  position: 1,
  type: 'file',
  prompt: 'Sube tu solución como PDF',
  score: 5,
};

const ACTIVIDAD = {
  class_id: BigInt(1),
  closes_at: null,
  questions: PREGUNTAS_SEED,
};

const INSCRIPCION = { id: BigInt(1) };

/** Envío completo y CORRECTO: 2/2 = 100% ≥ umbral del 80%. */
const DTO: CrearEntregaDto = {
  respuestas: [
    { question_position: 1, option: '3' },
    { question_position: 2, text: '4' },
  ],
};

/** Autosave parcial del borrador: solo la primera pregunta. */
const DTO_BORRADOR: GuardarBorradorDto = {
  respuestas: [{ question_position: 1, option: '3' }],
};

/** answers tal como se guardan en el borrador: SIN veredicto (§9.5). */
const RESPUESTAS_BORRADOR = [{ question_position: 1, option: '3' }];

/** answers tal como se guardan al evaluar DTO (veredicto incluido). */
const RESPUESTAS_CALIFICADAS_OK = [
  { question_position: 1, option: '3', is_correct: true, score: 5 },
  { question_position: 2, text: '4', is_correct: true, score: 5 },
];

/** Fila del borrador tal como la devuelven las consultas. */
const BORRADOR = {
  id: BigInt(11),
  activity_id: BigInt(7),
  status: 'in_progress' as const,
  submitted_at: null,
  score: null,
  coins_awarded: 0,
  feedback: null,
  answers: RESPUESTAS_BORRADOR,
};

const ENTREGA_SUBMITTED = {
  id: BigInt(11),
  activity_id: BigInt(7),
  status: 'submitted' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  score: null,
  coins_awarded: 0,
  feedback: null,
  answers: RESPUESTAS_CALIFICADAS_OK,
};

/** Fila devuelta por el UPDATE a graded (con lo que seteó el trigger). */
const ENTREGA_CALIFICADA = {
  id: BigInt(11),
  activity_id: BigInt(7),
  status: 'graded' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  score: new Prisma.Decimal(10),
  coins_awarded: 120,
  feedback: null,
  answers: RESPUESTAS_CALIFICADAS_OK,
};

/**
 * Filas de la COLA tal como las devuelve findMany con el join a users
 * (CAMPOS_ENTREGA_COLA): sin answers/activity_id — el resumen del
 * profesor. La calificada se envió ANTES que la pendiente: FIFO.
 */
const FILA_COLA_GRADED = {
  id: BigInt(20),
  status: 'graded' as const,
  submitted_at: new Date('2026-10-16T09:00:00.000Z'),
  score: new Prisma.Decimal(10),
  coins_awarded: 120,
  enrollments: {
    users: {
      id: BigInt(4),
      username: 'est.gomez',
      first_name: 'María',
      last_name: 'Gómez',
    },
  },
};

const FILA_COLA_SUBMITTED = {
  id: BigInt(21),
  status: 'submitted' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  score: null,
  coins_awarded: 0,
  enrollments: {
    users: {
      id: BigInt(3),
      username: 'est.perez',
      first_name: 'Juan',
      last_name: 'Pérez',
    },
  },
};

/** Borrador en la cola: sin fecha de envío (va al final del FIFO). */
const FILA_COLA_BORRADOR = {
  id: BigInt(22),
  status: 'in_progress' as const,
  submitted_at: null,
  score: null,
  coins_awarded: 0,
  enrollments: {
    users: {
      id: BigInt(3),
      username: 'est.perez',
      first_name: 'Juan',
      last_name: 'Pérez',
    },
  },
};

/**
 * Fila de la VISTA DE REVISIÓN (CAMPOS_ENTREGA_DETALLE): lo que ve el
 * profesor de una entrega pendiente — answers con veredicto, sin
 * calificación aún. El join es igual al de la cola.
 */
const DETALLE_SUBMITTED = {
  id: BigInt(21),
  status: 'submitted' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  graded_at: null,
  score: null,
  coins_awarded: 0,
  feedback: null,
  answers: RESPUESTAS_CALIFICADAS_OK,
  enrollments: {
    users: {
      id: BigInt(3),
      username: 'est.perez',
      first_name: 'Juan',
      last_name: 'Pérez',
    },
  },
};

/** Tras calificar como graded: graded_at/coins_awarded los escribió el trigger. */
const DETALLE_GRADED = {
  id: BigInt(21),
  status: 'graded' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  graded_at: new Date('2026-10-18T12:00:00.000Z'),
  score: new Prisma.Decimal(7.5),
  coins_awarded: 120,
  feedback: 'Bien en general; revisa el planteo del ejercicio 1.',
  answers: RESPUESTAS_CALIFICADAS_OK,
  enrollments: DETALLE_SUBMITTED.enrollments,
};

/** Tras rechazar: SIN graded_at (el trigger solo lo marca en graded) ni monedas. */
const DETALLE_REJECTED = {
  id: BigInt(21),
  status: 'rejected' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  graded_at: null,
  score: null,
  coins_awarded: 0,
  feedback: 'La respuesta del ejercicio 2 no corresponde: reenvíala.',
  answers: RESPUESTAS_CALIFICADAS_OK,
  enrollments: DETALLE_SUBMITTED.enrollments,
};

function errorP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`activity_id`,`enrollment_id`)',
    { code: 'P2002', clientVersion: 'test' },
  );
}

describe('SubmissionsService', () => {
  let submissionsService: SubmissionsService;
  let prisma: PrismaMock;
  let autorizacion: AutorizacionMock;
  let archivos: ArchivosMock;

  beforeEach(() => {
    prisma = {
      // La transacción interactiva recibe el propio mock como cliente
      // transaccional: los create/update del flujo son los mismos mocks.
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(prisma)),
      activities: {
        findFirst: jest
          .fn<Promise<unknown>, [ConsultaActividad]>()
          .mockResolvedValue(ACTIVIDAD),
      },
      enrollments: {
        findFirst: jest
          .fn<Promise<unknown>, [ConsultaInscripcion]>()
          .mockResolvedValue(INSCRIPCION),
      },
      submissions: {
        findUnique: jest
          .fn<Promise<unknown>, [ConsultaUnica]>()
          .mockResolvedValue(null),
        findUniqueOrThrow: jest
          .fn<Promise<unknown>, [ConsultaUnica]>()
          .mockResolvedValue(BORRADOR),
        findFirst: jest
          .fn<Promise<unknown>, [ConsultaUnica]>()
          .mockResolvedValue(null),
        updateMany: jest
          .fn<Promise<{ count: number }>, [ConsultaUpdateMany]>()
          .mockResolvedValue({ count: 0 }),
        create: jest
          .fn<Promise<unknown>, [ConsultaCreate]>()
          .mockResolvedValue(ENTREGA_SUBMITTED),
        update: jest
          .fn<Promise<unknown>, [ConsultaUpdate]>()
          .mockResolvedValue(ENTREGA_CALIFICADA),
        findMany: jest
          .fn<Promise<unknown>, [ConsultaMuchos]>()
          .mockResolvedValue([]),
        count: jest
          .fn<Promise<number>, [ConsultaConteo]>()
          .mockResolvedValue(0),
      },
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    archivos = {
      limiteBytes: jest.fn<number, []>().mockReturnValue(10_485_760),
      guardar: jest
        .fn<
          Promise<ArchivoRespuesta>,
          [bigint, bigint, Buffer, ArchivoRespuesta['mime']]
        >()
        .mockImplementation(
          async (_actividadId, _inscripcionId, contenido, mime) => ({
            path: `7/1/11111111-1111-4111-8111-111111111111.${
              mime === 'application/pdf'
                ? 'pdf'
                : mime === 'image/jpeg'
                  ? 'jpg'
                  : 'png'
            }`,
            mime,
            bytes: contenido.length,
          }),
        ),
      verificar: jest
        .fn<Promise<void>, [bigint, bigint, ArchivoRespuesta]>()
        .mockResolvedValue(undefined),
      leer: jest
        .fn<Promise<Buffer | null>, [bigint, string]>()
        .mockResolvedValue(null),
    };
    submissionsService = new SubmissionsService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
      archivos as unknown as ArchivosService,
    );
  });

  describe('guardarBorrador (PUT)', () => {
    it('crea el borrador in_progress cuando no existe ninguna entrega', async () => {
      const resultado = await submissionsService.guardarBorrador(
        '7',
        DTO_BORRADOR,
        ESTUDIANTE,
      );

      const data = prisma.submissions.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({
        activity_id: BigInt(7),
        enrollment_id: BigInt(1),
        status: 'in_progress',
        answers: RESPUESTAS_BORRADOR,
      });
      // El borrador no se envía: submitted_at/score jamás viajan y las
      // respuestas van SIN veredicto (AGENTS.md §9.5).
      expect(data).not.toHaveProperty('submitted_at');
      expect(data).not.toHaveProperty('score');
      expect(JSON.stringify(data.answers)).not.toContain('is_correct');

      expect(resultado).toEqual({
        mensaje: MENSAJE_BORRADOR_GUARDADO,
        entrega: {
          id: '11',
          actividadId: '7',
          estado: 'in_progress',
          entregadoEn: null,
          puntaje: null,
          monedasOtorgadas: 0,
          respuestas: RESPUESTAS_BORRADOR,
        },
      });
    });

    it('actualiza el borrador existente sin crear filas ni pre-checks', async () => {
      prisma.submissions.updateMany.mockResolvedValue({ count: 1 });

      const resultado = await submissionsService.guardarBorrador(
        '7',
        DTO_BORRADOR,
        ESTUDIANTE,
      );

      // El UPDATE es atómico y SOLO toca borradores (filtro por estado).
      const where = prisma.submissions.updateMany.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where).toEqual({
        activity_id: BigInt(7),
        enrollment_id: BigInt(1),
        status: 'in_progress',
      });
      expect(prisma.submissions.create).not.toHaveBeenCalled();
      expect(prisma.submissions.findUnique).not.toHaveBeenCalled();
      expect(resultado.entrega.estado).toBe('in_progress');
    });

    it('acepta un borrador VACÍO (el estudiante aún no responde nada)', async () => {
      await submissionsService.guardarBorrador(
        '7',
        { respuestas: [] },
        ESTUDIANTE,
      );

      const data = prisma.submissions.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.answers).toEqual([]);
    });

    it('409 si la entrega ya fue enviada: jamás se baja de submitted a borrador', async () => {
      prisma.submissions.findUnique.mockResolvedValue({ status: 'submitted' });

      await expect(
        submissionsService.guardarBorrador('7', DTO_BORRADOR, ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA));
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('409 si la entrega ya está calificada', async () => {
      prisma.submissions.findUnique.mockResolvedValue({ status: 'graded' });

      await expect(
        submissionsService.guardarBorrador('7', DTO_BORRADOR, ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA));
    });

    it('carrera con otra autosave (P2002 al crear): reintenta la actualización y guarda', async () => {
      prisma.submissions.create.mockRejectedValueOnce(errorP2002());
      prisma.submissions.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const resultado = await submissionsService.guardarBorrador(
        '7',
        DTO_BORRADOR,
        ESTUDIANTE,
      );

      expect(prisma.submissions.updateMany).toHaveBeenCalledTimes(2);
      expect(resultado.mensaje).toBe(MENSAJE_BORRADOR_GUARDADO);
    });

    it('carrera con un envío simultáneo (P2002 y ya no es borrador): 409', async () => {
      prisma.submissions.create.mockRejectedValueOnce(errorP2002());
      prisma.submissions.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(
        submissionsService.guardarBorrador('7', DTO_BORRADOR, ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA));
    });

    it('actividad cerrada: 422 sin tocar submissions', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        closes_at: new Date(Date.now() - 86_400_000),
      });

      await expect(
        submissionsService.guardarBorrador('7', DTO_BORRADOR, ESTUDIANTE),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_ACTIVIDAD_CERRADA),
      );
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('respuesta con posición inexistente: 400 sin tocar submissions', async () => {
      await expect(
        submissionsService.guardarBorrador(
          '7',
          { respuestas: [{ question_position: 99, option: '3' }] },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('re-verifica con AutorizacionService la regla actividadVisible (segunda capa)', async () => {
      prisma.submissions.updateMany.mockResolvedValue({ count: 1 });

      await submissionsService.guardarBorrador('7', DTO_BORRADOR, ESTUDIANTE);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividadVisible',
        '7',
        ESTUDIANTE,
      );
    });
  });

  describe('miEntrega (GET)', () => {
    it('devuelve el borrador tal cual, SIN veredictos (retomada)', async () => {
      prisma.submissions.findUnique.mockResolvedValue(BORRADOR);

      const resultado = await submissionsService.miEntrega('7', ESTUDIANTE);

      expect(resultado).toEqual({
        id: '11',
        actividadId: '7',
        estado: 'in_progress',
        entregadoEn: null,
        puntaje: null,
        monedasOtorgadas: 0,
        respuestas: RESPUESTAS_BORRADOR,
      });
      expect(JSON.stringify(resultado)).not.toContain('is_correct');
      expect(JSON.stringify(resultado)).not.toContain('"score"');
    });

    it('devuelve la entrega calificada con veredictos, puntaje y monedas', async () => {
      prisma.submissions.findUnique.mockResolvedValue(ENTREGA_CALIFICADA);

      const resultado = await submissionsService.miEntrega('7', ESTUDIANTE);

      expect(resultado).toEqual({
        id: '11',
        actividadId: '7',
        estado: 'graded',
        entregadoEn: '2026-10-17T10:00:00.000Z',
        puntaje: 10,
        monedasOtorgadas: 120,
        feedback: null,
        respuestas: RESPUESTAS_CALIFICADAS_OK,
      });
    });

    it('sin entrega todavía: 404 estándar (anti-enumeración)', async () => {
      prisma.submissions.findUnique.mockResolvedValue(null);

      await expect(
        submissionsService.miEntrega('7', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('la actividad cerrada no impide VER la entrega (solo bloquea guardar/enviar)', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        closes_at: new Date(Date.now() - 86_400_000),
      });
      prisma.submissions.findUnique.mockResolvedValue(BORRADOR);

      const resultado = await submissionsService.miEntrega('7', ESTUDIANTE);

      expect(resultado.estado).toBe('in_progress');
    });
  });

  describe('entregar (POST)', () => {
    it('auto-califica en transacción: INSERT submitted → UPDATE graded con el puntaje', async () => {
      const resultado = await submissionsService.entregar('7', DTO, ESTUDIANTE);

      // Sin borrador: INSERT directo como submitted.
      const dataCreate = prisma.submissions.create.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(dataCreate).toEqual({
        activity_id: BigInt(7),
        enrollment_id: BigInt(1),
        status: 'submitted',
        submitted_at: expect.any(Date),
        answers: RESPUESTAS_CALIFICADAS_OK,
      });
      expect(dataCreate).not.toHaveProperty('score');
      expect(dataCreate).not.toHaveProperty('graded_at');
      expect(dataCreate).not.toHaveProperty('coins_awarded');

      const dataUpdate = prisma.submissions.update.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(dataUpdate).toEqual({
        status: 'graded',
        score: 10,
      });
      expect(prisma.submissions.update.mock.calls[0][0].where).toEqual({
        id: BigInt(11),
      });

      expect(resultado).toEqual({
        mensaje: MENSAJE_ENTREGA_CALIFICADA,
        entrega: {
          id: '11',
          actividadId: '7',
          estado: 'graded',
          entregadoEn: expect.any(String),
          puntaje: 10,
          monedasOtorgadas: 120,
          feedback: null,
          respuestas: RESPUESTAS_CALIFICADAS_OK,
        },
      });
    });

    it('con borrador previo: lo CIERRA (in_progress → submitted) sin crear filas', async () => {
      prisma.submissions.findUnique.mockResolvedValue({
        id: BigInt(11),
        status: 'in_progress',
      });

      const resultado = await submissionsService.entregar('7', DTO, ESTUDIANTE);

      expect(prisma.submissions.create).not.toHaveBeenCalled();
      const dataUpdate = prisma.submissions.update.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(dataUpdate).toEqual({
        status: 'submitted',
        submitted_at: expect.any(Date),
        answers: RESPUESTAS_CALIFICADAS_OK,
      });
      expect(prisma.submissions.update.mock.calls[0][0].where).toEqual({
        id: BigInt(11),
      });

      expect(resultado.entrega.estado).toBe('graded');
      expect(resultado.mensaje).toBe(MENSAJE_ENTREGA_CALIFICADA);
    });

    it('descarta is_correct/score del cliente: el veredicto lo calcula el backend', async () => {
      await submissionsService.entregar(
        '7',
        {
          respuestas: [
            {
              question_position: 1,
              option: '3',
              is_correct: false,
              score: 999,
            },
            { question_position: 2, text: '4' },
          ],
        },
        ESTUDIANTE,
      );

      const data = prisma.submissions.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      // La opción '3' ES la correcta: el backend ignora el is_correct
      // falso y el score 999 que intentó colar el cliente.
      expect(data.answers).toEqual(RESPUESTAS_CALIFICADAS_OK);
      expect(JSON.stringify(data.answers)).not.toContain('999');
      expect(JSON.stringify(data.answers)).not.toContain('files');
    });

    it('completitud: falta una pregunta → 400 sin tocar submissions', async () => {
      await expect(
        submissionsService.entregar(
          '7',
          { respuestas: [{ question_position: 1, option: '3' }] },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.submissions.findUnique).not.toHaveBeenCalled();
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('completitud: envío vacío → 400 con las posiciones que faltan', async () => {
      try {
        await submissionsService.entregar('7', { respuestas: [] }, ESTUDIANTE);
        throw new Error('debería haber lanzado BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).message).toMatch(
          /Falta responder las preguntas 1, 2/,
        );
      }
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('pregunta file exenta de completitud: se envía y queda pendiente del profesor', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        questions: [PREGUNTA_FILE, PREGUNTAS_SEED[1]],
      });

      const resultado = await submissionsService.entregar(
        '7',
        { respuestas: [{ question_position: 2, text: '4' }] },
        ESTUDIANTE,
      );

      // file no es auto-calificable: queda submitted para el profesor.
      expect(resultado.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
      expect(resultado.entrega.estado).toBe('submitted');
      expect(prisma.submissions.update).not.toHaveBeenCalled();
    });

    it('bajo el umbral (1 de 2 correctas): queda submitted SIN graded ni monedas', async () => {
      const resultado = await submissionsService.entregar(
        '7',
        {
          respuestas: [
            { question_position: 1, option: '2' },
            { question_position: 2, text: '4' },
          ],
        },
        ESTUDIANTE,
      );

      // Un solo INSERT como submitted: sin UPDATE a graded.
      expect(prisma.submissions.update).not.toHaveBeenCalled();
      expect(resultado.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
      expect(resultado.entrega.estado).toBe('submitted');
      expect(resultado.entrega.puntaje).toBeNull();
      expect(resultado.entrega.monedasOtorgadas).toBe(0);
    });

    it('pregunta minigame: queda submitted pendiente con is_correct/score en null', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        questions: [
          PREGUNTAS_SEED[0],
          { position: 2, type: 'minigame', prompt: 'Juega', score: 5 },
        ],
      });

      const resultado = await submissionsService.entregar(
        '7',
        {
          respuestas: [
            { question_position: 1, option: '3' },
            { question_position: 2, text: 'nivel 1' },
          ],
        },
        ESTUDIANTE,
      );

      const data = prisma.submissions.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data.answers).toEqual([
        { question_position: 1, option: '3', is_correct: true, score: 5 },
        {
          question_position: 2,
          text: 'nivel 1',
          is_correct: null,
          score: null,
        },
      ]);
      expect(prisma.submissions.update).not.toHaveBeenCalled();
      expect(resultado.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
    });

    it('entrega duplicada (ya submitted): 409 con mensaje claro y sin INSERT', async () => {
      prisma.submissions.findUnique.mockResolvedValue({
        id: BigInt(11),
        status: 'submitted',
      });

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_DUPLICADA));
      expect(prisma.submissions.create).not.toHaveBeenCalled();
      expect(prisma.submissions.update).not.toHaveBeenCalled();
    });

    it('entrega ya calificada: 409 (una sola entrega por actividad)', async () => {
      prisma.submissions.findUnique.mockResolvedValue({
        id: BigInt(11),
        status: 'graded',
      });

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_DUPLICADA));
    });

    it('id de actividad no numérico: 404 estándar sin crear nada', async () => {
      await expect(
        submissionsService.entregar('abc', DTO, ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('actividad inexistente, no publicada o estudiante sin inscripción activa: 404 estándar', async () => {
      prisma.activities.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('inscripción retirada entre consultas: 404 defensivo sin crear nada', async () => {
      prisma.enrollments.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('actividad cerrada (closes_at pasado): 422 sin tocar submissions', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        closes_at: new Date(Date.now() - 86_400_000),
      });

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_ACTIVIDAD_CERRADA),
      );
      expect(prisma.submissions.findUnique).not.toHaveBeenCalled();
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('opción que no pertenece a la pregunta test: 400', async () => {
      await expect(
        submissionsService.entregar(
          '7',
          { respuestas: [{ question_position: 1, option: '999' }] },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('pregunta test respondida con text en lugar de option: 400', async () => {
      await expect(
        submissionsService.entregar(
          '7',
          { respuestas: [{ question_position: 1, text: '3' }] },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('misma pregunta respondida dos veces: 400 (una respuesta por pregunta)', async () => {
      await expect(
        submissionsService.entregar(
          '7',
          {
            respuestas: [
              { question_position: 1, option: '3' },
              { question_position: 1, option: '2' },
            ],
          },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('P2002 en el INSERT (carrera entre el alta y un envío paralelo): propaga para que el filtro global responda 409', async () => {
      prisma.submissions.create.mockRejectedValue(errorP2002());

      await expect(
        submissionsService.entregar('7', DTO, ESTUDIANTE),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('archivos referenciados en PUT/POST (verificación anti-IDOR)', () => {
    const ARCHIVO: ArchivoRespuesta = {
      path: '7/1/11111111-1111-4111-8111-111111111111.pdf',
      mime: 'application/pdf',
      bytes: 100,
    };

    /** zod exige que files vaya en una pregunta file: actividad con una. */
    const ACTIVIDAD_FILE = { ...ACTIVIDAD, questions: [PREGUNTA_FILE] };

    it('PUT verifica cada archivo referenciado con el contexto propio (actividad 7, inscripción 1)', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);

      await submissionsService.guardarBorrador(
        '7',
        { respuestas: [{ question_position: 1, files: [ARCHIVO] }] },
        ESTUDIANTE,
      );

      expect(archivos.verificar).toHaveBeenCalledWith(
        BigInt(7),
        BigInt(1),
        ARCHIVO,
      );
    });

    it('PUT con un archivo ajeno: propaga el 400 del almacén (anti-IDOR)', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);
      archivos.verificar.mockRejectedValue(
        new BadRequestException(MENSAJE_ARCHIVO_AJENO),
      );

      await expect(
        submissionsService.guardarBorrador(
          '7',
          { respuestas: [{ question_position: 1, files: [ARCHIVO] }] },
          ESTUDIANTE,
        ),
      ).rejects.toThrow(MENSAJE_ARCHIVO_AJENO);
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('POST (envío) también verifica los archivos referenciados', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);

      await submissionsService.entregar(
        '7',
        { respuestas: [{ question_position: 1, files: [ARCHIVO] }] },
        ESTUDIANTE,
      );

      expect(archivos.verificar).toHaveBeenCalledWith(
        BigInt(7),
        BigInt(1),
        ARCHIVO,
      );
    });
  });

  describe('adjuntarArchivos (POST archivos)', () => {
    /** Actividad con una pregunta file en la posición 1 (como PREGUNTA_FILE). */
    const ACTIVIDAD_FILE = { ...ACTIVIDAD, questions: [PREGUNTA_FILE] };

    const DTO_ARCHIVO: AdjuntarArchivoDto = { question_position: 1 };

    const PDF = Buffer.from('%PDF-1.4\n%E2E\n%%EOF');

    /** Metadata que devuelve el mock del almacén para el PDF de arriba. */
    const ARCHIVO_PDF: ArchivoRespuesta = {
      path: '7/1/11111111-1111-4111-8111-111111111111.pdf',
      mime: 'application/pdf',
      bytes: PDF.length,
    };

    /** Borrador tal como queda con el archivo adjunto en la pregunta 1. */
    const BORRADOR_ARCHIVOS = {
      ...BORRADOR,
      answers: [{ question_position: 1, files: [ARCHIVO_PDF] }],
    };

    it('sube un PDF: guarda en el almacén y crea el borrador con la metadata en answers', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);
      prisma.submissions.findUnique.mockResolvedValue(null);
      prisma.submissions.findUniqueOrThrow.mockResolvedValue(BORRADOR_ARCHIVOS);

      const resultado = await submissionsService.adjuntarArchivos(
        '7',
        DTO_ARCHIVO,
        [{ buffer: PDF }],
        ESTUDIANTE,
      );

      expect(archivos.guardar).toHaveBeenCalledWith(
        BigInt(7),
        BigInt(1),
        PDF,
        'application/pdf',
      );
      const data = prisma.submissions.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).toEqual({
        activity_id: BigInt(7),
        enrollment_id: BigInt(1),
        status: 'in_progress',
        answers: [{ question_position: 1, files: [ARCHIVO_PDF] }],
      });
      expect(resultado).toEqual({
        mensaje: MENSAJE_ARCHIVOS_ADJUNTADOS,
        entrega: {
          id: '11',
          actividadId: '7',
          estado: 'in_progress',
          entregadoEn: null,
          puntaje: null,
          monedasOtorgadas: 0,
          respuestas: [{ question_position: 1, files: [ARCHIVO_PDF] }],
        },
      });
    });

    it('conserva las demás respuestas y REEMPLAZA los archivos de esa pregunta', async () => {
      const preguntas: Pregunta[] = [
        PREGUNTA_FILE,
        { ...PREGUNTAS_SEED[0], position: 2 },
      ];
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD,
        questions: preguntas,
      });
      prisma.submissions.findUnique.mockResolvedValue({
        status: 'in_progress',
        answers: [
          { question_position: 1, files: [{ ...ARCHIVO_PDF, bytes: 1 }] },
          { question_position: 2, option: '3' },
        ],
      });
      prisma.submissions.updateMany.mockResolvedValue({ count: 1 });

      await submissionsService.adjuntarArchivos(
        '7',
        DTO_ARCHIVO,
        [{ buffer: PDF }],
        ESTUDIANTE,
      );

      const data = prisma.submissions.updateMany.mock.calls[0][0]
        .data as Record<string, unknown>;
      // La respuesta de la pregunta 2 se conserva; los archivos de la 1
      // son los recién subidos (orden por posición, como el borrador).
      expect(data.answers).toEqual([
        { question_position: 1, files: [ARCHIVO_PDF] },
        { question_position: 2, option: '3' },
      ]);
      expect(prisma.submissions.create).not.toHaveBeenCalled();
    });

    it('415 cuando el contenido no es PDF/JPG/PNG (magic bytes): sin escribir en el almacén', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          DTO_ARCHIVO,
          [{ buffer: Buffer.from('solo texto, no un pdf') }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(
        new UnsupportedMediaTypeException(MENSAJE_MIME_INVALIDO),
      );
      expect(archivos.guardar).not.toHaveBeenCalled();
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('413 cuando el archivo supera el límite configurado', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);
      // Tope muy por debajo del PDF de fixture (19 bytes): pasa el MIME
      // y cae en el tope de tamaño.
      archivos.limiteBytes.mockReturnValue(10);

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          DTO_ARCHIVO,
          [{ buffer: PDF }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(
        new PayloadTooLargeException(MENSAJE_ARCHIVO_DEMASIADO_GRANDE),
      );
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('409 si la entrega ya fue enviada: sin escribir en el almacén (sin huérfanos)', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);
      prisma.submissions.findUnique.mockResolvedValue({
        status: 'submitted',
        answers: [],
      });

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          DTO_ARCHIVO,
          [{ buffer: PDF }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA));
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('422 si la actividad ya está cerrada', async () => {
      prisma.activities.findFirst.mockResolvedValue({
        ...ACTIVIDAD_FILE,
        closes_at: new Date(Date.now() - 1_000),
      });

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          DTO_ARCHIVO,
          [{ buffer: PDF }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_ACTIVIDAD_CERRADA),
      );
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('400 si la pregunta no es de tipo file', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD);

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          DTO_ARCHIVO,
          [{ buffer: PDF }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(new BadRequestException(MENSAJE_PREGUNTA_NO_ES_FILE));
      expect(archivos.guardar).not.toHaveBeenCalled();
    });

    it('400 si la posición no corresponde a ninguna pregunta', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);

      await expect(
        submissionsService.adjuntarArchivos(
          '7',
          { question_position: 99 },
          [{ buffer: PDF }],
          ESTUDIANTE,
        ),
      ).rejects.toThrow(/no corresponde a ninguna pregunta/);
    });

    it('400 si no se envió ningún archivo', async () => {
      prisma.activities.findFirst.mockResolvedValue(ACTIVIDAD_FILE);

      await expect(
        submissionsService.adjuntarArchivos('7', DTO_ARCHIVO, [], ESTUDIANTE),
      ).rejects.toThrow(new BadRequestException(MENSAJE_SIN_ARCHIVOS));
    });
  });

  describe('descargarArchivo (GET archivos/:posicion/:indice)', () => {
    const CONTENIDO = Buffer.from('%PDF-1.4 descarga e2e');

    const ENTREGA_CON_ARCHIVO = {
      answers: [
        {
          question_position: 1,
          files: [
            {
              path: '7/1/11111111-1111-4111-8111-111111111111.pdf',
              mime: 'application/pdf',
              bytes: CONTENIDO.length,
            },
          ],
        },
      ],
    };

    it('el profesor dueño descarga el archivo: regla entrega + contenido del almacén', async () => {
      prisma.submissions.findFirst.mockResolvedValue(ENTREGA_CON_ARCHIVO);
      archivos.leer.mockResolvedValue(CONTENIDO);

      const archivo = await submissionsService.descargarArchivo(
        '7',
        '21',
        '1',
        '0',
        PROFESOR,
      );

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'entrega',
        '21',
        PROFESOR,
      );
      expect(archivos.leer).toHaveBeenCalledWith(
        BigInt(7),
        '7/1/11111111-1111-4111-8111-111111111111.pdf',
      );
      expect(archivo).toEqual({
        contenido: CONTENIDO,
        mime: 'application/pdf',
        nombre: '11111111-1111-4111-8111-111111111111.pdf',
      });
    });

    it('el estudiante dueño también pasa la regla entrega', async () => {
      prisma.submissions.findFirst.mockResolvedValue(ENTREGA_CON_ARCHIVO);
      archivos.leer.mockResolvedValue(CONTENIDO);

      const archivo = await submissionsService.descargarArchivo(
        '7',
        '21',
        '1',
        '0',
        ESTUDIANTE,
      );

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'entrega',
        '21',
        ESTUDIANTE,
      );
      expect(archivo.contenido).toEqual(CONTENIDO);
    });

    it('entrega inexistente (o de otra actividad): el 404 estándar', async () => {
      prisma.submissions.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.descargarArchivo('7', '999', '1', '0', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('posición sin archivos o índice fuera de rango: el mismo 404', async () => {
      prisma.submissions.findFirst.mockResolvedValue(ENTREGA_CON_ARCHIVO);

      await expect(
        submissionsService.descargarArchivo('7', '21', '2', '0', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      await expect(
        submissionsService.descargarArchivo('7', '21', '1', '5', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(archivos.leer).not.toHaveBeenCalled();
    });

    it('archivo ya ausente del almacén: el mismo 404', async () => {
      prisma.submissions.findFirst.mockResolvedValue(ENTREGA_CON_ARCHIVO);
      archivos.leer.mockResolvedValue(null);

      await expect(
        submissionsService.descargarArchivo('7', '21', '1', '0', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('ids de ruta no numéricos: el 404 estándar (anti-enumeración)', async () => {
      await expect(
        submissionsService.descargarArchivo('7', 'abc', '1', '0', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      await expect(
        submissionsService.descargarArchivo('7', '21', 'x', '0', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      await expect(
        submissionsService.descargarArchivo('7', '21', '1', '-1', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });
  });

  describe('cola (GET queue del profesor)', () => {
    it('re-verifica con AutorizacionService la regla actividad (segunda capa)', async () => {
      await submissionsService.cola('7', {}, PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividad',
        '7',
        PROFESOR,
      );
    });

    it('?estado=submitted: where con el filtro, skip/take de la página y el MISMO where en el count', async () => {
      await submissionsService.cola(
        '7',
        { estado: 'submitted', page: 2, limit: 10 },
        PROFESOR,
      );

      const consulta = prisma.submissions.findMany.mock.calls[0][0];
      expect(consulta.where).toEqual({
        activity_id: BigInt(7),
        status: 'submitted',
      });
      expect(consulta.skip).toBe(10);
      expect(consulta.take).toBe(10);
      // El total es de TODO el filtro, no solo de la página.
      expect(prisma.submissions.count.mock.calls[0][0].where).toEqual({
        activity_id: BigInt(7),
        status: 'submitted',
      });
    });

    it('sin ?estado: where solo con la actividad (todas las entregas)', async () => {
      await submissionsService.cola('7', {}, PROFESOR);

      expect(prisma.submissions.findMany.mock.calls[0][0].where).toEqual({
        activity_id: BigInt(7),
      });
    });

    it('paginación por defecto: página 1 con 20 filas', async () => {
      await submissionsService.cola('7', {}, PROFESOR);

      const consulta = prisma.submissions.findMany.mock.calls[0][0];
      expect(consulta.skip).toBe(0);
      expect(consulta.take).toBe(20);
    });

    it('orden FIFO: submitted_at ascendente (lo más antiguo se califica primero)', async () => {
      await submissionsService.cola('7', {}, PROFESOR);

      expect(prisma.submissions.findMany.mock.calls[0][0].orderBy).toEqual({
        submitted_at: 'asc',
      });
    });

    it('mapea las filas: BigInt→string, Decimal→number y el estudiante del join', async () => {
      prisma.submissions.findMany.mockResolvedValue([
        FILA_COLA_GRADED,
        FILA_COLA_SUBMITTED,
      ]);
      prisma.submissions.count.mockResolvedValue(2);

      const resultado = await submissionsService.cola('7', {}, PROFESOR);

      expect(resultado).toEqual({
        data: [
          {
            id: '20',
            estudiante: {
              id: '4',
              usuario: 'est.gomez',
              nombre: 'María',
              apellido: 'Gómez',
            },
            estado: 'graded',
            entregadoEn: '2026-10-16T09:00:00.000Z',
            puntaje: 10,
            monedasOtorgadas: 120,
          },
          {
            id: '21',
            estudiante: {
              id: '3',
              usuario: 'est.perez',
              nombre: 'Juan',
              apellido: 'Pérez',
            },
            estado: 'submitted',
            entregadoEn: '2026-10-17T10:00:00.000Z',
            puntaje: null,
            monedasOtorgadas: 0,
          },
        ],
        meta: { total: 2, page: 1, limit: 20 },
      });
      // El listado es un resumen: las respuestas de los estudiantes no viajan.
      expect(JSON.stringify(resultado)).not.toContain('respuestas');
      expect(JSON.stringify(resultado)).not.toContain('answers');
    });

    it('borrador in_progress en la cola: entregadoEn null (aún no se envía)', async () => {
      prisma.submissions.findMany.mockResolvedValue([FILA_COLA_BORRADOR]);
      prisma.submissions.count.mockResolvedValue(1);

      const resultado = await submissionsService.cola('7', {}, PROFESOR);

      expect(resultado.data[0]).toEqual({
        id: '22',
        estudiante: {
          id: '3',
          usuario: 'est.perez',
          nombre: 'Juan',
          apellido: 'Pérez',
        },
        estado: 'in_progress',
        entregadoEn: null,
        puntaje: null,
        monedasOtorgadas: 0,
      });
    });

    it('id de actividad no numérico: 404 estándar sin consultar submissions', async () => {
      await expect(
        submissionsService.cola('abc', {}, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.findMany).not.toHaveBeenCalled();
      expect(prisma.submissions.count).not.toHaveBeenCalled();
    });
  });

  describe('detalle (GET revisión del profesor)', () => {
    it('re-verifica con AutorizacionService la regla actividad (segunda capa)', async () => {
      prisma.submissions.findFirst.mockResolvedValue(DETALLE_SUBMITTED);

      await submissionsService.detalle('7', '21', PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividad',
        '7',
        PROFESOR,
      );
    });

    it('exige la relación entrega↔actividad en el MISMO where (otra actividad: 404)', async () => {
      prisma.submissions.findFirst.mockResolvedValue(DETALLE_SUBMITTED);

      await submissionsService.detalle('7', '21', PROFESOR);

      const where = prisma.submissions.findFirst.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where).toEqual({ id: BigInt(21), activity_id: BigInt(7) });
    });

    it('mapea la vista de revisión: estudiante, veredictos y feedback aún vacío', async () => {
      prisma.submissions.findFirst.mockResolvedValue(DETALLE_SUBMITTED);

      const resultado = await submissionsService.detalle('7', '21', PROFESOR);

      expect(resultado).toEqual({
        id: '21',
        estudiante: {
          id: '3',
          usuario: 'est.perez',
          nombre: 'Juan',
          apellido: 'Pérez',
        },
        estado: 'submitted',
        entregadoEn: '2026-10-17T10:00:00.000Z',
        calificadoEn: null,
        puntaje: null,
        monedasOtorgadas: 0,
        feedback: null,
        respuestas: RESPUESTAS_CALIFICADAS_OK,
      });
    });

    it('entrega inexistente (o de otra actividad): el 404 estándar', async () => {
      prisma.submissions.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.detalle('7', '999', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('id no numérico (actividad o entrega): 404 estándar sin consultar', async () => {
      await expect(
        submissionsService.detalle('abc', '21', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      await expect(
        submissionsService.detalle('7', 'abc', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('calificar (POST calificar)', () => {
    const DTO_GRADED: CalificarEntregaDto = {
      decision: 'graded',
      puntaje: 7.5,
      feedback: 'Bien en general; revisa el planteo del ejercicio 1.',
    };

    const DTO_REJECTED: CalificarEntregaDto = {
      decision: 'rejected',
      feedback: 'La respuesta del ejercicio 2 no corresponde: reenvíala.',
    };

    beforeEach(() => {
      // El happy path actualiza y RELEE la fila tal como quedó (con lo
      // que escribió el trigger). Los casos de error re-programan los
      // mocks que necesitan.
      prisma.submissions.updateMany.mockResolvedValue({ count: 1 });
      prisma.submissions.findFirst.mockResolvedValue(DETALLE_GRADED);
    });

    it('re-verifica con AutorizacionService la regla actividad (segunda capa)', async () => {
      await submissionsService.calificar('7', '21', DTO_GRADED, PROFESOR);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'actividad',
        '7',
        PROFESOR,
      );
    });

    it('graded: UPDATE atómico SOLO sobre submitted, con score/feedback/graded_by del token', async () => {
      const resultado = await submissionsService.calificar(
        '7',
        '21',
        DTO_GRADED,
        PROFESOR,
      );

      const consulta = prisma.submissions.updateMany.mock.calls[0][0];
      expect(consulta.where).toEqual({
        id: BigInt(21),
        activity_id: BigInt(7),
        status: 'submitted',
      });
      expect(consulta.data).toEqual({
        status: 'graded',
        score: 7.5,
        feedback: DTO_GRADED.feedback,
        graded_by: BigInt(2),
      });
      // El backend JAMÁS escribe monedas ni fecha de calificación:
      // los acredita el trigger fn_award_coins en la transición.
      expect(consulta.data).not.toHaveProperty('graded_at');
      expect(consulta.data).not.toHaveProperty('coins_awarded');

      // La respuesta sale de la RE-LECTURA: monedas y calificadoEn son
      // lo que el trigger escribió, no lo que envió el profesor.
      expect(resultado).toEqual({
        mensaje: MENSAJE_ENTREGA_CALIFICADA_PROFESOR,
        entrega: {
          id: '21',
          estudiante: {
            id: '3',
            usuario: 'est.perez',
            nombre: 'Juan',
            apellido: 'Pérez',
          },
          estado: 'graded',
          entregadoEn: '2026-10-17T10:00:00.000Z',
          calificadoEn: '2026-10-18T12:00:00.000Z',
          puntaje: 7.5,
          monedasOtorgadas: 120,
          feedback: 'Bien en general; revisa el planteo del ejercicio 1.',
          respuestas: RESPUESTAS_CALIFICADAS_OK,
        },
      });
    });

    it('graded sin feedback: la clave no viaja en el UPDATE (no pisa nada)', async () => {
      prisma.submissions.findFirst.mockResolvedValue({
        ...DETALLE_GRADED,
        feedback: null,
      });

      await submissionsService.calificar(
        '7',
        '21',
        {
          decision: 'graded',
          puntaje: 10,
        },
        PROFESOR,
      );

      const data = prisma.submissions.updateMany.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data).not.toHaveProperty('feedback');
    });

    it('rejected: SIN score (queda null) ni monedas; graded_by y feedback sí', async () => {
      prisma.submissions.findFirst.mockResolvedValue(DETALLE_REJECTED);

      const resultado = await submissionsService.calificar(
        '7',
        '21',
        DTO_REJECTED,
        PROFESOR,
      );

      const data = prisma.submissions.updateMany.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data).toEqual({
        status: 'rejected',
        feedback: DTO_REJECTED.feedback,
        graded_by: BigInt(2),
      });
      expect(data).not.toHaveProperty('score');

      expect(resultado.mensaje).toBe(MENSAJE_ENTREGA_RECHAZADA);
      expect(resultado.entrega.estado).toBe('rejected');
      expect(resultado.entrega.puntaje).toBeNull();
      // El trigger solo dispara en → graded: sin monedas ni graded_at.
      expect(resultado.entrega.monedasOtorgadas).toBe(0);
      expect(resultado.entrega.calificadoEn).toBeNull();
      expect(resultado.entrega.feedback).toBe(DTO_REJECTED.feedback);
    });

    it('graded sin puntaje: 400 (el puntaje es obligatorio para aprobar)', async () => {
      await expect(
        submissionsService.calificar(
          '7',
          '21',
          { decision: 'graded' },
          PROFESOR,
        ),
      ).rejects.toThrow(new BadRequestException(MENSAJE_PUNTAJE_REQUERIDO));
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('rejected con puntaje: 400 (el rechazo no lleva nota)', async () => {
      await expect(
        submissionsService.calificar(
          '7',
          '21',
          { decision: 'rejected', puntaje: 5 },
          PROFESOR,
        ),
      ).rejects.toThrow(new BadRequestException(MENSAJE_PUNTAJE_NO_EN_RECHAZO));
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('puntaje por encima del total de la actividad: 422 sin tocar la entrega', async () => {
      await expect(
        submissionsService.calificar(
          '7',
          '21',
          { decision: 'graded', puntaje: 11 },
          PROFESOR,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_PUNTAJE_FUERA_DE_RANGO),
      );
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('puntaje negativo: 422 (el rango es 0..total)', async () => {
      await expect(
        submissionsService.calificar(
          '7',
          '21',
          { decision: 'graded', puntaje: -1 },
          PROFESOR,
        ),
      ).rejects.toThrow(
        new UnprocessableEntityException(MENSAJE_PUNTAJE_FUERA_DE_RANGO),
      );
    });

    it('RE-calificar una graded: el UPDATE exige submitted en el where → 409 sin re-disparar el trigger', async () => {
      prisma.submissions.updateMany.mockResolvedValue({ count: 0 });
      prisma.submissions.findFirst.mockResolvedValue({ status: 'graded' });

      await expect(
        submissionsService.calificar('7', '21', DTO_GRADED, PROFESOR),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_NO_PENDIENTE));

      // La garantía del no-doble-pago: el filtro por estado en el where.
      const where = prisma.submissions.updateMany.mock.calls[0][0]
        .where as Record<string, unknown>;
      expect(where.status).toBe('submitted');
    });

    it('calificar un borrador in_progress: el mismo 409 (nada enviado, nada que calificar)', async () => {
      prisma.submissions.updateMany.mockResolvedValue({ count: 0 });
      prisma.submissions.findFirst.mockResolvedValue({ status: 'in_progress' });

      await expect(
        submissionsService.calificar('7', '21', DTO_GRADED, PROFESOR),
      ).rejects.toThrow(new ConflictException(MENSAJE_ENTREGA_NO_PENDIENTE));
    });

    it('entrega inexistente o de otra actividad: el 404 estándar', async () => {
      prisma.submissions.updateMany.mockResolvedValue({ count: 0 });
      prisma.submissions.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.calificar('7', '999', DTO_GRADED, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('actividad inexistente: 404 estándar sin tocar la entrega', async () => {
      prisma.activities.findFirst.mockResolvedValue(null);

      await expect(
        submissionsService.calificar('999', '21', DTO_GRADED, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });

    it('id no numérico: 404 estándar sin tocar la entrega', async () => {
      await expect(
        submissionsService.calificar('abc', '21', DTO_GRADED, PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.submissions.updateMany).not.toHaveBeenCalled();
    });
  });
});
