import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import { MENSAJE_YA_INSCRIPTO } from '../src/modules/classes/classes.service';
import { MENSAJE_ITEMS_AJENOS } from '../src/modules/items/items.service';
import {
  MENSAJE_ENTREGA_CALIFICADA_PROFESOR,
  MENSAJE_ENTREGA_NO_PENDIENTE,
  MENSAJE_ENTREGA_UMBRAL,
  MENSAJE_PUNTAJE_FUERA_DE_RANGO,
  MENSAJE_PUNTAJE_NO_EN_RECHAZO,
} from '../src/modules/submissions/submissions.service';
import { auditarSinSecretos } from './helpers/auditoria-respuestas';

/**
 * H6.3 / PRO-294 — Suite de regresión del flujo del hito (T6.3.1–T6.3.4).
 *
 * Contra la BD real, en una única corrida: clase → unión → actividad
 * publicada → borrador → entrega `submitted` → calificación del profesor
 * (`fn_award_coins` acredita exactamente `reward_coins`) → recalificación
 * 409 sin doble pago → canje `completed` (CA 1). Después la matriz de
 * negativos: rol equivocado → 403 en cada recurso, recurso ajeno → 404
 * anti-enumeración / ítems 403 uniforme / billetera 403, validaciones →
 * 409/422/400 (CA 2). Cada respuesta pasa por la auditoría de secretos
 * (CA 3) y `coverageThreshold` + CI `test:cov` cierran el CA 4.
 *
 * Aislamiento (spec 039 · S1): los usuarios son los del seed (identidad
 * solo; `e2e-global-setup.cjs` limpia `must_change_password`), pero TODOS
 * los pasos con estado corren en una clase propia nueva por corrida:
 * nada muta el seed y las corridas repetidas no chocan. ≤5 logins por el
 * throttler de auth (S6): entran 4.
 *
 * Orden estricto A → B → C con estado compartido. La auditoría completa
 * (`auditarSinSecretos`, campos `password_hash`/`is_correct`/
 * `expected_answer`) se aplica a toda respuesta salvo las vistas dueño y
 * de veredictos, donde `is_correct`/`expected_answer` viajan por contrato
 * (AGENTS.md §9.5; ver ActividadRespuestaDto y las entregas calificadas):
 * esas pasan por `llamarDocente`, que igual prohíbe `password_hash`.
 */

