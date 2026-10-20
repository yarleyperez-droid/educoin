import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { MENSAJE_ACCESO_DENEGADO } from '../src/modules/auth/guards/auth-throttler.guard';
import { auditarSinSecretos } from './helpers/auditoria-respuestas';

/**
 * Endurecimiento transversal de seguridad (H6.1 / PRO-292, T6.1.1–T6.1.3).
 *
 * Verifica los 4 CAs de la historia:
 * 1. CORS acepta el origen del frontend y omite las cabeceras para un
 *    origen ajeno; helmet añade sus cabeceras de seguridad.
 * 2. `ValidationPipe` global rechaza campos extra (whitelist) y `transform`
 *    convierte los query params numéricos (string → number).
 * 3. Auditoría: ninguna respuesta filtra `password_hash`, `is_correct` ni
 *    `expected_answer` (helper reutilizable en H6.3).
 * 4. Un flood supera el límite global (300/min por IP) y responde 429 —
 *    también sin token, lo que demuestra que el throttler corre antes que
 *    `JwtAuthGuard`.
 *
 * App nueva por test (`beforeEach`): el store del throttler vive en memoria
 * y cada test necesita contadores limpios para los floods.
 */

const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3001';
const ORIGEN_AJENO = 'https://evil.test';

/** Tope de los bucles de flood: > 300 (LIMITE_GLOBAL) con margen. */
const TOPE_FLOOD = 330;

