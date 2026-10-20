import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

const LOGIN_PROFESOR = {
  usuarioOEmail: 'prof.lopez',
  contrasena: 'Prof123!',
};

const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

const RECOMPENSA = 120;
const COSTO_CANJE = 30;

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
    prompt: 'Complete: x - 2 = 4',
    score: 5,
    expected_answer: '6',
  },
];

const RESPUESTAS = [
  { question_position: 1, option: '3' },
  { question_position: 2, text: '6' },
];

describe('Flujo completo EduCoin: actividad hasta canje (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudiante = '';
  let claseId = '';
  let actividadId = '';
  let inscripcionId = 0n;
  let itemId = '';

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

    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);

    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;

    const clase = await prisma.classes.findFirst({
      where: { name: 'Mathematics 10A' },
    });

    expect(clase).not.toBeNull();
    claseId = String(clase!.id);

    const inscripcion = await prisma.enrollments.findFirst({
      where: {
        class_id: clase!.id,
        users: { username: 'est.perez' },
        status: 'active',
      },
    });

    expect(inscripcion).not.toBeNull();
    inscripcionId = inscripcion!.id;

    const item = await prisma.redeemable_items.create({
      data: {
        class_id: clase!.id,
        name: `E2E Flujo completo ${Date.now()}`,
        description: 'Articulo creado para la prueba integrada',
        type: 'fun_activity',
        cost_coins: COSTO_CANJE,
        stock: 1,
      },
    });

    itemId = String(item.id);
  });

    afterAll(async () => {
    try {
      if (actividadId !== '') {
        const respuesta = await httpServer
          .delete(`/api/v1/activities/${actividadId}`)
          .set('Authorization', `Bearer ${tokenProfesor}`);

        expect(respuesta.status).toBe(204);
      }
    } finally {
      await app.close();
    }
  });

  it('crea actividad, acredita monedas por entrega y permite canjearlas', async () => {
    const saldoAntes = async (): Promise<number> => {
      const filas = await prisma.$queryRaw<
        { coins_available: number | bigint }[]
      >`
        SELECT coins_available
        FROM enrollments
        WHERE id = ${inscripcionId}
      `;

      return Number(filas[0]?.coins_available ?? 0);
    };

    const saldoInicial = await saldoAntes();

    // 1. El profesor crea una actividad en la clase.
    const actividad = await httpServer
      .post(`/api/v1/classes/${claseId}/activities`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        titulo: `E2E Flujo completo ${Date.now()}`,
        preguntas: PREGUNTAS,
        recompensaMonedas: RECOMPENSA,
      });

    expect(actividad.status).toBe(201);
    actividadId = actividad.body.actividad.id as string;

    // 2. El profesor publica la actividad.
    const publicacion = await httpServer
      .post(`/api/v1/activities/${actividadId}/publicar`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({});

    expect(publicacion.status).toBe(200);

    // 3. El estudiante resuelve y envía la actividad.
    const entrega = await httpServer
      .post(`/api/v1/activities/${actividadId}/submissions`)
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ respuestas: RESPUESTAS });

    expect(entrega.status).toBe(201);
    expect(entrega.body.entrega.estado).toBe('graded');
    expect(entrega.body.entrega.monedasOtorgadas).toBe(RECOMPENSA);

    // 4. La base de datos acredita las monedas automáticamente.
    const saldoTrasEntrega = await saldoAntes();

    expect(saldoTrasEntrega).toBe(saldoInicial + RECOMPENSA);

    // 5. El estudiante canjea el artículo usando su saldo real.
    const canje = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ itemId });

    expect(canje.status).toBe(201);
    expect(canje.body.estado).toBe('completed');
    expect(canje.body.costoMonedas).toBe(COSTO_CANJE);
    expect(canje.body.itemId).toBe(itemId);

    // 6. Se comprueba que el canje descontó las monedas.
    const saldoFinal = await saldoAntes();

    expect(saldoFinal).toBe(saldoTrasEntrega - COSTO_CANJE);
  });
});
