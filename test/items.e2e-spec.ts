import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Catálogo de ítems canjeables (H4.1 / PRO-279, T4.1.1–T4.1.3).
 *
 * Verifica los CAs contra la BD real:
 * 1. `fun_activity` se crea con `stock` y `cost` válidos (201).
 * 2. `grade_bonus` se crea con `grade_points` (201).
 * 3. No-profesor-de-la-clase (estudiante o profesor ajeno) → **403**
 *    uniforme en los 4 endpoints.
 * 4. Stock negativo / costo inválido → **422** (nunca llega a los CHECK
 *    de la BD); faltantes por tipo → 422 (T4.1.2).
 *
 * Extras de CRUD: listado, edición, borrado lógico (sin tocar las
 * `redemptions`), duplicado → 409 y campo desconocido → 400.
 *
 * T5.7.2 / PRO-391: el listado acepta al estudiante inscrito — ítems
 * `active` de sus clases (con y sin `classId`), 403 en clase sin
 * inscripción y vacío sin inscripciones.
 *
 * Fixtures: profesor con clase propia (hash argon2 del seed + clase vía
 * prisma) porque el seed solo trae `prof.lopez`.
 */

const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

/** Hash argon2id real de `Prof123!` (mismo que `db/002_seed.sql`). */
const HASH_PROFESOR_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$wqUUPXJ83uBaR982L251Vw$I2nvzzgs1gh0vW5hu35rL/yQdD7rFzbLsJfk+wQCeGg';

const NOMBRE_FUN = 'Trivia extra del e2e H4.1';
const NOMBRE_BONUS = 'Parcial de regalo del e2e H4.1';
const MENSAJE_AJENO = 'No puedes administrar ítems de esta clase.';

