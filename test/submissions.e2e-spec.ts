import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import {
  MENSAJE_BORRADOR_GUARDADO,
  MENSAJE_ENTREGA_CALIFICADA,
  MENSAJE_ENTREGA_DUPLICADA,
  MENSAJE_ENTREGA_PENDIENTE,
  MENSAJE_ENTREGA_UMBRAL,
  MENSAJE_ENTREGA_YA_ENVIADA,
} from '../src/modules/submissions/submissions.service';

/**
 * E2E del flujo de entregas del estudiante contra la BD real con los
 * datos del seed (db/002_seed.sql): la clase 1 'Mathematics 10A' es de
 * prof.lopez y est.perez está inscrito en ella (inscripción 1).
 *
 * Ciclo verificado por corrida: borrador (PUT autosave) → retomada
 * (GET) → envío (POST) → auto-calificación ('graded' + monedas por el
 * trigger). Para que corridas repetidas no choquen con uq_submission
 * (una entrega por actividad e inscripción), la spec crea SUS PROPIAS
 * actividades en el beforeAll (títulos con timestamp) y las publica:
 * el seed solo se lee y cada corrida trabaja sobre actividades nuevas.
 * Las actividades se eliminan lógicamente en el afterAll; las entregas
 * quedan (la BD conserva el historial, AGENTS.md §6).
 *
 * Las monedas se verifican por DELTA (antes/después de cada operación):
 * cada corrida acredita +120 a est.perez por la entrega calificada.
 */

const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

