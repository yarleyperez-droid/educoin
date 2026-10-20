import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Canje instantáneo con anulación (H4.4 / PRO-282, T4.4.4).
 *
 * Corre contra la BD REAL (los triggers §12.6–12.8 hacen el negocio:
 * congelado de costo, descuento de stock/monedas y reversión). Cubre los
 * CAs 1–4: camino feliz, saldo insuficiente con rollback total, stock 0
 * con rollback total y anulación `completed → reversed` con monedas y
 * stock de vuelta.
 *
 * Fixtures (el seed no otorga monedas ni tiene ítem sin stock):
 * - `adjustment` de +120 monedas a la inscripción de `est.perez` (el trigger
 *   `trg_movements_apply` las acredita; el ajuste queda como auditoría y se
 *   documenta, no se borra para no desincronizar los contadores).
 * - Ítem propio `fun_activity` (costo 30, stock 2) por corrida, único por
 *   `uq_item_class_name`. Los ítems del SOLO se usan en lecturas (preview)
 *   para no agotar su stock en cada corrida de CI.
 * - Estudiante sin inscripción (con el hash argon2 del seed) para el 404.
 */

const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

const LOGIN_ESTUDIANTE_DOS = {
  usuarioOEmail: 'est.gomez',
  contrasena: 'Estudiante123!',
};

const LOGIN_PROFESOR = {
  usuarioOEmail: 'prof.lopez',
  contrasena: 'Prof123!',
};

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

const ITEM_SEED_GRADO = '+0.5 on the midterm';
const ITEM_SEED_DIVERSION = 'Trivia game in class';
const CLASE_SEED = 'Mathematics 10A';

