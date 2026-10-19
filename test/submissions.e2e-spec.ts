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
  /** Actividad de la COLA: entregas de est.perez (graded) y est.gomez (submitted). */
  let idActividadCola = '';
  /** Actividad de la CALIFICACIÓN: est.perez (graded) y est.gomez (rejected). */
  let idActividadCalificar = '';
  /** Ids de las entregas de esa actividad (capturados en el flujo). */
  let idEntregaPerez = '';
  let idEntregaGomez = '';
  /** Actividad publicada de OTRO profesor (fixture): su cola da 404. */
  let idActividadAjenaCola = BigInt(0);
  /** Fixture del profesor ajeno: se limpia FÍSICAMENTE en afterAll. */
  let idProfesorAjenoCola = BigInt(0);
  let idClaseAjenaCola = BigInt(0);

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

  /** Cola de calificación del profesor (paginación y ?estado en query). */
  const cola = (
    id: string,
    query: string = '',
    token: string = tokenProfesor,
  ) =>
    httpServer
      .get(`/api/v1/activities/${id}/submissions/queue${query}`)
      .set('Authorization', `Bearer ${token}`);

  /** Vista de revisión de UNA entrega de la actividad. */
  const detalleEntrega = (
    id: string,
    entregaId: string,
    token: string = tokenProfesor,
  ) =>
    httpServer
      .get(`/api/v1/activities/${id}/submissions/${entregaId}`)
      .set('Authorization', `Bearer ${token}`);

  /** Califica (graded/rejected) una entrega pendiente. */
  const calificar = (
    id: string,
    entregaId: string,
    cuerpo: object,
    token: string = tokenProfesor,
  ) =>
    httpServer
      .post(`/api/v1/activities/${id}/submissions/${entregaId}/calificar`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

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

    // ---------------------------------------------------------------
    // Cola de calificación del profesor: actividad con las entregas de
    // DOS estudiantes para ejercitar paginación, filtro por estado y el
    // join con los datos del estudiante.
    // ---------------------------------------------------------------
    idActividadCola = await crearActividad(
      '1',
      `E2E Cola: entregas ${sello}`,
      PREGUNTAS,
      RECOMPENSA,
    );
    await publicarActividad(idActividadCola);

    // est.perez envía por la API REAL: todo correcto → 'graded' con
    // puntaje 10 y las monedas del trigger.
    const entregaPerez = await entregar(idActividadCola, RESPUESTAS_VALIDAS);
    expect(entregaPerez.status).toBe(201);

    // La entrega de est.gomez se provisiona directo en la BD como
    // 'submitted' (la pendiente de calificar): su inscripción en la
    // clase de la actividad es ACTIVA (seed) y el INSERT pasa
    // fn_validate_submission. Con submitted_at UNA HORA ANTES que la de
    // est.perez: la cola FIFO la lista primero (orden determinístico).
    const inscripcionGomez = await prisma.enrollments.findFirstOrThrow({
      where: {
        classes: { activities: { some: { id: BigInt(idActividadCola) } } },
        users: { username: 'est.gomez' },
        status: 'active',
      },
      select: { id: true },
    });
    await prisma.submissions.create({
      data: {
        activity_id: BigInt(idActividadCola),
        enrollment_id: inscripcionGomez.id,
        status: 'submitted',
        submitted_at: new Date(Date.now() - 3_600_000),
        answers: [],
      },
      select: { id: true },
    });

    // ---------------------------------------------------------------
    // Calificación del profesor: actividad con UNA entrega 'submitted'
    // por estudiante. La de est.perez nace por la API REAL dentro del
    // flujo de pruebas (umbral al 50% → queda pendiente); la de
    // est.gomez se provisiona directo en la BD (formato evaluado en el
    // JSONB, como lo dejaría el envío) para el caso rejected.
    // ---------------------------------------------------------------
    idActividadCalificar = await crearActividad(
      '1',
      `E2E Calificar: entregas ${sello}`,
      PREGUNTAS,
      RECOMPENSA,
    );
    await publicarActividad(idActividadCalificar);

    const inscripcionGomezCalificar = await prisma.enrollments.findFirstOrThrow(
      {
        where: {
          classes: {
            activities: { some: { id: BigInt(idActividadCalificar) } },
          },
          users: { username: 'est.gomez' },
          status: 'active',
        },
        select: { id: true },
      },
    );
    const entregaGomez = await prisma.submissions.create({
      data: {
        activity_id: BigInt(idActividadCalificar),
        enrollment_id: inscripcionGomezCalificar.id,
        status: 'submitted',
        submitted_at: new Date(Date.now() - 1_800_000),
        answers: [
          { question_position: 1, option: '1', is_correct: false, score: 0 },
          { question_position: 2, text: '6', is_correct: true, score: 5 },
        ],
      },
      select: { id: true },
    });
    idEntregaGomez = entregaGomez.id.toString();

    // Profesor AJENO (fixture directa en la BD: nunca inicia sesión, no
    // necesita hash real) con su clase y actividad publicada — para
    // verificar el 404 estándar anti-enumeración en la cola ajena.
    const colegio = await prisma.organizations.findFirstOrThrow({
      where: { name: 'Colegio Demo' },
      select: { id: true },
    });
    const profesorAjeno = await prisma.users.create({
      data: {
        organization_id: colegio.id,
        role: 'teacher',
        username: `e2e.cola.prof.${sello}`,
        email: `e2e.cola.prof.${sello}@educoins.test`,
        password_hash: 'HASH_NUNCA_INICIA_SESION',
        first_name: 'Profesor',
        last_name: 'Ajeno',
      },
      select: { id: true },
    });
    idProfesorAjenoCola = profesorAjeno.id;
    const claseAjena = await prisma.classes.create({
      data: {
        teacher_id: idProfesorAjenoCola,
        name: `E2E Cola clase ajena ${sello}`,
      },
      select: { id: true },
    });
    idClaseAjenaCola = claseAjena.id;
    const actividadAjena = await prisma.activities.create({
      data: {
        class_id: idClaseAjenaCola,
        title: `E2E Cola (ajena) ${sello}`,
        status: 'published',
        published_at: new Date(),
        questions: [...PREGUNTAS],
      },
      select: { id: true },
    });
    idActividadAjenaCola = actividadAjena.id;
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
      idActividadCola,
      idActividadCalificar,
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
    // La fixture del profesor ajeno no tiene entregas ni inscripciones:
    // su limpieza FÍSICA en orden de FK (actividad → clase → usuario)
    // es segura (mismo criterio que test/users-alejandro.e2e-spec.ts).
    if (idActividadAjenaCola !== BigInt(0)) {
      await prisma.activities.delete({
        where: { id: idActividadAjenaCola },
        select: { id: true },
      });
    }
    if (idClaseAjenaCola !== BigInt(0)) {
      await prisma.classes.delete({
        where: { id: idClaseAjenaCola },
        select: { id: true },
      });
    }
    if (idProfesorAjenoCola !== BigInt(0)) {
      await prisma.users.delete({
        where: { id: idProfesorAjenoCola },
        select: { id: true },
      });
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
        feedback: null,
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

  describe('cola de calificación del profesor (GET queue)', () => {
    it('lista TODAS las entregas en FIFO (la más antigua primero) con los datos del estudiante', async () => {
      const respuesta = await cola(idActividadCola);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({ total: 2, page: 1, limit: 20 });
      expect(respuesta.body.data).toHaveLength(2);

      // FIFO: est.gomez se envió una hora ANTES que est.perez. Los datos
      // del estudiante viajan completos, pero las aserciones usan
      // username (ASCII): en la BD de desarrollo el seed quedó con
      // acentos mojibake (mismo criterio que classes.e2e-spec.ts).
      expect(respuesta.body.data[0].estudiante).toEqual({
        id: expect.any(String),
        usuario: 'est.gomez',
        nombre: expect.any(String),
        apellido: expect.any(String),
      });
      expect(respuesta.body.data[0].estado).toBe('submitted');
      expect(respuesta.body.data[0].entregadoEn).toEqual(expect.any(String));
      expect(respuesta.body.data[0].puntaje).toBeNull();
      expect(respuesta.body.data[0].monedasOtorgadas).toBe(0);

      // La de est.perez salió auto-calificada: puntaje y monedas del trigger.
      expect(respuesta.body.data[1].estudiante.usuario).toBe('est.perez');
      expect(respuesta.body.data[1].estado).toBe('graded');
      expect(respuesta.body.data[1].puntaje).toBe(10);
      expect(respuesta.body.data[1].monedasOtorgadas).toBe(RECOMPENSA);

      // El listado es un resumen: las respuestas de los estudiantes no viajan.
      expect(JSON.stringify(respuesta.body)).not.toContain('respuestas');
      expect(JSON.stringify(respuesta.body)).not.toContain('answers');
    });

    it('?estado=submitted: SOLO las pendientes de calificar (la cola de revisión)', async () => {
      const respuesta = await cola(idActividadCola, '?estado=submitted');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta.total).toBe(1);
      expect(respuesta.body.data).toHaveLength(1);
      expect(respuesta.body.data[0].estudiante.usuario).toBe('est.gomez');
      expect(respuesta.body.data[0].estado).toBe('submitted');
    });

    it('?estado=graded: SOLO las calificadas', async () => {
      const respuesta = await cola(idActividadCola, '?estado=graded');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta.total).toBe(1);
      expect(respuesta.body.data[0].estudiante.usuario).toBe('est.perez');
      expect(respuesta.body.data[0].estado).toBe('graded');
      expect(respuesta.body.data[0].puntaje).toBe(10);
    });

    it('paginación: ?limit=1 divide la cola en dos páginas (FIFO en cada una)', async () => {
      const pagina1 = await cola(idActividadCola, '?limit=1');
      expect(pagina1.status).toBe(200);
      expect(pagina1.body.data).toHaveLength(1);
      expect(pagina1.body.meta).toEqual({ total: 2, page: 1, limit: 1 });
      expect(pagina1.body.data[0].estudiante.usuario).toBe('est.gomez');

      const pagina2 = await cola(idActividadCola, '?limit=1&page=2');
      expect(pagina2.status).toBe(200);
      expect(pagina2.body.data).toHaveLength(1);
      expect(pagina2.body.meta).toEqual({ total: 2, page: 2, limit: 1 });
      expect(pagina2.body.data[0].estudiante.usuario).toBe('est.perez');
    });

    it('actividad suya sin entregas: 200 con la cola vacía', async () => {
      const respuesta = await cola(idDraft);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('?estado fuera del enum real: 400 del ValidationPipe', async () => {
      const respuesta = await cola(idActividadCola, '?estado=pending');
      expect(respuesta.status).toBe(400);
    });

    it('el estudiante no usa la cola (403: RolesGuard corre antes de la pertenencia)', async () => {
      expect((await cola(idActividadCola, '', tokenEstudiante)).status).toBe(
        403,
      );
    });

    it('el admin tampoco (403: la cola es del profesor dueño de la actividad)', async () => {
      expect((await cola(idActividadCola, '', tokenAdmin)).status).toBe(403);
    });

    it('sin token: 401 antes de cualquier verificación', async () => {
      const respuesta = await httpServer.get(
        `/api/v1/activities/${idActividadCola}/submissions/queue`,
      );
      expect(respuesta.status).toBe(401);
    });

    it('actividad inexistente: el 404 estándar (anti-enumeración)', async () => {
      const respuesta = await cola('999999');
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('actividad de OTRO profesor: el MISMO 404 (no revela que existe)', async () => {
      const respuesta = await cola(idActividadAjenaCola.toString());
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });
  });

  describe('calificación del profesor (GET detalle + POST calificar)', () => {
    it('PUT crea el borrador de est.perez (el in_progress que NO se puede calificar)', async () => {
      const respuesta = await guardarBorrador(
        idActividadCalificar,
        BORRADOR_PARCIAL,
      );

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.entrega.estado).toBe('in_progress');
    });

    it('calificar un borrador in_progress: 409 (nada enviado, nada que calificar)', async () => {
      const borrador = await miEntrega(idActividadCalificar);
      expect(borrador.status).toBe(200);
      const idBorrador = borrador.body.id as string;

      const respuesta = await calificar(idActividadCalificar, idBorrador, {
        decision: 'graded',
        puntaje: 10,
      });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_NO_PENDIENTE);
    });

    it('est.perez envía (umbral al 50%): queda submitted pendiente del profesor', async () => {
      const respuesta = await entregar(
        idActividadCalificar,
        RESPUESTAS_UMBRAL_FALLIDO,
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
      expect(respuesta.body.entrega.estado).toBe('submitted');
      idEntregaPerez = respuesta.body.entrega.id as string;
    });

    it('GET detalle: la vista de revisión con veredictos, estudiante y feedback vacío', async () => {
      const respuesta = await detalleEntrega(
        idActividadCalificar,
        idEntregaPerez,
      );

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        id: idEntregaPerez,
        estudiante: {
          id: expect.any(String),
          usuario: 'est.perez',
          // La BD de desarrollo quedó con acentos mojibake del seed
          // (mismo criterio que classes.e2e-spec.ts): username ASCII.
          nombre: expect.any(String),
          apellido: expect.any(String),
        },
        estado: 'submitted',
        entregadoEn: expect.any(String),
        calificadoEn: null,
        puntaje: null,
        monedasOtorgadas: 0,
        feedback: null,
        respuestas: [
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
        ],
      });
    });

    it('POST calificar graded: 200 con la calificación y las monedas del TRIGGER', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await calificar(idActividadCalificar, idEntregaPerez, {
        decision: 'graded',
        puntaje: 7.5,
        feedback: 'Bien en general; revisa el planteo del ejercicio 1.',
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_CALIFICADA_PROFESOR);
      expect(respuesta.body.entrega.estado).toBe('graded');
      expect(respuesta.body.entrega.puntaje).toBe(7.5);
      expect(respuesta.body.entrega.calificadoEn).toEqual(expect.any(String));
      expect(respuesta.body.entrega.feedback).toBe(
        'Bien en general; revisa el planteo del ejercicio 1.',
      );
      // fn_award_coins acreditó la recompensa recién AL CALIFICAR el
      // profesor (la entrega venía 'submitted' sin monedas).
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(RECOMPENSA);
      expect(await monedasGanadas()).toBe(monedasAntes + RECOMPENSA);
    });

    it('el estudiante VE la calificación y el feedback (GET mi entrega)', async () => {
      const respuesta = await miEntrega(idActividadCalificar);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('graded');
      expect(respuesta.body.puntaje).toBe(7.5);
      expect(respuesta.body.monedasOtorgadas).toBe(RECOMPENSA);
      expect(respuesta.body.feedback).toBe(
        'Bien en general; revisa el planteo del ejercicio 1.',
      );
      // Los veredictos por respuesta siguen viajando al estudiante.
      expect(respuesta.body.respuestas[0].is_correct).toBe(false);
    });

    it('RE-calificar la graded: 409 y SIN doble pago de monedas', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await calificar(idActividadCalificar, idEntregaPerez, {
        decision: 'graded',
        puntaje: 10,
        feedback: 'cambio de opinión',
      });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_NO_PENDIENTE);
      // El status no se reescribe: el trigger no volvió a disparar.
      expect(await monedasGanadas()).toBe(monedasAntes);
    });

    it('POST calificar rejected: 200 SIN puntaje ni monedas (el trigger solo paga en graded)', async () => {
      const respuesta = await calificar(idActividadCalificar, idEntregaGomez, {
        decision: 'rejected',
        feedback: 'La respuesta del ejercicio 2 no corresponde: reenvíala.',
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_RECHAZADA);
      expect(respuesta.body.entrega.estado).toBe('rejected');
      expect(respuesta.body.entrega.puntaje).toBeNull();
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
      expect(respuesta.body.entrega.calificadoEn).toBeNull();
      expect(respuesta.body.entrega.feedback).toBe(
        'La respuesta del ejercicio 2 no corresponde: reenvíala.',
      );
    });

    it('la cola ya no tiene pendientes: graded y rejected por separado', async () => {
      const pendientes = await cola(idActividadCalificar, '?estado=submitted');
      expect(pendientes.status).toBe(200);
      expect(pendientes.body.data).toEqual([]);
      expect(pendientes.body.meta.total).toBe(0);

      const calificadas = await cola(idActividadCalificar, '?estado=graded');
      expect(calificadas.body.meta.total).toBe(1);
      expect(calificadas.body.data[0].estudiante.usuario).toBe('est.perez');

      const rechazadas = await cola(idActividadCalificar, '?estado=rejected');
      expect(rechazadas.body.meta.total).toBe(1);
      expect(rechazadas.body.data[0].estudiante.usuario).toBe('est.gomez');
    });

    describe('acceso y validación', () => {
      it('el estudiante y el admin no revisan ni califican (403)', async () => {
        expect(
          (
            await detalleEntrega(
              idActividadCalificar,
              idEntregaPerez,
              tokenEstudiante,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await calificar(
              idActividadCalificar,
              idEntregaPerez,
              { decision: 'graded', puntaje: 5 },
              tokenEstudiante,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await detalleEntrega(
              idActividadCalificar,
              idEntregaPerez,
              tokenAdmin,
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await calificar(
              idActividadCalificar,
              idEntregaPerez,
              { decision: 'graded', puntaje: 5 },
              tokenAdmin,
            )
          ).status,
        ).toBe(403);
      });

      it('sin token: 401 antes de cualquier verificación (GET y POST)', async () => {
        const detalle = await httpServer.get(
          `/api/v1/activities/${idActividadCalificar}/submissions/${idEntregaPerez}`,
        );
        expect(detalle.status).toBe(401);

        const calificacion = await httpServer
          .post(
            `/api/v1/activities/${idActividadCalificar}/submissions/${idEntregaPerez}/calificar`,
          )
          .send({ decision: 'graded', puntaje: 5 });
        expect(calificacion.status).toBe(401);
      });

      it('entrega inexistente o de OTRA actividad: el mismo 404 (anti-enumeración)', async () => {
        const inexistente = await detalleEntrega(
          idActividadCalificar,
          '999999',
        );
        expect(inexistente.status).toBe(404);
        expect(inexistente.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

        // La entrega existe pero es de OTRA actividad del mismo
        // profesor (la de la cola): el where exige el match → 404.
        const deOtraActividad = await detalleEntrega(
          idActividadCola,
          idEntregaPerez,
        );
        expect(deOtraActividad.status).toBe(404);
        expect(deOtraActividad.body.message).toBe(
          MENSAJE_RECURSO_NO_ENCONTRADO,
        );

        const calificarEnOtra = await calificar(
          idActividadCola,
          idEntregaPerez,
          {
            decision: 'graded',
            puntaje: 5,
          },
        );
        expect(calificarEnOtra.status).toBe(404);
        expect(calificarEnOtra.body.message).toBe(
          MENSAJE_RECURSO_NO_ENCONTRADO,
        );
      });

      it('actividad de OTRO profesor: el mismo 404 (pertenencia)', async () => {
        const detalle = await detalleEntrega(
          idActividadAjenaCola.toString(),
          idEntregaPerez,
        );
        expect(detalle.status).toBe(404);
        expect(detalle.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

        const calificacion = await calificar(
          idActividadAjenaCola.toString(),
          idEntregaPerez,
          { decision: 'graded', puntaje: 5 },
        );
        expect(calificacion.status).toBe(404);
        expect(calificacion.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
      });

      it('decision fuera de graded/rejected: 400 del ValidationPipe', async () => {
        const respuesta = await calificar(
          idActividadCalificar,
          idEntregaGomez,
          {
            decision: 'pending',
          },
        );
        expect(respuesta.status).toBe(400);
      });

      it('graded sin puntaje: 400 con el mensaje del Service', async () => {
        const respuesta = await calificar(
          idActividadCalificar,
          idEntregaGomez,
          {
            decision: 'graded',
          },
        );
        expect(respuesta.status).toBe(400);
        expect(respuesta.body.message).toBe(MENSAJE_PUNTAJE_REQUERIDO);
      });

      it('rejected con puntaje: 400 (el rechazo no lleva nota)', async () => {
        const respuesta = await calificar(
          idActividadCalificar,
          idEntregaGomez,
          {
            decision: 'rejected',
            puntaje: 5,
          },
        );
        expect(respuesta.status).toBe(400);
        expect(respuesta.body.message).toBe(MENSAJE_PUNTAJE_NO_EN_RECHAZO);
      });

      it('puntaje por encima del total de la actividad: 422', async () => {
        const respuesta = await calificar(
          idActividadCalificar,
          idEntregaGomez,
          {
            decision: 'graded',
            puntaje: 999,
          },
        );
        expect(respuesta.status).toBe(422);
        expect(respuesta.body.message).toBe(MENSAJE_PUNTAJE_FUERA_DE_RANGO);
      });

      it('feedback de más de 2000 caracteres: 400', async () => {
        const respuesta = await calificar(
          idActividadCalificar,
          idEntregaGomez,
          {
            decision: 'rejected',
            feedback: 'x'.repeat(2001),
          },
        );
        expect(respuesta.status).toBe(400);
      });
    });
  });
});