describe('Endurecimiento transversal de seguridad (e2e, H6.1 / PRO-292)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── CA 1 · T6.1.1: CORS restringido y helmet ─────────────────────────

  it('CA 1: acepta las peticiones desde el origen del frontend', async () => {
    const respuesta = await httpServer
      .get('/api/v1/')
      .set('Origin', FRONTEND_URL);

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['access-control-allow-origin']).toBe(FRONTEND_URL);
    expect(respuesta.headers['access-control-allow-credentials']).toBe('true');
  });

  it('CA 1: nunca refleja un origen ajeno (rechazo a nivel de navegador)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/')
      .set('Origin', ORIGEN_AJENO);

    // Procesada a nivel HTTP, pero el ACAO sigue fijado en FRONTEND_URL:
    // al no coincidir con el Origin del atacante (ni ser '*'), el navegador
    // bloquea la lectura según la spec de CORS.
    expect(respuesta.status).toBe(200);
    const acao = respuesta.headers['access-control-allow-origin'];
    expect(acao).toBe(FRONTEND_URL);
    expect(acao).not.toBe(ORIGEN_AJENO);
    expect(acao).not.toBe('*');
  });

  it('T6.1.1: helmet añade las cabeceras de seguridad', async () => {
    const respuesta = await httpServer.get('/api/v1/');

    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    expect(respuesta.headers['x-frame-options']).toBeDefined();
  });

  // ── CA 2 · T6.1.2: ValidationPipe whitelist + transform ──────────────

  it('CA 2: un body con campos extra responde 400 mencionando el campo', async () => {
    const respuesta = await httpServer.post('/api/v1/auth/login').send({
      ...LOGIN_ADMIN,
      campoDesconocido: 'no-deberia-pasar',
    });

    expect(respuesta.status).toBe(400);
    expect(JSON.stringify(respuesta.body)).toContain('campoDesconocido');
  });

  it('T6.1.2: transform convierte los query params numéricos (string → number)', async () => {
    const login = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR);
    expect(login.status).toBe(201);

    // Sin transform, `page: '1'` fallaría @IsInt → 400 en vez de 200.
    const respuesta = await httpServer
      .get('/api/v1/classes')
      .query({ q: 'mathe', page: '1', limit: '1' })
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.meta).toEqual(
      expect.objectContaining({ page: 1, limit: 1 }),
    );
  }, 15_000);

  // ── CA 3 · T6.1.3: auditoría de filtraciones ─────────────────────────

  it('CA 3: ninguna respuesta filtra password_hash, is_correct ni expected_answer', async () => {
    const clase = await prisma.classes.findFirst({
      where: { name: 'Mathematics 10A' },
    });
    if (!clase) {
      throw new Error('Falta la clase Mathematics 10A del seed');
    }
    const item = await prisma.redeemable_items.findFirst({
      where: { class_id: clase.id },
    });
    if (!item) {
      throw new Error('Falta un ítem canjeable en la clase del seed');
    }

    const autorizacion = (token: string) => ({ Authorization: `Bearer ${token}` });

    // Logins (200 y 401): 4 intentos en total, por debajo del límite de 5.
    const loginAdmin = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    expect(loginAdmin.status).toBe(201);
    auditarSinSecretos(loginAdmin.body, 'login 201 (admin)');
    const tokenAdmin = loginAdmin.body.accessToken as string;

    const loginFallido = await httpServer
      .post('/api/v1/auth/login')
      .send({ ...LOGIN_ADMIN, contrasena: 'Incorrecta123!' });
    expect(loginFallido.status).toBe(401);
    auditarSinSecretos(loginFallido.body, 'login 401');

    const loginProfesor = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR);
    expect(loginProfesor.status).toBe(201);
    auditarSinSecretos(loginProfesor.body, 'login 201 (profesor)');
    const tokenProfesor = loginProfesor.body.accessToken as string;

    const loginEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ESTUDIANTE);
    expect(loginEstudiante.status).toBe(201);
    auditarSinSecretos(loginEstudiante.body, 'login 201 (estudiante)');
    const tokenEstudiante = loginEstudiante.body.accessToken as string;

    const perfil = await httpServer
      .get('/api/v1/auth/perfil')
      .set(autorizacion(tokenAdmin));
    expect(perfil.status).toBe(200);
    auditarSinSecretos(perfil.body, 'perfil');

    const clases = await httpServer
      .get('/api/v1/classes')
      .query({ q: 'mathe' })
      .set(autorizacion(tokenProfesor));
    expect(clases.status).toBe(200);
    auditarSinSecretos(clases.body, 'clases');

    const estudiantes = await httpServer
      .get(`/api/v1/classes/${clase.id}/estudiantes`)
      .set(autorizacion(tokenProfesor));
    expect(estudiantes.status).toBe(200);
    auditarSinSecretos(estudiantes.body, 'estudiantes de la clase');

    const billetera = await httpServer
      .get('/api/v1/wallet')
      .set(autorizacion(tokenEstudiante));
    expect(billetera.status).toBe(200);
    auditarSinSecretos(billetera.body, 'billetera');

    const movimientos = await httpServer
      .get('/api/v1/wallet/movements')
      .set(autorizacion(tokenEstudiante));
    expect(movimientos.status).toBe(200);
    auditarSinSecretos(movimientos.body, 'movimientos');

    const items = await httpServer
      .get('/api/v1/items')
      .query({ classId: String(clase.id) })
      .set(autorizacion(tokenProfesor));
    expect(items.status).toBe(200);
    auditarSinSecretos(items.body, 'ítems');

    const preview = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(item.id) })
      .set(autorizacion(tokenEstudiante));
    expect(preview.status).toBe(200);
    auditarSinSecretos(preview.body, 'previsualización de canje');
  }, 30_000);

  // ── CA 4 · T6.1.3: rate limiting global y orden de guards ────────────

  it('CA 4: un flood al healthcheck público supera el límite y responde 429', async () => {
    let estado = 0;
    let mensaje: unknown;
    let peticiones = 0;

    for (let i = 0; i < TOPE_FLOOD; i++) {
      const respuesta = await httpServer.get('/api/v1/');
      estado = respuesta.status;
      mensaje = respuesta.body.message;
      peticiones = i + 1;
      if (estado === 429) {
        break;
      }
    }

    expect(estado).toBe(429);
    expect(mensaje).toBe(MENSAJE_ACCESO_DENEGADO);
    // No se bloquea por debajo del límite global (300) ni sin llegar a él.
    expect(peticiones).toBeGreaterThanOrEqual(300);
    expect(peticiones).toBeLessThanOrEqual(TOPE_FLOOD);
  }, 30_000);

  it('orden de guards: sin token, el flood responde 429 antes que el 401 de JWT', async () => {
    const primera = await httpServer.get('/api/v1/wallet');
    expect(primera.status).toBe(401); // sin token: JwtAuthGuard responde

    let estado = 0;
    let mensaje: unknown;
    for (let i = 1; i < TOPE_FLOOD; i++) {
      const respuesta = await httpServer.get('/api/v1/wallet');
      estado = respuesta.status;
      mensaje = respuesta.body.message;
      if (estado === 429) {
        break;
      }
      // Si Jwt corriera antes que el throttler, aquí solo se verían 401.
      expect([401, 429]).toContain(estado);
    }

    expect(estado).toBe(429);
    expect(mensaje).toBe(MENSAJE_ACCESO_DENEGADO);
  }, 30_000);
});