describe('Canje instantáneo con anulación (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenEstudiante = '';
  let tokenEstudianteDos = '';
  let tokenProfesor = '';
  let tokenSinClase = '';

  let claseId = 0n;
  let inscripcionEstudianteId = 0n;
  let itemFixtureId = 0n;
  let itemSinStockId = 0n;
  let itemSeedGradoId = 0n;
  let itemSeedDiversionId = 0n;
  let canjeId = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const [loginEstudiante, loginEstudianteDos, loginProfesor] =
      await Promise.all([
        httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE),
        httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE_DOS),
        httpServer.post('/api/v1/auth/login').send(LOGIN_PROFESOR),
      ]);
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenEstudianteDos = loginEstudianteDos.body.accessToken;
    tokenProfesor = loginProfesor.body.accessToken;

    // Fixtures de BD --------------------------------------------------
    const clase = await prisma.classes.findFirst({
      where: { name: CLASE_SEED },
    });
    if (!clase) {
      throw new Error(`Falta la clase ${CLASE_SEED} en el seed (002_seed.sql)`);
    }
    claseId = clase.id;

    const estudiante = await prisma.users.findUnique({
      where: { username: 'est.perez' },
    });
    const inscripcion = await prisma.enrollments.findFirst({
      where: { student_id: estudiante?.id ?? 0n, class_id: claseId },
    });
    if (!estudiante || !inscripcion) {
      throw new Error('Falta la inscripción de est.perez en el seed');
    }
    inscripcionEstudianteId = inscripcion.id;

    // Otorga monedas (auditoría vía movement, sin tocar contadores a mano).
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionEstudianteId}, 'adjustment', 120, 'fixture e2e H4.4')
    `;

    const unicidad = Date.now();
    const itemFixture = await prisma.redeemable_items.create({
      data: {
        class_id: claseId,
        name: `Fixture canje ${unicidad}`,
        description: 'Ítem de prueba para el canje (H4.4)',
        type: 'fun_activity',
        cost_coins: 30,
        stock: 2,
      },
    });
    itemFixtureId = itemFixture.id;

    const itemSinStock = await prisma.redeemable_items.create({
      data: {
        class_id: claseId,
        name: `Fixture sin stock ${unicidad}`,
        type: 'fun_activity',
        cost_coins: 10,
        stock: 0,
      },
    });
    itemSinStockId = itemSinStock.id;

    const itemGrado = await prisma.redeemable_items.findFirst({
      where: { class_id: claseId, name: ITEM_SEED_GRADO },
    });
    const itemDiversion = await prisma.redeemable_items.findFirst({
      where: { class_id: claseId, name: ITEM_SEED_DIVERSION },
    });
    if (!itemGrado || !itemDiversion) {
      throw new Error('Faltan los ítems del seed (002_seed.sql)');
    }
    itemSeedGradoId = itemGrado.id;
    itemSeedDiversionId = itemDiversion.id;

    // Estudiante sin inscripción (mismo hash argon2 que el seed).
    const org = await prisma.organizations.findFirst({
      where: { name: 'Colegio Demo' },
    });
    if (!org) {
      throw new Error('Falta la organización Colegio Demo en el seed');
    }
    const sinClase = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'student',
        username: `sin.clase.${unicidad}`,
        email: `sin.clase.${unicidad}@educoins.test`,
        password_hash: HASH_ESTUDIANTE_SEED,
        first_name: 'Sin',
        last_name: 'Clase',
        must_change_password: false,
      },
    });
    const loginSinClase = await httpServer.post('/api/v1/auth/login').send({
      usuarioOEmail: sinClase.username,
      contrasena: 'Estudiante123!',
    });
    tokenSinClase = loginSinClase.body.accessToken;
  });

  afterAll(async () => {
    // El canje (y su reversión) queda en BD por la FK redemptions → items;
    // solo se retira el estudiante sintético.
    const sinClase = await prisma.users.findFirst({
      where: { username: { startsWith: 'sin.clase.' } },
      orderBy: { id: 'desc' },
    });
    if (sinClase) {
      await prisma.users.delete({ where: { id: sinClase.id } });
    }
    await app.close();
  });

  /** Saldo real del estudiante en la clase del fixture. */
  async function saldoDisponible(): Promise<number> {
    const filas = await prisma.$queryRaw<{ coins_available: number }[]>`
      SELECT coins_available FROM enrollments WHERE id = ${inscripcionEstudianteId}
    `;
    return Number(filas[0]?.coins_available ?? 0);
  }

  /** Stock real de un ítem. */
  async function stockDe(itemId: bigint): Promise<number | null> {
    const filas = await prisma.$queryRaw<{ stock: number | null }[]>`
      SELECT stock FROM redeemable_items WHERE id = ${itemId}
    `;
    return filas[0] === undefined ? null : filas[0].stock;
  }

  it('la previsualización devuelve costo, saldo y stock (seed, solo lectura)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(itemSeedGradoId) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.item.costoMonedas).toBe(100);
    expect(respuesta.body.item.stock).toBeNull(); // ilimitado en el seed
    expect(respuesta.body.saldo.monedasDisponibles).toBeGreaterThanOrEqual(0);
    expect(respuesta.body.puedeCanjear).toBe(true);
    expect(respuesta.body.motivo).toBeNull();
  });

  it('la previsualización informa el motivo cuando no alcanza el saldo', async () => {
    const respuesta = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(itemFixtureId) })
      .set('Authorization', `Bearer ${tokenEstudianteDos}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.puedeCanjear).toBe(false);
    expect(respuesta.body.motivo).toContain('No tienes monedas suficientes');
  });

  it('la previsualización se rechaza (404) sin inscripción en la clase', async () => {
    const respuesta = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(itemFixtureId) })
      .set('Authorization', `Bearer ${tokenSinClase}`);

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(
      'No estás inscrito en la clase de ese ítem.',
    );
  });

  it('CA 1: el canje queda completed con costo congelado, saldo y stock descontados', async () => {
    const saldoAntes = await saldoDisponible();
    const stockAntes = await stockDe(itemFixtureId);

    const respuesta = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ itemId: String(itemFixtureId) });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.estado).toBe('completed');
    expect(respuesta.body.costoMonedas).toBe(30);
    expect(respuesta.body.itemId).toBe(String(itemFixtureId));
    expect(respuesta.body.reversadoEn).toBeNull();
    canjeId = respuesta.body.id;

    expect(await saldoDisponible()).toBe(saldoAntes - 30);
    expect(await stockDe(itemFixtureId)).toBe((stockAntes ?? 0) - 1);

    // El costo congelado vive en la fila, no en el precio vigente del ítem.
    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeId) },
    });
    expect(Number(fila?.cost_coins)).toBe(30);
  });

  it('CA 2: saldo insuficiente → 422 con rollback total (ni saldo ni stock)', async () => {
    const stockAntes = await stockDe(itemFixtureId);

    const respuesta = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenEstudianteDos}`)
      .send({ itemId: String(itemFixtureId) });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toContain('No tienes monedas suficientes');

    const filas = await prisma.$queryRaw<{ coins_available: number }[]>`
      SELECT e.coins_available
      FROM enrollments e
      JOIN users u ON u.id = e.student_id
      WHERE u.username = 'est.gomez' AND e.class_id = ${claseId}
    `;
    expect(Number(filas[0]?.coins_available ?? -1)).toBe(0);
    expect(await stockDe(itemFixtureId)).toBe(stockAntes);

    const canjes = await prisma.redemptions.count({
      where: { item_id: itemFixtureId, status: 'completed' },
    });
    expect(canjes).toBe(1); // solo el del CA 1
  });

  it('CA 3: ítem sin stock → 422 con rollback total', async () => {
    const saldoAntes = await saldoDisponible();

    const respuesta = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ itemId: String(itemSinStockId) });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toContain('sin stock');
    expect(await saldoDisponible()).toBe(saldoAntes);
    expect(await stockDe(itemSinStockId)).toBe(0);
  });

  it('CA 4: anular revierte monedas y stock y deja el canje reversed', async () => {
    const saldoAntes = await saldoDisponible();
    const stockAntes = await stockDe(itemFixtureId);

    const respuesta = await httpServer
      .post(`/api/v1/redemptions/${canjeId}/reverse`)
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe('reversed');
    expect(respuesta.body.reversadoEn).not.toBeNull();

    expect(await saldoDisponible()).toBe(saldoAntes + 30);
    expect(await stockDe(itemFixtureId)).toBe((stockAntes ?? 0) + 1);

    const movimientos = await prisma.coin_movements.findMany({
      where: { redemption_id: BigInt(canjeId) },
      orderBy: { id: 'asc' },
    });
    expect(movimientos.map((m) => m.type)).toEqual(['spending', 'reversal']);
    expect(Number(movimientos[1]?.quantity)).toBe(30); // reversal positivo
  });

  it('doble anulación → 409', async () => {
    const respuesta = await httpServer
      .post(`/api/v1/redemptions/${canjeId}/reverse`)
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.message).toBe('El canje ya fue anulado.');
  });

  it('anular un canje inexistente o ajeno responde 404 (anti-enumeración)', async () => {
    const inexistente = await httpServer
      .post('/api/v1/redemptions/999999999/reverse')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(inexistente.status).toBe(404);

    const ajeno = await httpServer
      .post(`/api/v1/redemptions/${canjeId}/reverse`)
      .set('Authorization', `Bearer ${tokenEstudianteDos}`);
    expect(ajeno.status).toBe(404);
    expect(ajeno.body.message).toBe('El canje solicitado no existe.');
  });

  it('un rol distinto de student recibe 403', async () => {
    const respuesta = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ itemId: String(itemFixtureId) });

    expect(respuesta.status).toBe(403);
  });

  it('el ítem del seed de diversión también es previsualizable (stock limitado)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(itemSeedDiversionId) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.item.costoMonedas).toBe(50);
    expect(respuesta.body.item.stock).toBeGreaterThanOrEqual(0);
  });
});