/** Preguntas con la MISMA estructura del JSONB de la seed (§7). */
const PREGUNTAS = [
  {
    position: 1,
    type: 'test',
    prompt: 'What is x in 3x + 6 = 15?',
    score: 5,
    options: [
      { text: '1', is_correct: false },
      { text: '3', is_correct: true },
      { text: '5', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Complete: the solution of x - 2 = 4 is x = ___',
    score: 5,
    expected_answer: '6',
  },
] as const;

/** Actividad con una pregunta file: no se puede responder (subida pendiente). */
const PREGUNTA_FILE = [
  {
    position: 1,
    type: 'file',
    prompt: 'Upload your solution as PDF',
    score: 5,
  },
] as const;

/** Actividad con una pregunta manual (minigame): nunca se auto-califica. */
const PREGUNTAS_MINIGAME = [
  {
    position: 1,
    type: 'test',
    prompt: 'What is x in 3x + 6 = 15?',
    score: 5,
    options: [
      { text: '1', is_correct: false },
      { text: '3', is_correct: true },
      { text: '5', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'minigame',
    prompt: 'Describe your best run',
    score: 5,
  },
] as const;

/** Borrador parcial: solo la primera pregunta respondida. */
const BORRADOR_PARCIAL = [{ question_position: 1, option: '3' }];

/** Envío completo y CORRECTO: 2/2 (umbral alcanzado). */
const RESPUESTAS_VALIDAS = [
  { question_position: 1, option: '3' },
  { question_position: 2, text: '6' },
];

/** Misma entrega con la primera respuesta MAL: 1/2 = 50% < umbral. */
const RESPUESTAS_UMBRAL_FALLIDO = [
  { question_position: 1, option: '1' },
  { question_position: 2, text: '6' },
];

/** Respuestas a la actividad con minigame: test correcta + manual. */
const RESPUESTAS_MINIGAME = [
  { question_position: 1, option: '3' },
  { question_position: 2, text: 'nivel 3' },
];

const RECOMPENSA = 120;

describe('Entregas: borrador, retomada y envío (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenAdmin = '';
  /** Actividad publicada de esta corrida: 2 preguntas auto-calificables. */
  let idActividad = '';
  /** Borrador: para el estudiante todavía no existe (404). */
  let idDraft = '';
  /** Clase nueva del profesor: est.perez NO está inscrito en ella. */
  let idClaseAjena = '';
  /** Actividad publicada de la clase ajena: est.perez no puede verla. */
  let idActividadAjena = '';
  /** Actividad con pregunta file: la respuesta se rechaza con 400. */
  let idActividadFile = '';
  /** Actividad auto-calificable usada para fallar el umbral (50%). */
  let idActividadUmbral = '';
  /** Actividad con pregunta minigame: queda pendiente del profesor. */
  let idActividadMinigame = '';

  const crearActividad = async (
    claseId: string,
    titulo: string,
    preguntas: unknown,
    recompensaMonedas?: number,
  ): Promise<string> => {
    const respuesta = await httpServer
      .post(`/api/v1/classes/${claseId}/activities`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        titulo,
        preguntas,
        ...(recompensaMonedas !== undefined ? { recompensaMonedas } : {}),
      });
    expect(respuesta.status).toBe(201);
    return respuesta.body.actividad.id as string;
  };

  const publicarActividad = async (id: string): Promise<void> => {
    const respuesta = await httpServer
      .post(`/api/v1/activities/${id}/publicar`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({});
    expect(respuesta.status).toBe(200);
  };

  const guardarBorrador = (
    id: string,
    respuestas: unknown,
    token: string = tokenEstudiante,
  ) =>
    httpServer
      .put(`/api/v1/activities/${id}/submissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ respuestas });

  const miEntrega = (id: string, token: string = tokenEstudiante) =>
    httpServer
      .get(`/api/v1/activities/${id}/submissions`)
      .set('Authorization', `Bearer ${token}`);

  const entregar = (
    id: string,
    respuestas: unknown,
    token: string = tokenEstudiante,
  ) =>
    httpServer
      .post(`/api/v1/activities/${id}/submissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ respuestas });

  /** Monedas ganadas de la inscripción de est.perez en Mathematics 10A. */
  const monedasGanadas = async (): Promise<number> => {
    const inscripcion = await prisma.enrollments.findFirst({
      where: {
        classes: { name: 'Mathematics 10A' },
        users: { username: 'est.perez' },
      },
      select: { coins_earned: true },
    });
    expect(inscripcion).not.toBeNull();
    return inscripcion!.coins_earned;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const loginProfesor = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR);
    const loginEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ESTUDIANTE);
    const loginAdmin = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    // Si el login falla, todo lo demás daría falsos negativos: fallar
    // aquí con el status real es el diagnóstico más claro. El endpoint
    // de login responde 201 (POST de NestJS), como el resto de la API.
    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);
    expect(loginAdmin.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;

    const sello = Date.now();

    // Actividad publicada propia de esta corrida (en la clase 1 del
    // seed, donde est.perez está inscrito): recompensa 120 monedas que
    // el trigger debe acreditar al auto-calificarse (fn_award_coins).
    idActividad = await crearActividad(
      '1',
      `E2E Entregas: ecuaciones ${sello}`,
      PREGUNTAS,
      RECOMPENSA,
    );
    await publicarActividad(idActividad);

    // Borrador en la misma clase: el estudiante inscrito NO lo ve.
    idDraft = await crearActividad(
      '1',
      `E2E Entregas (draft) ${sello}`,
      PREGUNTAS,
    );

    // Clase nueva del profesor: est.perez no tiene inscripción en ella,
    // así que su actividad publicada tampoco es visible para él.
    const clase = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: `E2E Entregas clase ajena ${sello}` });
    expect(clase.status).toBe(201);
    idClaseAjena = clase.body.clase.id as string;
    idActividadAjena = await crearActividad(
      idClaseAjena,
      `E2E Entregas (ajena) ${sello}`,
      PREGUNTAS,
    );
    await publicarActividad(idActividadAjena);

    // Actividad con una pregunta file en la clase 1.
    idActividadFile = await crearActividad(
      '1',
      `E2E Entregas (file) ${sello}`,
      PREGUNTA_FILE,
      RECOMPENSA,
    );
    await publicarActividad(idActividadFile);

    // Actividad auto-calificable para el caso de umbral fallido.
    idActividadUmbral = await crearActividad(
      '1',
      `E2E Entregas (umbral) ${sello}`,
      PREGUNTAS,
      RECOMPENSA,
    );
    await publicarActividad(idActividadUmbral);

    // Actividad con pregunta minigame en la clase 1.
    idActividadMinigame = await crearActividad(
      '1',
      `E2E Entregas (minigame) ${sello}`,
      PREGUNTAS_MINIGAME,
      RECOMPENSA,
    );
    await publicarActividad(idActividadMinigame);
  });

  afterAll(async () => {
    // Limpieza: borrado LÓGICO de las actividades de esta corrida
    // (AGENTS.md §6) y archivo de la clase extra. Las entregas creadas
    // quedan en la BD: son el historial de las actividades eliminadas.
    for (const id of [
      idActividad,
      idDraft,
      idActividadAjena,
      idActividadFile,
      idActividadUmbral,
      idActividadMinigame,
    ]) {
      if (id !== '') {
        const respuesta = await httpServer
          .delete(`/api/v1/activities/${id}`)
          .set('Authorization', `Bearer ${tokenProfesor}`);
        expect(respuesta.status).toBe(204);
      }
    }
    if (idClaseAjena !== '') {
      const respuesta = await httpServer
        .patch(`/api/v1/classes/${idClaseAjena}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });
      expect(respuesta.status).toBe(200);
    }
    await app.close();
  });

  describe('acceso y validación', () => {
    it('sin token: 401 antes de cualquier verificación (GET, PUT y POST)', async () => {
      expect(
        (await httpServer.get(`/api/v1/activities/${idActividad}/submissions`))
          .status,
      ).toBe(401);
      expect(
        (
          await httpServer
            .put(`/api/v1/activities/${idActividad}/submissions`)
            .send({ respuestas: BORRADOR_PARCIAL })
        ).status,
      ).toBe(401);
      expect(
        (
          await httpServer
            .post(`/api/v1/activities/${idActividad}/submissions`)
            .send({ respuestas: RESPUESTAS_VALIDAS })
        ).status,
      ).toBe(401);
    });

    it('el profesor no usa el flujo del estudiante (403 en GET, PUT y POST)', async () => {
      expect((await miEntrega(idActividad, tokenProfesor)).status).toBe(403);
      expect(
        (await guardarBorrador(idActividad, BORRADOR_PARCIAL, tokenProfesor))
          .status,
      ).toBe(403);
      expect(
        (await entregar(idActividad, RESPUESTAS_VALIDAS, tokenProfesor)).status,
      ).toBe(403);
    });

    it('el admin tampoco (403: flujo del estudiante)', async () => {
      expect((await miEntrega(idActividad, tokenAdmin)).status).toBe(403);
    });

    it('400 si el PUT no lleva respuestas', async () => {
      const respuesta = await httpServer
        .put(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({});
      expect(respuesta.status).toBe(400);
    });

    it('400 si el PUT intenta colar el estado: no se acepta jamás', async () => {
      const respuesta = await httpServer
        .put(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ respuestas: BORRADOR_PARCIAL, estado: 'graded' });
      expect(respuesta.status).toBe(400);
      // ValidationPipe con forbidNonWhitelisted: el mensaje llega como
      // arreglo de strings.
      expect(respuesta.body.message).toContain(
        'property estado should not exist',
      );
    });

    it('400 si el POST intenta colar el estado: no se acepta jamás', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ respuestas: RESPUESTAS_VALIDAS, estado: 'graded' });
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toContain(
        'property estado should not exist',
      );
    });
  });

  describe('borrador: guardar y retomar (PUT/GET)', () => {
    it('GET sin entrega todavía: 404 estándar', async () => {
      const respuesta = await miEntrega(idActividad);
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('PUT parcial crea el borrador in_progress SIN veredictos ni fecha de envío', async () => {
      const respuesta = await guardarBorrador(idActividad, BORRADOR_PARCIAL);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_BORRADOR_GUARDADO);
      expect(respuesta.body.entrega).toEqual({
        id: expect.any(String),
        actividadId: idActividad,
        estado: 'in_progress',
        entregadoEn: null,
        puntaje: null,
        monedasOtorgadas: 0,
        respuestas: BORRADOR_PARCIAL,
      });
      // AGENTS.md §9.5: mientras resuelve, nada de lo correcto se filtra.
      expect(JSON.stringify(respuesta.body)).not.toContain('is_correct');
      expect(JSON.stringify(respuesta.body)).not.toContain('"score"');
    });

    it('GET devuelve el borrador tal cual: el estudiante retoma donde iba', async () => {
      const respuesta = await miEntrega(idActividad);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('in_progress');
      expect(respuesta.body.respuestas).toEqual(BORRADOR_PARCIAL);
    });

    it('PUT con respuestas vacías ([]) también guarda: recién abre la actividad', async () => {
      const respuesta = await guardarBorrador(idActividad, []);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.entrega.estado).toBe('in_progress');
      expect(respuesta.body.entrega.respuestas).toEqual([]);
    });

    it('PUT sucesivo reemplaza las respuestas del borrador (autosave por cambio)', async () => {
      const respuesta = await guardarBorrador(idActividad, RESPUESTAS_VALIDAS);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.entrega.respuestas).toEqual(RESPUESTAS_VALIDAS);
    });

    it('PUT con una posición inexistente: 400', async () => {
      const respuesta = await guardarBorrador(idActividad, [
        { question_position: 99, option: '3' },
      ]);
      expect(respuesta.status).toBe(400);
    });

    it('PUT respondiendo una pregunta file: 400 (subida de archivos pendiente)', async () => {
      const respuesta = await guardarBorrador(idActividadFile, [
        { question_position: 1, text: 'mi-solucion.pdf' },
      ]);
      expect(respuesta.status).toBe(400);
    });

    it('PUT en actividad draft: 404 (para el estudiante aún no existe)', async () => {
      const respuesta = await guardarBorrador(idDraft, BORRADOR_PARCIAL);
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('PUT en actividad de una clase a la que NO está inscrito: 404', async () => {
      const respuesta = await guardarBorrador(
        idActividadAjena,
        BORRADOR_PARCIAL,
      );
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('PUT/GET en actividad inexistente: el mismo 404 (anti-enumeración)', async () => {
      expect((await guardarBorrador('999999', BORRADOR_PARCIAL)).status).toBe(
        404,
      );
      expect((await miEntrega('999999')).status).toBe(404);
    });
  });

  describe('envío: cierra el borrador y auto-califica (POST)', () => {
    it('POST con todo correcto envía el borrador → graded y el trigger acredita las monedas', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await entregar(idActividad, RESPUESTAS_VALIDAS);

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_CALIFICADA);
      expect(respuesta.body.entrega).toEqual({
        id: expect.any(String),
        actividadId: idActividad,
        estado: 'graded',
        entregadoEn: expect.any(String),
        puntaje: 10,
        monedasOtorgadas: RECOMPENSA,
        respuestas: [
          {
            question_position: 1,
            option: '3',
            is_correct: true,
            score: 5,
          },
          {
            question_position: 2,
            text: '6',
            is_correct: true,
            score: 5,
          },
        ],
      });
      // La respuesta correcta jamás viaja (AGENTS.md §9.5): solo el
      // veredicto de lo que el estudiante envió.
      expect(JSON.stringify(respuesta.body)).not.toContain('expected_answer');

      // fn_award_coins (trigger) acreditó la recompensa UNA vez: el
      // contador de la inscripción sube exactamente la recompensa.
      expect(await monedasGanadas()).toBe(monedasAntes + RECOMPENSA);
    });

    it('GET después del envío devuelve el RESULTADO (ya no el borrador)', async () => {
      const respuesta = await miEntrega(idActividad);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('graded');
      expect(respuesta.body.entregadoEn).toEqual(expect.any(String));
      expect(respuesta.body.puntaje).toBe(10);
      expect(respuesta.body.monedasOtorgadas).toBe(RECOMPENSA);
      expect(respuesta.body.respuestas[0].is_correct).toBe(true);
    });

    it('PUT tras enviar: 409 — nunca se baja de submitted a borrador', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await guardarBorrador(idActividad, BORRADOR_PARCIAL);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_YA_ENVIADA);
      expect(await monedasGanadas()).toBe(monedasAntes);
    });

    it('POST duplicado: 409 y sin doble pago de monedas', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await entregar(idActividad, RESPUESTAS_VALIDAS);

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_DUPLICADA);
      expect(await monedasGanadas()).toBe(monedasAntes);
    });

    it('POST faltando una pregunta: 400 de completitud (corre antes que el duplicado)', async () => {
      const respuesta = await entregar(idActividad, BORRADOR_PARCIAL);

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toMatch(/Falta responder la pregunta 2/);
    });

    it('POST vacío: 400 con las posiciones que faltan', async () => {
      const respuesta = await entregar(idActividad, []);

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toMatch(
        /Falta responder las preguntas 1, 2/,
      );
    });
  });

  describe('umbral del 80% y preguntas de calificación manual', () => {
    it('1 de 2 correctas (50%): queda submitted SIN monedas, con la evaluación guardada', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await entregar(
        idActividadUmbral,
        RESPUESTAS_UMBRAL_FALLIDO,
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
      expect(respuesta.body.entrega.estado).toBe('submitted');
      expect(respuesta.body.entrega.puntaje).toBeNull();
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
      expect(respuesta.body.entrega.respuestas).toEqual([
        {
          question_position: 1,
          option: '1',
          is_correct: false,
          score: 0,
        },
        {
          question_position: 2,
          text: '6',
          is_correct: true,
          score: 5,
        },
      ]);
      // Sin paso a graded no hay trigger: las monedas quedan igual.
      expect(await monedasGanadas()).toBe(monedasAntes);
    });

    it('actividad con pregunta minigame: queda submitted pendiente aunque el test esté bien', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await entregar(
        idActividadMinigame,
        RESPUESTAS_MINIGAME,
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
      expect(respuesta.body.entrega.estado).toBe('submitted');
      expect(respuesta.body.entrega.puntaje).toBeNull();
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
      expect(respuesta.body.entrega.respuestas).toEqual([
        {
          question_position: 1,
          option: '3',
          is_correct: true,
          score: 5,
        },
        {
          question_position: 2,
          text: 'nivel 3',
          is_correct: null,
          score: null,
        },
      ]);
      expect(await monedasGanadas()).toBe(monedasAntes);
    });

    it('actividad solo con pregunta file: se envía sin respuestas y queda pendiente del profesor', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await entregar(idActividadFile, []);

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
      expect(respuesta.body.entrega.estado).toBe('submitted');
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
      expect(await monedasGanadas()).toBe(monedasAntes);
    });
  });
});