const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ESTUDIANTE_DOS = {
  usuarioOEmail: 'est.gomez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

/** Hash argon2id real de `Prof123!` (mismo que `db/002_seed.sql`). */
const HASH_PROFESOR_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$wqUUPXJ83uBaR982L251Vw$I2nvzzgs1gh0vW5hu35rL/yQdD7rFzbLsJfk+wQCeGg';

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

/** Borrador parcial: solo la primera pregunta respondida. */
const BORRADOR_PARCIAL = [{ question_position: 1, option: '3' }];

/** Envío con la primera respuesta MAL: 1/2 = 50% < umbral del 80% (S2). */
const RESPUESTAS_UMBRAL_FALLIDO = [
  { question_position: 1, option: '1' },
  { question_position: 2, text: '6' },
];

/** Recompensa propia del fixture: 75 es un valor que ningún otro suite usa. */
const RECOMPENSA = 75;
const COSTO_ITEM = 50;

describe('H6.3 regresión del hito (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenEstudianteDos = '';
  let tokenAdmin = '';

  /** Fixtures de esta corrida (S1). */
  let claseId = 0n;
  let claseCodigo = '';
  let inscripcionId = 0n;
  let estudianteId = 0n;
  let estudianteDosId = 0n;
  let actividadId = '';
  let entregaId = '';
  let itemAId = 0n;
  let canjeId = '';

  /** Recurso ajeno: profesor/clase/actividad/ítem sintéticos (S12). */
  let profesorAjenoId = 0n;
  let claseAjenaId = 0n;
  let actividadAjenaId = 0n;
  let itemAjenoId = 0n;

  let sello = 0;

  /** Cuerpos auditados por `llamar`/`llamarDocente` (C1). */
  const respuestasAuditadas: unknown[] = [];

  /**
   * Ejecuta la petición y audita la respuesta con `auditarSinSecretos`
   * (un hallazgo lanza aquí mismo, en el paso exacto).
   */
  async function llamar<T extends { status: number; body: unknown }>(
    contexto: string,
    peticion: PromiseLike<T>,
  ): Promise<T> {
    const respuesta = await peticion;
    auditarSinSecretos(respuesta.body, contexto);
    respuestasAuditadas.push(respuesta.body);
    return respuesta;
  }

  /**
   * Igual que `llamar` para las respuestas que traen `is_correct`/
   * `expected_answer` por contrato (vista dueño de la actividad y
   * veredictos de entregas): solo se prohíbe `password_hash`.
   */
  async function llamarDocente<T extends { status: number; body: unknown }>(
    contexto: string,
    peticion: PromiseLike<T>,
  ): Promise<T> {
    const respuesta = await peticion;
    if (JSON.stringify(respuesta.body).includes('password_hash')) {
      throw new Error(
        `Auditoría de filtraciones falló en "${contexto}": password_hash presente`,
      );
    }
    respuestasAuditadas.push(respuesta.body);
    return respuesta;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    sello = Date.now();

    // 4 logins (≤5 por el throttler de auth; S6). El globalSetup ya puso
    // must_change_password = false en todo el seed.
    const [loginProfesor, loginEstudiante, loginEstudianteDos, loginAdmin] =
      await Promise.all([
        llamar('login profesor', httpServer.post('/api/v1/auth/login').send(LOGIN_PROFESOR)),
        llamar('login estudiante', httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE)),
        llamar('login estudiante 2', httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE_DOS)),
        llamar('login admin', httpServer.post('/api/v1/auth/login').send(LOGIN_ADMIN)),
      ]);
    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);
    expect(loginEstudianteDos.status).toBe(201);
    expect(loginAdmin.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenEstudianteDos = loginEstudianteDos.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;

    const estudiante = await prisma.users.findUnique({
      where: { username: 'est.perez' },
    });
    const estudianteDos = await prisma.users.findUnique({
      where: { username: 'est.gomez' },
    });
    if (!estudiante || !estudianteDos) {
      throw new Error('Faltan est.perez/est.gomez en el seed (002_seed.sql)');
    }
    estudianteId = estudiante.id;
    estudianteDosId = estudianteDos.id;

    // Clase fixture propia por corrida (nombre único por el índice global
    // uq_classes_name sobre lower(name)).
    const clase = await llamar(
      'POST /classes (creación de clase)',
      httpServer
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: `Regresión hito ${sello}` }),
    );
    expect(clase.status).toBe(201);
    claseId = BigInt(clase.body.clase.id);
    claseCodigo = clase.body.clase.codigo;

    // Profesor ajeno sintético (sin login: ahorra throttler) + su clase,
    // actividad publicada e ítem, todo directo en Prisma (S12).
    const org = await prisma.organizations.findFirst({
      where: { name: 'Colegio Demo' },
    });
    if (!org) {
      throw new Error('Falta la organización Colegio Demo en el seed');
    }
    const profesorAjeno = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'teacher',
        username: `prof.regresion.${sello}`,
        email: `prof.regresion.${sello}@educoins.test`,
        password_hash: HASH_PROFESOR_SEED,
        first_name: 'Ajeno',
        last_name: 'Regresión',
        specialty: 'Mathematics',
        must_change_password: false,
      },
    });
    profesorAjenoId = profesorAjeno.id;
    const claseAjena = await prisma.classes.create({
      data: { teacher_id: profesorAjeno.id, name: `Clase ajena regresión ${sello}` },
    });
    claseAjenaId = claseAjena.id;
    const actividadAjena = await prisma.activities.create({
      data: {
        class_id: claseAjena.id,
        title: `Actividad ajena regresión ${sello}`,
        reward_coins: 10,
        status: 'published',
        published_at: new Date(),
        questions: JSON.parse(JSON.stringify(PREGUNTAS)),
      },
    });
    actividadAjenaId = actividadAjena.id;
    const itemAjeno = await prisma.redeemable_items.create({
      data: {
        class_id: claseAjena.id,
        name: `Ítem ajeno regresión ${sello}`,
        type: 'fun_activity',
        cost_coins: 10,
        stock: 1,
      },
    });
    itemAjenoId = itemAjeno.id;
  });

  afterAll(async () => {
    try {
      // FK primero (S1): movimientos → canjes → entregas → inscripción →
      // ítems → actividades → clases → usuario sintético.
      if (inscripcionId !== 0n) {
        await prisma.coin_movements.deleteMany({
          where: { enrollment_id: inscripcionId },
        });
        await prisma.redemptions.deleteMany({
          where: { enrollment_id: inscripcionId },
        });
        await prisma.submissions.deleteMany({
          where: { enrollment_id: inscripcionId },
        });
        await prisma.enrollments.deleteMany({ where: { id: inscripcionId } });
      }
      const clasesPropias = [claseId, claseAjenaId].filter((id) => id !== 0n);
      await prisma.redeemable_items.deleteMany({
        where: { class_id: { in: clasesPropias } },
      });
      await prisma.activities.deleteMany({
        where: { class_id: { in: clasesPropias } },
      });
      await prisma.classes.deleteMany({ where: { id: { in: clasesPropias } } });
      if (profesorAjenoId !== 0n) {
        await prisma.users.deleteMany({ where: { id: profesorAjenoId } });
      }
    } finally {
      await app.close();
    }
  });

  /** Saldo real de la inscripción fixture (aislada de otros suites). */
  async function saldoInscripcion(): Promise<{
    ganadas: number;
    gastadas: number;
    disponibles: number;
  }> {
    const fila = await prisma.enrollments.findUnique({
      where: { id: inscripcionId },
      select: { coins_earned: true, coins_spent: true, coins_available: true },
    });
    expect(fila).not.toBeNull();
    return {
      ganadas: fila!.coins_earned,
      gastadas: fila!.coins_spent,
      disponibles: Number(fila!.coins_available),
    };
  }

  describe('T6.3.1 · flujo completo del hito (CA 1)', () => {
    it('A2: el estudiante se une a la clase con su código (H3.2)', async () => {
      const respuesta = await llamar(
        'POST /classes/join',
        httpServer
          .post('/api/v1/classes/join')
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ codigo: claseCodigo }),
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.inscripcion.estado).toBe('active');

      const inscripcion = await prisma.enrollments.findFirst({
        where: { class_id: claseId, student_id: estudianteId },
      });
      expect(inscripcion).not.toBeNull();
      inscripcionId = inscripcion!.id;
      expect(await saldoInscripcion()).toEqual({
        ganadas: 0,
        gastadas: 0,
        disponibles: 0,
      });
    });

    it('A3: el profesor crea la actividad como draft con recompensa 75', async () => {
      const respuesta = await llamarDocente(
        'POST /classes/:id/activities (creación)',
        httpServer
          .post(`/api/v1/classes/${claseId}/activities`)
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({
            titulo: `Regresión hito: ecuaciones ${sello}`,
            descripcion: 'Actividad fixture de la suite H6.3',
            recompensaMonedas: RECOMPENSA,
            preguntas: PREGUNTAS,
          }),
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.actividad.estado).toBe('draft');
      expect(respuesta.body.actividad.recompensaMonedas).toBe(RECOMPENSA);
      expect(respuesta.body.actividad.preguntas).toEqual(PREGUNTAS);
      actividadId = respuesta.body.actividad.id;
    });

    it('A3b: el estudiante NO ve la actividad antes de publicarla (404)', async () => {
      const respuesta = await llamar(
        'GET /activities/:id (draft, estudiante)',
        httpServer
          .get(`/api/v1/activities/${actividadId}`)
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('A4: publicarla y que el estudiante la vea SIN respuestas correctas', async () => {
      const publicada = await llamarDocente(
        'POST /activities/:id/publicar',
        httpServer
          .post(`/api/v1/activities/${actividadId}/publicar`)
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({}),
      );
      expect(publicada.status).toBe(200);
      expect(publicada.body.estado).toBe('published');

      const vistaEstudiante = await llamar(
        'GET /activities/:id (publicada, estudiante)',
        httpServer
          .get(`/api/v1/activities/${actividadId}`)
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(vistaEstudiante.status).toBe(200);
      expect(vistaEstudiante.body.estado).toBe('published');
      // DTO de estudiante (§9.5): sanitizado, jamás respuestas correctas.
      expect(JSON.stringify(vistaEstudiante.body)).not.toContain('is_correct');
      expect(JSON.stringify(vistaEstudiante.body)).not.toContain(
        'expected_answer',
      );

      const listado = await llamar(
        'GET /enrollments/:id/activities',
        httpServer
          .get(`/api/v1/enrollments/${inscripcionId}/activities`)
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(listado.status).toBe(200);
      expect(
        listado.body.data.some(
          (actividad: { id: string; estado: string }) =>
            actividad.id === actividadId &&
            actividad.estado === 'published',
        ),
      ).toBe(true);
    });

    it('A5: borrador y envío bajo el umbral quedan submitted SIN monedas', async () => {
      const borrador = await llamar(
        'PUT /activities/:id/submissions (borrador)',
        httpServer
          .put(`/api/v1/activities/${actividadId}/submissions`)
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ respuestas: BORRADOR_PARCIAL }),
      );
      expect(borrador.status).toBe(200);
      expect(borrador.body.entrega.estado).toBe('in_progress');

      // Los veredictos (is_correct) viajan al estudiante por contrato
      // (ver submissions.e2e): pasa por la auditoría de dueño.
      const envio = await llamarDocente(
        'POST /activities/:id/submissions (envío 50%)',
        httpServer
          .post(`/api/v1/activities/${actividadId}/submissions`)
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ respuestas: RESPUESTAS_UMBRAL_FALLIDO }),
      );
      expect(envio.status).toBe(201);
      expect(envio.body.mensaje).toBe(MENSAJE_ENTREGA_UMBRAL);
      expect(envio.body.entrega.estado).toBe('submitted');
      expect(envio.body.entrega.monedasOtorgadas).toBe(0);
      entregaId = envio.body.entrega.id;

      expect(await saldoInscripcion()).toEqual({
        ganadas: 0,
        gastadas: 0,
        disponibles: 0,
      });
    });

    it('A6: la cola FIFO del profesor muestra la entrega pendiente', async () => {
      const cola = await llamar(
        'GET queue?estado=submitted',
        httpServer
          .get(
            `/api/v1/activities/${actividadId}/submissions/queue?estado=submitted`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`),
      );
      expect(cola.status).toBe(200);
      expect(cola.body.meta.total).toBe(1);
      expect(cola.body.data).toHaveLength(1);
      expect(cola.body.data[0].id).toBe(entregaId);
      expect(cola.body.data[0].estudiante.usuario).toBe('est.perez');
      expect(cola.body.data[0].puntaje).toBeNull();
      expect(cola.body.data[0].monedasOtorgadas).toBe(0);
      // El listado es resumen: nunca viajan las respuestas del estudiante.
      expect(JSON.stringify(cola.body)).not.toContain('respuestas');

      const detalle = await llamarDocente(
        'GET detalle de entrega (vista revisión)',
        httpServer
          .get(
            `/api/v1/activities/${actividadId}/submissions/${entregaId}`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`),
      );
      expect(detalle.status).toBe(200);
      expect(detalle.body.estado).toBe('submitted');
      expect(detalle.body.respuestas[0].is_correct).toBe(false);
    });

    it('A7: calificar graded acredita EXACTAMENTE 75 monedas una sola vez', async () => {
      const respuesta = await llamarDocente(
        'POST calificar (graded)',
        httpServer
          .post(
            `/api/v1/activities/${actividadId}/submissions/${entregaId}/calificar`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({
            decision: 'graded',
            puntaje: 7.5,
            feedback: 'Regresión H6.3: casi, revisa el paso 1.',
          }),
      );

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_CALIFICADA_PROFESOR);
      expect(respuesta.body.entrega.estado).toBe('graded');
      expect(respuesta.body.entrega.puntaje).toBe(7.5);
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(RECOMPENSA);

      // El trigger fn_award_coins acreditó exactamente reward_coins.
      expect(await saldoInscripcion()).toEqual({
        ganadas: RECOMPENSA,
        gastadas: 0,
        disponibles: RECOMPENSA,
      });
      const movimientos = await prisma.coin_movements.findMany({
        where: { enrollment_id: inscripcionId },
        orderBy: { id: 'asc' },
      });
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        type: 'earning',
        quantity: RECOMPENSA,
        description: 'Activity reward',
        submission_id: BigInt(entregaId),
      });
    });

    it('A8 (T6.3.4): RE-calificar responde 409 SIN segundo pago', async () => {
      const respuesta = await llamar(
        'POST calificar (recalificación)',
        httpServer
          .post(
            `/api/v1/activities/${actividadId}/submissions/${entregaId}/calificar`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({ decision: 'graded', puntaje: 10, feedback: 'cambio' }),
      );

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_NO_PENDIENTE);
      expect(await saldoInscripcion()).toEqual({
        ganadas: RECOMPENSA,
        gastadas: 0,
        disponibles: RECOMPENSA,
      });
      const cantidad = await prisma.coin_movements.count({
        where: { enrollment_id: inscripcionId, type: 'earning' },
      });
      expect(cantidad).toBe(1);
    });

    it('A9: el canje resta 50 monedas y deja el movimiento spending', async () => {
      const item = await llamar(
        'POST /items (ítem fixture)',
        httpServer
          .post('/api/v1/items')
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({
            classId: Number(claseId),
            name: `Regresión hito ítem ${sello}`,
            description: 'Premio de la suite H6.3',
            type: 'fun_activity',
            costCoins: COSTO_ITEM,
            stock: 5,
          }),
      );
      expect(item.status).toBe(201);
      itemAId = BigInt(item.body.id);

      const preview = await llamar(
        'GET /redemptions/preview',
        httpServer
          .get('/api/v1/redemptions/preview')
          .query({ itemId: String(itemAId) })
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(preview.status).toBe(200);
      expect(preview.body.item.costoMonedas).toBe(COSTO_ITEM);
      expect(preview.body.saldo.monedasDisponibles).toBe(RECOMPENSA);
      expect(preview.body.puedeCanjear).toBe(true);

      const canje = await llamar(
        'POST /redemptions (canje)',
        httpServer
          .post('/api/v1/redemptions')
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ itemId: String(itemAId) }),
      );
      expect(canje.status).toBe(201);
      expect(canje.body.estado).toBe('completed');
      expect(canje.body.costoMonedas).toBe(COSTO_ITEM);
      canjeId = canje.body.id;

      expect(await saldoInscripcion()).toEqual({
        ganadas: RECOMPENSA,
        gastadas: COSTO_ITEM,
        disponibles: RECOMPENSA - COSTO_ITEM,
      });
      const movimientos = await prisma.coin_movements.findMany({
        where: { redemption_id: BigInt(canjeId) },
      });
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0]).toMatchObject({
        type: 'spending',
        quantity: -COSTO_ITEM,
      });

      // La vista agregada del estudiante ya refleja la corrida (los
      // contadores globales solo suman: todo ≥0 por CHECK en BD).
      const saldo = await llamar(
        'GET /wallet (saldo agregado)',
        httpServer
          .get('/api/v1/wallet')
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(saldo.status).toBe(200);
      expect(saldo.body.monedasGanadas).toBeGreaterThanOrEqual(RECOMPENSA);
      expect(saldo.body.monedasDisponibles).toBeGreaterThanOrEqual(
        RECOMPENSA - COSTO_ITEM,
      );

      const historial = await llamar(
        'GET /wallet/movements',
        httpServer
          .get('/api/v1/wallet/movements')
          .query({ limit: 100 })
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(historial.status).toBe(200);
      expect(
        historial.body.data.some(
          (movimiento: { tipo: string; cantidad: number }) =>
            movimiento.tipo === 'earning' &&
            movimiento.cantidad === RECOMPENSA,
        ),
      ).toBe(true);
    });
  });

  describe('T6.3.2 · casos negativos (CA 2)', () => {
    it('B1: rol equivocado sobre recursos del profesor → 403', async () => {
      const casos: Array<{ contexto: string; peticion: request.Test }> = [
        {
          contexto: 'estudiante → POST /classes',
          peticion: httpServer
            .post('/api/v1/classes')
            .set('Authorization', `Bearer ${tokenEstudiante}`)
            .send({ nombre: `Nadie ${sello}` }),
        },
        {
          contexto: 'admin → POST /classes',
          peticion: httpServer
            .post('/api/v1/classes')
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ nombre: `Tampoco ${sello}` }),
        },
        {
          contexto: 'estudiante → crear actividad',
          peticion: httpServer
            .post(`/api/v1/classes/${claseId}/activities`)
            .set('Authorization', `Bearer ${tokenEstudiante}`)
            .send({ titulo: 'x', preguntas: PREGUNTAS }),
        },
        {
          contexto: 'admin → crear actividad',
          peticion: httpServer
            .post(`/api/v1/classes/${claseId}/activities`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ titulo: 'x', preguntas: PREGUNTAS }),
        },
        {
          contexto: 'estudiante → publicar',
          peticion: httpServer
            .post(`/api/v1/activities/${actividadId}/publicar`)
            .set('Authorization', `Bearer ${tokenEstudiante}`)
            .send({}),
        },
        {
          contexto: 'estudiante → cola',
          peticion: httpServer
            .get(`/api/v1/activities/${actividadId}/submissions/queue`)
            .set('Authorization', `Bearer ${tokenEstudiante}`),
        },
        {
          contexto: 'estudiante → calificar',
          peticion: httpServer
            .post(
              `/api/v1/activities/${actividadId}/submissions/${entregaId}/calificar`,
            )
            .set('Authorization', `Bearer ${tokenEstudiante}`)
            .send({ decision: 'graded', puntaje: 10 }),
        },
        {
          contexto: 'estudiante → crear ítem',
          peticion: httpServer
            .post('/api/v1/items')
            .set('Authorization', `Bearer ${tokenEstudiante}`)
            .send({
              classId: Number(claseId),
              name: 'x',
              type: 'fun_activity',
              costCoins: 5,
              stock: 1,
            }),
        },
      ];

      const resultados = await Promise.all(
        casos.map((caso) => llamar(caso.contexto, caso.peticion)),
      );
      expect(
        resultados.map(
          (resultado, indice) =>
            `${casos[indice].contexto}: ${resultado.status}`,
        ),
      ).toEqual(casos.map((caso) => `${caso.contexto}: 403`));
    });

    it('B1b: rol equivocado sobre recursos del estudiante → 403', async () => {
      const casos: Array<{ contexto: string; peticion: request.Test }> = [
        {
          contexto: 'profesor → unirse a clase',
          peticion: httpServer
            .post('/api/v1/classes/join')
            .set('Authorization', `Bearer ${tokenProfesor}`)
            .send({ codigo: claseCodigo }),
        },
        {
          contexto: 'profesor → entregar',
          peticion: httpServer
            .post(`/api/v1/activities/${actividadId}/submissions`)
            .set('Authorization', `Bearer ${tokenProfesor}`)
            .send({ respuestas: RESPUESTAS_UMBRAL_FALLIDO }),
        },
        {
          contexto: 'profesor → canjear',
          peticion: httpServer
            .post('/api/v1/redemptions')
            .set('Authorization', `Bearer ${tokenProfesor}`)
            .send({ itemId: String(itemAId) }),
        },
        {
          contexto: 'profesor → billetera',
          peticion: httpServer
            .get('/api/v1/wallet')
            .set('Authorization', `Bearer ${tokenProfesor}`),
        },
      ];

      const resultados = await Promise.all(
        casos.map((caso) => llamar(caso.contexto, caso.peticion)),
      );
      expect(
        resultados.map(
          (resultado, indice) =>
            `${casos[indice].contexto}: ${resultado.status}`,
        ),
      ).toEqual(casos.map((caso) => `${caso.contexto}: 403`));
    });

    it('B2: recurso ajeno → 404 anti-enumeración en clase/actividad/canje', async () => {
      const claseAjena = await llamar(
        'profesor → GET clase ajena',
        httpServer
          .get(`/api/v1/classes/${claseAjenaId}`)
          .set('Authorization', `Bearer ${tokenProfesor}`),
      );
      expect(claseAjena.status).toBe(404);
      expect(claseAjena.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const colaAjena = await llamar(
        'profesor → cola de actividad ajena',
        httpServer
          .get(
            `/api/v1/activities/${actividadAjenaId}/submissions/queue`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`),
      );
      expect(colaAjena.status).toBe(404);
      expect(colaAjena.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const actividadParaGomez = await llamar(
        'estudiante no inscripto → GET actividad',
        httpServer
          .get(`/api/v1/activities/${actividadId}`)
          .set('Authorization', `Bearer ${tokenEstudianteDos}`),
      );
      expect(actividadParaGomez.status).toBe(404);
      expect(actividadParaGomez.body.message).toBe(
        MENSAJE_RECURSO_NO_ENCONTRADO,
      );

      const reversarAjeno = await llamar(
        'estudiante ajeno → anular canje',
        httpServer
          .post(`/api/v1/redemptions/${canjeId}/reverse`)
          .set('Authorization', `Bearer ${tokenEstudianteDos}`),
      );
      expect(reversarAjeno.status).toBe(404);
      expect(reversarAjeno.body.message).toBe('El canje solicitado no existe.');
    });

    it('B2b: ítem ajeno → 403 uniforme y billetera ajena → 403', async () => {
      const itemAjeno = await llamar(
        'profesor → PATCH ítem ajeno',
        httpServer
          .patch(`/api/v1/items/${itemAjenoId}`)
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({ costCoins: 20 }),
      );
      expect(itemAjeno.status).toBe(403);
      expect(itemAjeno.body.message).toBe(MENSAJE_ITEMS_AJENOS);

      const billeteraAjena = await llamar(
        'estudiante → billetera de otro estudiante',
        httpServer
          .get('/api/v1/wallet')
          .query({ studentId: String(estudianteDosId) })
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(billeteraAjena.status).toBe(403);
      expect(billeteraAjena.body.message).toBe(
        'Solo puedes consultar tu propia billetera.',
      );
    });

    it('B3: union duplicada → 409 y validaciones de ítem/puntaje → 422/400', async () => {
      const duplicada = await llamar(
        'POST /classes/join (duplicado)',
        httpServer
          .post('/api/v1/classes/join')
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ codigo: claseCodigo }),
      );
      expect(duplicada.status).toBe(409);
      expect(duplicada.body.message).toBe(MENSAJE_YA_INSCRIPTO);

      const itemInvalido = await llamar(
        'POST /items (costo 0)',
        httpServer
          .post('/api/v1/items')
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({
            classId: Number(claseId),
            name: `Ítem inválido ${sello}`,
            type: 'fun_activity',
            costCoins: 0,
            stock: 1,
          }),
      );
      expect(itemInvalido.status).toBe(422);

      const puntajeFuera = await llamar(
        'calificar con puntaje fuera de rango',
        httpServer
          .post(
            `/api/v1/activities/${actividadId}/submissions/${entregaId}/calificar`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({ decision: 'graded', puntaje: 999 }),
      );
      expect(puntajeFuera.status).toBe(422);
      expect(puntajeFuera.body.message).toBe(MENSAJE_PUNTAJE_FUERA_DE_RANGO);

      const rechazoConPuntaje = await llamar(
        'calificar rejected con puntaje',
        httpServer
          .post(
            `/api/v1/activities/${actividadId}/submissions/${entregaId}/calificar`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`)
          .send({ decision: 'rejected', puntaje: 5 }),
      );
      expect(rechazoConPuntaje.status).toBe(400);
      expect(rechazoConPuntaje.body.message).toBe(MENSAJE_PUNTAJE_NO_EN_RECHAZO);

      const paginaInvalida = await llamar(
        'GET queue?page=0',
        httpServer
          .get(
            `/api/v1/activities/${actividadId}/submissions/queue?page=0`,
          )
          .set('Authorization', `Bearer ${tokenProfesor}`),
      );
      expect(paginaInvalida.status).toBe(400);
    });

    it('B3b: canje sin saldo → 422 con el saldo intacto', async () => {
      const preview = await llamar(
        'preview sin saldo',
        httpServer
          .get('/api/v1/redemptions/preview')
          .query({ itemId: String(itemAId) })
          .set('Authorization', `Bearer ${tokenEstudiante}`),
      );
      expect(preview.status).toBe(200);
      expect(preview.body.puedeCanjear).toBe(false);
      expect(preview.body.motivo).toContain('No tienes monedas suficientes');

      const canje = await llamar(
        'POST /redemptions sin saldo',
        httpServer
          .post('/api/v1/redemptions')
          .set('Authorization', `Bearer ${tokenEstudiante}`)
          .send({ itemId: String(itemAId) }),
      );
      expect(canje.status).toBe(422);
      expect(canje.body.message).toContain('No tienes monedas suficientes');

      expect(await saldoInscripcion()).toEqual({
        ganadas: RECOMPENSA,
        gastadas: COSTO_ITEM,
        disponibles: RECOMPENSA - COSTO_ITEM,
      });
      const canjes = await prisma.redemptions.count({
        where: { item_id: itemAId, status: 'completed' },
      });
      expect(canjes).toBe(1);
    });
  });

  describe('T6.3.3 · auditoría de respuestas (CA 3)', () => {
    it('C1: toda la corrida se audita sin campos prohibidos', () => {
      // Aprox. 45 respuestas; el piso 25 protege contra regresiones que
      // dejen de pasar por el wrapper.
      expect(respuestasAuditadas.length).toBeGreaterThanOrEqual(25);
    });
  });
});
