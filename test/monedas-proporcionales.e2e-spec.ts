import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  MENSAJE_ENTREGA_CALIFICADA,
  MENSAJE_ENTREGA_PENDIENTE,
  MENSAJE_ENTREGA_UMBRAL,
  MENSAJE_PUNTAJE_FUERA_DE_RANGO,
} from '../src/modules/submissions/submissions.service';

/**
 * Monedas PROPORCIONALES al puntaje (migración
 * `20261110000002_monedas_proporcionales`) contra la BD real: el trigger
 * `fn_award_coins` paga `ROUND(reward_coins × submissions.score /
 * fn_activity_total_points(questions))` al pasar a 'graded' —
 * `reward_coins` es el MÁXIMO, no lo que se acredita siempre — y el
 * umbral automático se decide por PUNTOS (≥ 80% del puntaje total, no
 * porcentaje de respuestas correctas).
 *
 * Cobertura:
 *  1. Actividad ponderada (10+1+1+1+1 = 14 pts, reward 140): 12/14 →
 *     auto-'graded' con 120 monedas (1 solo `earning`) y saldo +120.
 *  2. 4/14 (solo las de 1 punto) → 'submitted' sin monedas; el profesor
 *     califica con puntaje 12 → 120 monedas, 1 solo `earning`.
 *  3. 10/14 (solo la de 10 puntos) → 'submitted' (71.4% < 80%).
 *  4. Redondeo: 1/3 con reward 100, calificada con puntaje 1 → 33.
 *  5. Puntaje 0 del profesor → 0 monedas y CERO movimientos `earning`.
 *  6. Puntaje total → monedas completas (reward_coins).
 *  7. DTOs: `totalPuntos` y `modoCalificacion` en las vistas de la
 *     actividad (profesor y estudiante) y `puntajeAutomatico` en la
 *     vista de revisión del profesor (suma de answers[].score no nulos;
 *     null si ninguna respuesta es auto-evaluable).
 *  8. Puntaje del profesor fuera de rango (> total) → 422 sin monedas.
 *
 * Aislamiento por corrida (patrón canje-revisable.e2e): organización
 * sintética NUEVA con `Date.now()`, profesor/estudiante propios (hash
 * argon2 del seed + `must_change_password: false`), clase e inscripción
 * propias — los contadores de monedas por inscripción no se mezclan con
 * otras suites. Limpieza en `afterAll` respetando el orden FK
 * (movimientos → entregas → inscripción → actividades → clases →
 * usuarios → organización) y con higiene de disco de los archivos
 * subidos. Logins: 2 (≤ 5/min por IP por instancia de app).
 */

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

/** Contenido mínimo con la firma real de PDF (la validación es por magic bytes). */
const PDF = Buffer.from('%PDF-1.4\n%E2E monedas proporcionales\n%%EOF');