describe('Catálogo de ítems canjeables (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenAjeno = '';

  let idClasePropia = 0n;
  let idClaseAjena = 0n;
  let idItemFun = '';
  let idItemBonus = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const [loginProfesor, loginEstudiante] = await Promise.all([
      httpServer.post('/api/v1/auth/login').send(LOGIN_PROFESOR),
      httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE),
    ]);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;

    // Fixtures: clase propia (del seed) y profesor ajeno con clase propia.
    const clasePropia = await prisma.classes.findFirst({
      where: { name: 'Mathematics 10A' },
    });
    if (!clasePropia) {
      throw new Error('Falta la clase Mathematics 10A del seed');
    }
    idClasePropia = clasePropia.id;

    const unicidad = Date.now();
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
        username: `prof.catalogo.${unicidad}`,
        email: `prof.catalogo.${unicidad}@educoins.test`,
        password_hash: HASH_PROFESOR_SEED,
        first_name: 'Ajeno',
        last_name: 'Catálogo',
        specialty: 'Mathematics',
        must_change_password: false,
      },
    });
    const claseAjena = await prisma.classes.create({
      data: { teacher_id: profesorAjeno.id, name: `Clase ajena ${unicidad}` },
    });
    idClaseAjena = claseAjena.id;

    const loginAjeno = await httpServer.post('/api/v1/auth/login').send({
      usuarioOEmail: profesorAjeno.username,
      contrasena: 'Prof123!',
    });
    tokenAjeno = loginAjeno.body.accessToken;
  });

  afterAll(async () => {
    // Orden: ítems (nuevos, sin canjes) → clase ajena → usuario ajeno.
    await prisma.redeemable_items.deleteMany({
      where: {
        id: { in: [idItemFun, idItemBonus].filter(Boolean).map(BigInt) },
      },
    });
    await prisma.redeemable_items.deleteMany({
      where: { class_id: idClaseAjena },
    });
    if (idClaseAjena !== 0n) {
      await prisma.classes.delete({ where: { id: idClaseAjena } });
    }
    const usuarioAjeno = await prisma.users.findFirst({
      where: { username: { startsWith: 'prof.catalogo.' } },
      orderBy: { id: 'desc' },
    });
    if (usuarioAjeno) {
      await prisma.users.delete({ where: { id: usuarioAjeno.id } });
    }
    await app.close();
  });

  const alta = (token: string, body: Record<string, unknown>) =>
    httpServer
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('CA 1: un fun_activity se crea con stock y cost válidos', async () => {
    const respuesta = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: NOMBRE_FUN,
      description: 'Minijuego del e2e',
      type: 'fun_activity',
      costCoins: 50,
      stock: 5,
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.type).toBe('fun_activity');
    expect(respuesta.body.stock).toBe(5);
    expect(respuesta.body.costCoins).toBe(50);
    expect(respuesta.body.status).toBe('active');
    expect(respuesta.body.classId).toBe(String(idClasePropia));
    expect(respuesta.body.id).toMatch(/^\d+$/);
    idItemFun = respuesta.body.id;
  });

  it('CA 2: un grade_bonus se crea con grade_points', async () => {
    const respuesta = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: NOMBRE_BONUS,
      type: 'grade_bonus',
      costCoins: 100,
      gradePoints: 0.5,
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.type).toBe('grade_bonus');
    expect(respuesta.body.gradePoints).toBe(0.5);
    expect(respuesta.body.stock).toBeNull();
    idItemBonus = respuesta.body.id;
  });

  it('CA 3: un estudiante no administra ítems (403 por rol)', async () => {
    const respuesta = await alta(tokenEstudiante, {
      classId: Number(idClasePropia),
      name: 'No debería crearse',
      type: 'fun_activity',
      costCoins: 10,
      stock: 1,
    });

    expect(respuesta.status).toBe(403);
  });

  it('CA 3 / T4.1.3: un profesor ajeno a la clase recibe 403 uniforme', async () => {
    const creacion = await alta(tokenAjeno, {
      classId: Number(idClasePropia),
      name: 'Intento ajeno',
      type: 'fun_activity',
      costCoins: 10,
      stock: 1,
    });
    expect(creacion.status).toBe(403);
    expect(creacion.body.message).toBe(MENSAJE_AJENO);

    // También con una clase INEXISTENTE: misma respuesta (no filtra existencia).
    const inexistente = await alta(tokenAjeno, {
      classId: 99999999,
      name: 'Intento inexistente',
      type: 'fun_activity',
      costCoins: 10,
      stock: 1,
    });
    expect(inexistente.status).toBe(403);
    expect(inexistente.body.message).toBe(MENSAJE_AJENO);
  });

  it('CA 4: stock negativo o costo inválido → 422', async () => {
    const stockNegativo = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: 'Stock inválido',
      type: 'fun_activity',
      costCoins: 10,
      stock: -1,
    });
    expect(stockNegativo.status).toBe(422);

    const costoInvalido = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: 'Costo inválido',
      type: 'fun_activity',
      costCoins: 0,
      stock: 1,
    });
    expect(costoInvalido.status).toBe(422);
    expect(costoInvalido.body.message).toBe(
      'El costo en monedas debe ser un entero mayor que 0.',
    );
  });

  it('T4.1.2: faltantes por tipo → 422 (fun_activity sin stock, grade_bonus sin grade_points)', async () => {
    const sinStock = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: 'Sin stock',
      type: 'fun_activity',
      costCoins: 10,
    });
    expect(sinStock.status).toBe(422);
    expect(sinStock.body.message).toBe(
      'La actividad lúdica (fun_activity) requiere un stock.',
    );

    const sinPuntos = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: 'Sin puntos',
      type: 'grade_bonus',
      costCoins: 20,
    });
    expect(sinPuntos.status).toBe(422);
    expect(sinPuntos.body.message).toBe(
      'El bono de nota (grade_bonus) requiere grade_points.',
    );
  });

  it('CA 3 + CRUD: el listado es 403 para clase ajena y 200 con los ítems para la propia', async () => {
    const ajena = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(idClaseAjena) })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(ajena.status).toBe(403);
    expect(ajena.body.message).toBe(MENSAJE_AJENO);

    const propia = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(idClasePropia) })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(propia.status).toBe(200);
    const nombres = propia.body.map((i: { name: string }) => i.name);
    expect(nombres).toEqual(expect.arrayContaining([NOMBRE_FUN, NOMBRE_BONUS]));
    expect(propia.body.every((i: { status: string }) => i.status !== 'deleted')).toBe(true);
  });

  it('T5.7.2: el estudiante inscrito lista los ítems active de sus clases (sin classId)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/items')
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    const nombres = respuesta.body.map((i: { name: string }) => i.name);
    // Ítems del seed + los creados por este suite en la clase de est.perez.
    expect(nombres).toEqual(
      expect.arrayContaining([
        NOMBRE_FUN,
        NOMBRE_BONUS,
        '+0.5 on the midterm',
        'Trivia game in class',
      ]),
    );
    expect(
      respuesta.body.every((i: { status: string }) => i.status === 'active'),
    ).toBe(true);
    expect(
      respuesta.body.every(
        (i: { classId: string }) => i.classId === String(idClasePropia),
      ),
    ).toBe(true);
  });

  it('T5.7.2: el estudiante acota con classId de su clase y recibe 403 en una clase sin inscripción', async () => {
    const propia = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(idClasePropia) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(propia.status).toBe(200);
    expect(propia.body.length).toBeGreaterThan(0);

    const ajena = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(idClaseAjena) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(ajena.status).toBe(403);
    expect(ajena.body.message).toBe(MENSAJE_AJENO);
  });

  it('T5.7.2: un estudiante sin inscripciones activas lista vacío y no puede crear ítems', async () => {
    const unicidad = Date.now();
    const org = await prisma.organizations.findFirst({
      where: { name: 'Colegio Demo' },
    });
    if (!org) {
      throw new Error('Falta la organización Colegio Demo en el seed');
    }
    const estudianteSinInscripcion = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'student',
        username: `est.sinclase.${unicidad}`,
        email: `est.sinclase.${unicidad}@educoins.test`,
        password_hash: HASH_PROFESOR_SEED,
        first_name: 'Sin',
        last_name: 'Clase',
        must_change_password: false,
      },
    });

    try {
      const login = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: estudianteSinInscripcion.username,
        contrasena: 'Prof123!',
      });
      const token = login.body.accessToken;

      const listado = await httpServer
        .get('/api/v1/items')
        .set('Authorization', `Bearer ${token}`);
      expect(listado.status).toBe(200);
      expect(listado.body).toEqual([]);

      const creacion = await httpServer
        .post('/api/v1/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          classId: Number(idClasePropia),
          name: 'No debería crearse',
          type: 'fun_activity',
          costCoins: 10,
          stock: 1,
        });
      expect(creacion.status).toBe(403);
    } finally {
      await prisma.users.delete({
        where: { id: estudianteSinInscripcion.id },
      });
    }
  });

  it('CRUD + CA 3: el PATCH edita lo propio y responde 403 en lo ajeno', async () => {
    const propio = await httpServer
      .patch(`/api/v1/items/${idItemBonus}`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ costCoins: 120 });
    expect(propio.status).toBe(200);
    expect(propio.body.costCoins).toBe(120);

    const ajeno = await httpServer
      .patch(`/api/v1/items/${idItemFun}`)
      .set('Authorization', `Bearer ${tokenAjeno}`)
      .send({ costCoins: 1 });
    expect(ajeno.status).toBe(403);
    expect(ajeno.body.message).toBe(MENSAJE_AJENO);

    // El merge inválido tampoco pasa: quitarle los puntos a un grade_bonus → 422.
    const mergeInvalido = await httpServer
      .patch(`/api/v1/items/${idItemBonus}`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ gradePoints: null });
    expect(mergeInvalido.status).toBe(422);
  });

  it('CRUD: el DELETE es lógico, excluye de la lista, no toca redemptions y es 403 en lo ajeno', async () => {
    const canjesAntes = await prisma.redemptions.count();

    const ajeno = await httpServer
      .delete(`/api/v1/items/${idItemBonus}`)
      .set('Authorization', `Bearer ${tokenAjeno}`);
    expect(ajeno.status).toBe(403);

    const borrado = await httpServer
      .delete(`/api/v1/items/${idItemFun}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(borrado.status).toBe(200);
    expect(borrado.body.status).toBe('deleted');

    const propia = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(idClasePropia) })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(
      propia.body.some((i: { id: string }) => i.id === idItemFun),
    ).toBe(false);

    const canjesDespues = await prisma.redemptions.count();
    expect(canjesDespues).toBe(canjesAntes);
  });

  it('el nombre duplicado en la clase responde 409', async () => {
    const respuesta = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: NOMBRE_FUN,
      type: 'fun_activity',
      costCoins: 50,
      stock: 3,
    });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body.message).toContain('único');
  });

  it('los campos desconocidos del cuerpo se rechazan con 400 (whitelist)', async () => {
    const respuesta = await alta(tokenProfesor, {
      classId: Number(idClasePropia),
      name: 'Con campo raro',
      type: 'fun_activity',
      costCoins: 10,
      stock: 1,
      campoRaro: true,
    });
    expect(respuesta.status).toBe(400);
  });
});
