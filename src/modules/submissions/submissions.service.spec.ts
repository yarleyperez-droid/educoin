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
  SubmissionsService,
  MENSAJE_ACTIVIDAD_CERRADA,
  MENSAJE_BORRADOR_GUARDADO,
  MENSAJE_ENTREGA_CALIFICADA,
  MENSAJE_ENTREGA_DUPLICADA,
  MENSAJE_ENTREGA_PENDIENTE,
  MENSAJE_ENTREGA_UMBRAL,
  MENSAJE_ENTREGA_YA_ENVIADA,
} from './submissions.service';
import type { Pregunta } from '../activities/dto/preguntas.schema';
import type { CrearEntregaDto } from './dto/crear-entrega.dto';
import type { GuardarBorradorDto } from './dto/guardar-borrador.dto';

type ConsultaCreate = { data: object; select: object };
type ConsultaUpdate = { where: object; data: object; select: object };
type ConsultaUpdateMany = { where: object; data: object };
type ConsultaUnica = { where: object; select: object };
type ConsultaActividad = { where: object; select: object };
type ConsultaInscripcion = { where: object; select: object };
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
    updateMany: jest.Mock<Promise<{ count: number }>, [ConsultaUpdateMany]>;
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
  };
}

interface AutorizacionMock {
  verificarPertenencia: jest.Mock<
    Promise<void>,
    [string, string, UsuarioAutenticado]
  >;
}

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
  answers: RESPUESTAS_BORRADOR,
};

const ENTREGA_SUBMITTED = {
  id: BigInt(11),
  activity_id: BigInt(7),
  status: 'submitted' as const,
  submitted_at: new Date('2026-10-17T10:00:00.000Z'),
  score: null,
  coins_awarded: 0,
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
  answers: RESPUESTAS_CALIFICADAS_OK,
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
        updateMany: jest
          .fn<Promise<{ count: number }>, [ConsultaUpdateMany]>()
          .mockResolvedValue({ count: 0 }),
        create: jest
          .fn<Promise<unknown>, [ConsultaCreate]>()
          .mockResolvedValue(ENTREGA_SUBMITTED),
        update: jest
          .fn<Promise<unknown>, [ConsultaUpdate]>()
          .mockResolvedValue(ENTREGA_CALIFICADA),
      },
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    submissionsService = new SubmissionsService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
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

    it('descarta is_correct/score/files del cliente: el veredicto lo calcula el backend', async () => {
      await submissionsService.entregar(
        '7',
        {
          respuestas: [
            {
              question_position: 1,
              option: '3',
              is_correct: false,
              score: 999,
              files: [{ path: 'a.pdf', mime: 'application/pdf', bytes: 1 }],
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
});