/** Actividad ponderada: 10 + 1 + 1 + 1 + 1 = 14 puntos. */
const PREGUNTAS_PONDERADAS = [
  {
    position: 1,
    type: 'test',
    prompt: 'Pregunta de 10 puntos',
    score: 10,
    options: [
      { text: '1', is_correct: false },
      { text: '2', is_correct: true },
      { text: '3', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'test',
    prompt: 'Pregunta de 1 punto A',
    score: 1,
    options: [
      { text: 'a', is_correct: true },
      { text: 'b', is_correct: false },
    ],
  },
  {
    position: 3,
    type: 'completion',
    prompt: 'Pregunta de 1 punto B',
    score: 1,
    expected_answer: 'alpha',
  },
  {
    position: 4,
    type: 'completion',
    prompt: 'Pregunta de 1 punto C',
    score: 1,
    expected_answer: 'beta',
  },
  {
    position: 5,
    type: 'completion',
    prompt: 'Pregunta de 1 punto D',
    score: 1,
    expected_answer: 'gamma',
  },
] as const;

/** 12/14: la de 10 puntos y dos de 1 (85.7% ≥ 80% del puntaje). */
const RESPUESTAS_12 = [
  { question_position: 1, option: '2' },
  { question_position: 2, option: 'a' },
  { question_position: 3, text: 'alpha' },
  { question_position: 4, text: 'incorrecta' },
  { question_position: 5, text: 'incorrecta' },
];

/** 4/14: SOLO las cuatro de 1 punto (28.6% < 80% del puntaje). */
const RESPUESTAS_4 = [
  { question_position: 1, option: '1' },
  { question_position: 2, option: 'a' },
  { question_position: 3, text: 'alpha' },
  { question_position: 4, text: 'beta' },
  { question_position: 5, text: 'gamma' },
];

/** 10/14: SOLO la de 10 puntos (71.4% < 80% del puntaje). */
const RESPUESTAS_10 = [
  { question_position: 1, option: '2' },
  { question_position: 2, option: 'b' },
  { question_position: 3, text: 'incorrecta' },
  { question_position: 4, text: 'incorrecta' },
  { question_position: 5, text: 'incorrecta' },
];

/** Tres preguntas de 1 punto: 3 puntos en total. */
const PREGUNTAS_TRES = [
  {
    position: 1,
    type: 'test',
    prompt: 'Pregunta 1',
    score: 1,
    options: [
      { text: 'a', is_correct: true },
      { text: 'b', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Pregunta 2',
    score: 1,
    expected_answer: 'dos',
  },
  {
    position: 3,
    type: 'completion',
    prompt: 'Pregunta 3',
    score: 1,
    expected_answer: 'tres',
  },
] as const;

/** 1/3: solo la primera correcta (33.3% < 80% del puntaje). */
const RESPUESTAS_1_DE_3 = [
  { question_position: 1, option: 'a' },
  { question_position: 2, text: 'incorrecta' },
  { question_position: 3, text: 'incorrecta' },
];

/** Dos preguntas de 5 puntos: 10 puntos en total. */
const PREGUNTAS_DOS = [
  {
    position: 1,
    type: 'test',
    prompt: 'Pregunta 1',
    score: 5,
    options: [
      { text: 'a', is_correct: true },
      { text: 'b', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Pregunta 2',
    score: 5,
    expected_answer: 'solucion',
  },
] as const;

/** 0/10: ninguna correcta. */
const RESPUESTAS_CERO = [
  { question_position: 1, option: 'b' },
  { question_position: 2, text: 'incorrecta' },
];

/** 5/10: una correcta (50% < 80% del puntaje). */
const RESPUESTAS_1_DE_DOS = [
  { question_position: 1, option: 'a' },
  { question_position: 2, text: 'incorrecta' },
];

/** Actividad mixta: file (5 pts) + test (5 pts) = 10 puntos → 'manual'. */
const PREGUNTAS_FILE_TEST = [
  {
    position: 1,
    type: 'file',
    prompt: 'Adjunta tu solución',
    score: 5,
  },
  {
    position: 2,
    type: 'test',
    prompt: 'Pregunta de opción',
    score: 5,
    options: [
      { text: 'a', is_correct: false },
      { text: 'b', is_correct: true },
    ],
  },
] as const;

/** Actividad solo file (5 pts) → 'manual', nada auto-evaluable. */
const PREGUNTA_SOLO_FILE = [
  {
    position: 1,
    type: 'file',
    prompt: 'Adjunta tu solución',
    score: 5,
  },
] as const;

describe('Monedas proporcionales al puntaje (e2e, fixtures aislados)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudiante = '';

  // Fixtures de esta corrida.
  let inscripcionId = 0n;

  // Actividades publicadas (una por caso; uq_submission permite una
  // entrega por actividad e inscripción).
  let idAct12 = '';
  let idAct4 = '';
  let idAct10 = '';
  let idAct3 = '';
  let idAct0 = '';
  let idActTotal = '';
  let idActFileTest = '';
  let idActSoloFile = '';
  let idActRango = '';

  const inscripciones: bigint[] = [];
  /** Clase fixture (una sola): se guarda aparte del array de limpieza. */
  let idClase: bigint;
  const clases: bigint[] = [];
  const usuarios: bigint[] = [];
  const organizaciones: bigint[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const unicidad = Date.now();

    // Fixtures de BD ----------------------------------------------
    const org = await prisma.organizations.create({
      data: { name: `Org Monedas Proporcionales ${unicidad}`, type: 'school' },
    });
    organizaciones.push(org.id);

    const crearUsuario = async (
      role: 'teacher' | 'student',
      username: string,
      first_name: string,
      last_name: string,
    ): Promise<bigint> => {
      const usuario = await prisma.users.create({
        data: {
          organization_id: org.id,
          role,
          username,
          email: `${username}@educoins.test`,
          password_hash: HASH_ESTUDIANTE_SEED,
          first_name,
          last_name,
          must_change_password: false,
        },
      });
      usuarios.push(usuario.id);
      return usuario.id;
    };

    const profesorId = await crearUsuario(
      'teacher',
      `prof.mp.${unicidad}`,
      'Paula',
      'Molina',
    );
    const estudianteId = await crearUsuario(
      'student',
      `est.mp.${unicidad}`,
      'Ana',
      'Paz',
    );

    // Los 2 logins (rate limit de auth: 5/min por IP por app).
    const [loginProfesor, loginEstudiante] = await Promise.all([
      httpServer
        .post('/api/v1/auth/login')
        .send({
          usuarioOEmail: `prof.mp.${unicidad}`,
          contrasena: 'Estudiante123!',
        }),
      httpServer
        .post('/api/v1/auth/login')
        .send({
          usuarioOEmail: `est.mp.${unicidad}`,
          contrasena: 'Estudiante123!',
        }),
    ]);
    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;

    const clase = await prisma.classes.create({
      data: {
        teacher_id: profesorId,
        name: `Clase Monedas Proporcionales ${unicidad}`,
      },
    });
    clases.push(clase.id);
    idClase = clase.id;

    const inscripcion = await prisma.enrollments.create({
      data: { class_id: clase.id, student_id: estudianteId },
    });
    inscripcionId = inscripcion.id;
    inscripciones.push(inscripcion.id);

    // Actividades de los casos, creadas por la API REAL del profesor.
    idAct12 = await crearActividad(
      `E2E Monedas 12/14 ${unicidad}`,
      PREGUNTAS_PONDERADAS,
      140,
    );
    idAct4 = await crearActividad(
      `E2E Monedas 4/14 ${unicidad}`,
      PREGUNTAS_PONDERADAS,
      140,
    );
    idAct10 = await crearActividad(
      `E2E Monedas 10/14 ${unicidad}`,
      PREGUNTAS_PONDERADAS,
      140,
    );
    idAct3 = await crearActividad(
      `E2E Monedas 1/3 ${unicidad}`,
      PREGUNTAS_TRES,
      100,
    );
    idAct0 = await crearActividad(
      `E2E Monedas puntaje 0 ${unicidad}`,
      PREGUNTAS_DOS,
      50,
    );
    idActTotal = await crearActividad(
      `E2E Monedas puntaje total ${unicidad}`,
      PREGUNTAS_DOS,
      50,
    );
    idActFileTest = await crearActividad(
      `E2E Monedas file+test ${unicidad}`,
      PREGUNTAS_FILE_TEST,
      30,
    );
    idActSoloFile = await crearActividad(
      `E2E Monedas solo file ${unicidad}`,
      PREGUNTA_SOLO_FILE,
      30,
    );
    idActRango = await crearActividad(
      `E2E Monedas fuera de rango ${unicidad}`,
      PREGUNTAS_DOS,
      50,
    );
  });

  afterAll(async () => {
    try {
      // Orden FK: movimientos → entregas → inscripción → actividades →
      // clases → usuarios → organización.
      await prisma.coin_movements.deleteMany({
        where: { enrollment_id: { in: inscripciones } },
      });
      await prisma.submissions.deleteMany({
        where: { enrollment_id: { in: inscripciones } },
      });
      await prisma.enrollments.deleteMany({
        where: { id: { in: inscripciones } },
      });
      await prisma.activities.deleteMany({
        where: { class_id: { in: clases } },
      });
      await prisma.classes.deleteMany({ where: { id: { in: clases } } });
      await prisma.users.deleteMany({ where: { id: { in: usuarios } } });
      await prisma.organizations.deleteMany({
        where: { id: { in: organizaciones } },
      });

      // Higiene de DISCO: los bytes subidos por esta corrida se borran
      // físicamente (las filas de la BD se conservan por diseño).
      const uploadDir =
        app.get(ConfigService).get<string>('UPLOAD_DIR') ?? '.data/uploads';
      for (const id of [idActFileTest, idActSoloFile]) {
        if (id !== '') {
          await rm(join(uploadDir, id), { recursive: true, force: true });
        }
      }
    } finally {
      await app.close();
    }
  });

  /** Crea y publica una actividad de la clase fixture (API real). */
  const crearActividad = async (
    titulo: string,
    preguntas: unknown,
    recompensaMonedas: number,
  ): Promise<string> => {
    const clase = await prisma.classes.findFirstOrThrow({
      where: { id: idClase },
      select: { id: true },
    });
    const creada = await httpServer
      .post(`/api/v1/classes/${clase.id}/activities`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ titulo, preguntas, recompensaMonedas });
    expect(creada.status).toBe(201);
    const id = creada.body.actividad.id as string;
    const publicada = await httpServer
      .post(`/api/v1/activities/${id}/publicar`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({});
    expect(publicada.status).toBe(200);
    return id;
  };

  /** Envía la entrega del estudiante (POST real). */
  const entregar = (id: string, respuestas: unknown) =>
    httpServer
      .post(`/api/v1/activities/${id}/submissions`)
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ respuestas });

  /** Califica (decision='graded') una entrega pendiente (profesor). */
  const calificar = (id: string, entregaId: string, puntaje: number) =>
    httpServer
      .post(`/api/v1/activities/${id}/submissions/${entregaId}/calificar`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ decision: 'graded', puntaje });

  /** Vista de revisión del profesor (EntregaDetalleProfesorDto). */
  const detalle = (id: string, entregaId: string) =>
    httpServer
      .get(`/api/v1/activities/${id}/submissions/${entregaId}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);

  /** Subida multipart a una pregunta file: devuelve las referencias. */
  const subirArchivo = async (
    id: string,
    posicion: number,
  ): Promise<{ path: string; mime: string; bytes: number }[]> => {
    const respuesta = await httpServer
      .post(`/api/v1/activities/${id}/submissions/archivos`)
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .field('question_position', String(posicion))
      .attach('archivos', PDF, 'solucion.pdf');
    expect(respuesta.status).toBe(201);
    return (
      (respuesta.body.entrega.respuestas[0]?.files ?? []) as {
        path: string;
        mime: string;
        bytes: number;
      }[]
    );
  };

  /** Monedas ganadas (coins_earned) de la inscripción fixture. */
  const monedasGanadas = async (): Promise<number> => {
    const fila = await prisma.enrollments.findUnique({
      where: { id: inscripcionId },
      select: { coins_earned: true },
    });
    expect(fila).not.toBeNull();
    return fila!.coins_earned;
  };

  /** Movimientos `earning` ligados a UNA entrega (0 o 1 por el índice único). */
  const movimientosEarningDe = (entregaId: string) =>
    prisma.coin_movements.findMany({
      where: { submission_id: BigInt(entregaId), type: 'earning' },
      orderBy: { id: 'asc' },
    });

  it('1. ponderada 12/14: auto-grading → graded con 120 de 140, 1 earning y saldo +120', async () => {
    const monedasAntes = await monedasGanadas();

    const respuesta = await entregar(idAct12, RESPUESTAS_12);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_CALIFICADA);
    expect(respuesta.body.entrega).toEqual({
      id: expect.any(String),
      actividadId: idAct12,
      estado: 'graded',
      entregadoEn: expect.any(String),
      puntaje: 12,
      // ROUND(140 × 12 / 14) = 120: pago proporcional al puntaje.
      monedasOtorgadas: 120,
      feedback: null,
      respuestas: [
        {
          question_position: 1,
          option: '2',
          is_correct: true,
          score: 10,
        },
        {
          question_position: 2,
          option: 'a',
          is_correct: true,
          score: 1,
        },
        {
          question_position: 3,
          text: 'alpha',
          is_correct: true,
          score: 1,
        },
        {
          question_position: 4,
          text: 'incorrecta',
          is_correct: false,
          score: 0,
        },
        {
          question_position: 5,
          text: 'incorrecta',
          is_correct: false,
          score: 0,
        },
      ],
    });

    // Exactamente UN movimiento earning de 120 (uq_movement_earning)…
    const movimientos = await movimientosEarningDe(
      respuesta.body.entrega.id as string,
    );
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      type: 'earning',
      quantity: 120,
      description: 'Activity reward',
    });
    // …y el saldo de la inscripción sube exactamente 120.
    expect(await monedasGanadas()).toBe(monedasAntes + 120);
  });

  it('2. 4/14 queda submitted sin monedas; el profesor con puntaje 12 paga 120', async () => {
    const monedasAntes = await monedasGanadas();

    const envio = await entregar(idAct4, RESPUESTAS_4);

    expect(envio.status).toBe(201);
    expect(envio.body.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
    expect(envio.body.entrega.estado).toBe('submitted');
    expect(envio.body.entrega.puntaje).toBeNull();
    expect(envio.body.entrega.monedasOtorgadas).toBe(0);
    // Sin paso a graded no hay trigger: las monedas quedan igual.
    expect(await monedasGanadas()).toBe(monedasAntes);

    const idEntrega = envio.body.entrega.id as string;
    const calificacion = await calificar(idAct4, idEntrega, 12);

    expect(calificacion.status).toBe(200);
    expect(calificacion.body.entrega.estado).toBe('graded');
    expect(calificacion.body.entrega.puntaje).toBe(12);
    // ROUND(140 × 12 / 14) = 120: el profesor puso el puntaje y el
    // trigger pagó en proporción a él.
    expect(calificacion.body.entrega.monedasOtorgadas).toBe(120);

    const movimientos = await movimientosEarningDe(idEntrega);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ type: 'earning', quantity: 120 });
    expect(await monedasGanadas()).toBe(monedasAntes + 120);
  });

  it('3. 10/14 (solo la de 10 puntos) queda submitted sin monedas', async () => {
    const monedasAntes = await monedasGanadas();

    const respuesta = await entregar(idAct10, RESPUESTAS_10);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
    expect(respuesta.body.entrega.estado).toBe('submitted');
    expect(respuesta.body.entrega.puntaje).toBeNull();
    expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
    // 10/14 puntos = 71.4% < 80%: sin transición a graded no hay monedas.
    expect(await movimientosEarningDe(respuesta.body.entrega.id as string)).
      toHaveLength(0);
    expect(await monedasGanadas()).toBe(monedasAntes);
  });

  it('4. redondeo: 1/3 con reward 100, calificada con puntaje 1 → 33 monedas', async () => {
    const monedasAntes = await monedasGanadas();

    const envio = await entregar(idAct3, RESPUESTAS_1_DE_3);
    expect(envio.status).toBe(201);
    expect(envio.body.entrega.estado).toBe('submitted');

    const idEntrega = envio.body.entrega.id as string;
    const calificacion = await calificar(idAct3, idEntrega, 1);

    expect(calificacion.status).toBe(200);
    expect(calificacion.body.entrega.estado).toBe('graded');
    expect(calificacion.body.entrega.puntaje).toBe(1);
    // ROUND(100 × 1 / 3) = ROUND(33.33…) = 33.
    expect(calificacion.body.entrega.monedasOtorgadas).toBe(33);

    const movimientos = await movimientosEarningDe(idEntrega);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ type: 'earning', quantity: 33 });
    expect(await monedasGanadas()).toBe(monedasAntes + 33);
  });

  it('5. puntaje 0 del profesor: graded con 0 monedas y CERO movimientos earning', async () => {
    const monedasAntes = await monedasGanadas();

    const envio = await entregar(idAct0, RESPUESTAS_CERO);
    expect(envio.status).toBe(201);
    expect(envio.body.entrega.estado).toBe('submitted');

    const idEntrega = envio.body.entrega.id as string;
    const calificacion = await calificar(idAct0, idEntrega, 0);

    expect(calificacion.status).toBe(200);
    expect(calificacion.body.entrega.estado).toBe('graded');
    expect(calificacion.body.entrega.puntaje).toBe(0);
    expect(calificacion.body.entrega.monedasOtorgadas).toBe(0);
    // 0 × recompensa = 0: el trigger no inserta ningún movimiento.
    expect(await movimientosEarningDe(idEntrega)).toHaveLength(0);
    expect(await monedasGanadas()).toBe(monedasAntes);
  });

  it('6. puntaje total del profesor: monedas completas (reward_coins)', async () => {
    const monedasAntes = await monedasGanadas();

    const envio = await entregar(idActTotal, RESPUESTAS_1_DE_DOS);
    expect(envio.status).toBe(201);
    expect(envio.body.entrega.estado).toBe('submitted');

    const idEntrega = envio.body.entrega.id as string;
    const calificacion = await calificar(idActTotal, idEntrega, 10);

    expect(calificacion.status).toBe(200);
    expect(calificacion.body.entrega.estado).toBe('graded');
    expect(calificacion.body.entrega.puntaje).toBe(10);
    // ROUND(50 × 10 / 10) = 50 = reward_coins completo.
    expect(calificacion.body.entrega.monedasOtorgadas).toBe(50);

    const movimientos = await movimientosEarningDe(idEntrega);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ type: 'earning', quantity: 50 });
    expect(await monedasGanadas()).toBe(monedasAntes + 50);
  });

  it('7. DTOs: totalPuntos y modoCalificacion en las vistas del profesor y del estudiante', async () => {
    // Actividad auto-calificable: 14 puntos y camino 'automatica'.
    const delProfesor = await httpServer
      .get(`/api/v1/activities/${idAct12}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(delProfesor.status).toBe(200);
    expect(delProfesor.body.totalPuntos).toBe(14);
    expect(delProfesor.body.modoCalificacion).toBe('automatica');

    const delEstudiante = await httpServer
      .get(`/api/v1/activities/${idAct12}`)
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(delEstudiante.status).toBe(200);
    expect(delEstudiante.body.totalPuntos).toBe(14);
    expect(delEstudiante.body.modoCalificacion).toBe('automatica');

    // Actividad con pregunta file: 10 puntos y revisión 'manual'.
    const conFile = await httpServer
      .get(`/api/v1/activities/${idActFileTest}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(conFile.status).toBe(200);
    expect(conFile.body.totalPuntos).toBe(10);
    expect(conFile.body.modoCalificacion).toBe('manual');

    const conFileEstudiante = await httpServer
      .get(`/api/v1/activities/${idActFileTest}`)
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(conFileEstudiante.status).toBe(200);
    expect(conFileEstudiante.body.modoCalificacion).toBe('manual');
  });

  it('7b. file+test: queda submitted y puntajeAutomatico suma SOLO lo auto-evaluable', async () => {
    const archivos = await subirArchivo(idActFileTest, 1);
    expect(archivos).toHaveLength(1);

    const envio = await entregar(idActFileTest, [
      { question_position: 1, files: archivos },
      { question_position: 2, option: 'b' },
    ]);

    expect(envio.status).toBe(201);
    expect(envio.body.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
    expect(envio.body.entrega.estado).toBe('submitted');
    expect(envio.body.entrega.puntaje).toBeNull();
    expect(envio.body.entrega.monedasOtorgadas).toBe(0);

    const idEntrega = envio.body.entrega.id as string;
    const revision = await detalle(idActFileTest, idEntrega);
    expect(revision.status).toBe(200);
    expect(revision.body.estado).toBe('submitted');
    // Solo la respuesta test es auto-evaluable (score 5); la file queda
    // null/null → puntajeAutomatico = 5 (la suma de lo auto-evaluado).
    expect(revision.body.puntajeAutomatico).toBe(5);
    expect(revision.body.respuestas).toEqual([
      {
        question_position: 1,
        files: archivos,
        is_correct: null,
        score: null,
      },
      {
        question_position: 2,
        option: 'b',
        is_correct: true,
        score: 5,
      },
    ]);
  });

  it('7c. solo file: puntajeAutomatico es null (ninguna respuesta auto-evaluable)', async () => {
    const archivos = await subirArchivo(idActSoloFile, 1);
    expect(archivos).toHaveLength(1);

    const envio = await entregar(idActSoloFile, [
      { question_position: 1, files: archivos },
    ]);

    expect(envio.status).toBe(201);
    expect(envio.body.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
    expect(envio.body.entrega.estado).toBe('submitted');

    const idEntrega = envio.body.entrega.id as string;
    const revision = await detalle(idActSoloFile, idEntrega);
    expect(revision.status).toBe(200);
    expect(revision.body.puntajeAutomatico).toBeNull();
  });

  it('8. puntaje del profesor fuera de rango (> total): 422 y sin monedas', async () => {
    const monedasAntes = await monedasGanadas();

    const envio = await entregar(idActRango, RESPUESTAS_CERO);
    expect(envio.status).toBe(201);
    const idEntrega = envio.body.entrega.id as string;

    // El total de la actividad es 10: 11 se rechaza con 422.
    const calificacion = await calificar(idActRango, idEntrega, 11);

    expect(calificacion.status).toBe(422);
    expect(calificacion.body.message).toBe(MENSAJE_PUNTAJE_FUERA_DE_RANGO);
    // Sin transición a graded: sin monedas, sin movimientos y la entrega
    // sigue pendiente.
    expect(await movimientosEarningDe(idEntrega)).toHaveLength(0);
    expect(await monedasGanadas()).toBe(monedasAntes);
    const despues = await detalle(idActRango, idEntrega);
    expect(despues.body.estado).toBe('submitted');
    expect(despues.body.monedasOtorgadas).toBe(0);
  });
});
