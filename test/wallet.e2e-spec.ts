import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Billetera del estudiante (H4.2 / PRO-280, T4.2.3).
 *
 * Verifica contra la BD real los CAs:
 * 1. El saldo coincide con la vista `student_coins` (comparado en el test
 *    contra una lectura directa de la vista, no contra constantes, porque
 *    otras suites — p. ej. canjes — mueven monedas en la misma BD).
 * 2. El historial sale de `coin_movements` en orden descendente con
 *    la envoltura `{ data, meta }`.
 * 3. La billetera ajena responde 403 (y los no-estudiantes también).
 * 4. Sin movimientos, `data` viene vacío con `meta.total = 0`.
 *
 * Fixtures: un `adjustment` de +80 a `est.perez` (auditoría vía movement,
 * sin tocar contadores a mano) y un estudiante sin inscripciones (hash
 * argon2 del seed) para los casos de ceros/vacío.
 */

const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

const LOGIN_PROFESOR = {
  usuarioOEmail: 'prof.lopez',
  contrasena: 'Prof123!',
};

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

describe('Billetera del estudiante (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenEstudiante = '';
  let tokenProfesor = '';
  let tokenSinClase = '';

  let idEstudiante = 0n;
  let idEstudianteDos = 0n;
  let inscripcionId = 0n;

  const descripcionFixture = 'fixture e2e H4.2';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const [loginEstudiante, loginProfesor] = await Promise.all([
      httpServer.post('/api/v1/auth/login').send(LOGIN_ESTUDIANTE),
      httpServer.post('/api/v1/auth/login').send(LOGIN_PROFESOR),
    ]);
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenProfesor = loginProfesor.body.accessToken;

    // Fixtures --------------------------------------------------------
    const estudiante = await prisma.users.findUnique({
      where: { username: 'est.perez' },
    });
    const estudianteDos = await prisma.users.findUnique({
      where: { username: 'est.gomez' },
    });
    if (!estudiante || !estudianteDos) {
      throw new Error('Faltan estudiantes del seed (002_seed.sql)');
    }
    idEstudiante = estudiante.id;
    idEstudianteDos = estudianteDos.id;

    const clase = await prisma.classes.findFirst({
      where: { name: 'Mathematics 10A' },
    });
    const inscripcion = await prisma.enrollments.findFirst({
      where: { student_id: idEstudiante, class_id: clase?.id ?? 0n },
    });
    if (!clase || !inscripcion) {
      throw new Error('Falta la inscripción de est.perez en el seed');
    }
    inscripcionId = inscripcion.id;

    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionId}, 'adjustment', 80, ${descripcionFixture})
    `;

    const unicidad = Date.now();
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
        username: `sin.billetera.${unicidad}`,
        email: `sin.billetera.${unicidad}@educoins.test`,
        password_hash: HASH_ESTUDIANTE_SEED,
        first_name: 'Sin',
        last_name: 'Billetera',
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
    const sinClase = await prisma.users.findFirst({
      where: { username: { startsWith: 'sin.billetera.' } },
      orderBy: { id: 'desc' },
    });
    if (sinClase) {
      await prisma.users.delete({ where: { id: sinClase.id } });
    }
    await app.close();
  });

  /** Lectura directa de la vista (la referencia del CA 1). */
  async function saldoDeLaVista(estudianteId: bigint) {
    const filas = await prisma.$queryRaw<
      { total_earned: number; total_spent: number; total_available: number }[]
    >`
      SELECT total_earned, total_spent, total_available
      FROM student_coins WHERE student_id = ${estudianteId}
    `;
    return filas[0] ?? { total_earned: 0, total_spent: 0, total_available: 0 };
  }

  /** Total real de movimientos del estudiante. */
  async function totalMovimientos(estudianteId: bigint): Promise<number> {
    const filas = await prisma.$queryRaw<{ total: bigint | number }[]>`
      SELECT count(*) AS total
      FROM coin_movements m
      JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.student_id = ${estudianteId}
    `;
    return Number(filas[0]?.total ?? 0);
  }

  it('CA 1: el saldo coincide con la vista student_coins', async () => {
    const respuesta = await httpServer
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    const vista = await saldoDeLaVista(idEstudiante);
    expect(respuesta.body.monedasGanadas).toBe(Number(vista.total_earned));
    expect(respuesta.body.monedasGastadas).toBe(Number(vista.total_spent));
    expect(respuesta.body.monedasDisponibles).toBe(
      Number(vista.total_available),
    );
  });

  it('CA 1: un estudiante sin inscripciones tiene saldo en ceros', async () => {
    const respuesta = await httpServer
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${tokenSinClase}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({
      monedasGanadas: 0,
      monedasGastadas: 0,
      monedasDisponibles: 0,
    });
  });

  it('CA 2: el historial trae los movimientos en orden descendente con { data, meta }', async () => {
    const respuesta = await httpServer
      .get('/api/v1/wallet/movements')
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    expect(Array.isArray(respuesta.body.data)).toBe(true);
    expect(respuesta.body.meta.total).toBe(await totalMovimientos(idEstudiante));
    expect(respuesta.body.meta.page).toBe(1);

    const fixture = respuesta.body.data.find(
      (m: { descripcion: string | null }) => m.descripcion === descripcionFixture,
    );
    expect(fixture).toBeDefined();
    expect(fixture.tipo).toBe('adjustment');
    expect(fixture.cantidad).toBe(80);
    expect(fixture.claseNombre).toBe('Mathematics 10A');

    // Orden cronológico descendente.
    const fechas = respuesta.body.data.map((m: { creadoEn: string }) =>
      Date.parse(m.creadoEn),
    );
    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i]).toBeLessThanOrEqual(fechas[i - 1]);
    }
  });

  it('CA 4: sin movimientos el historial viene vacío con meta.total 0', async () => {
    const respuesta = await httpServer
      .get('/api/v1/wallet/movements')
      .set('Authorization', `Bearer ${tokenSinClase}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data).toEqual([]);
    expect(respuesta.body.meta).toEqual({ total: 0, page: 1, limit: 20 });
  });

  it('CA 3: la billetera ajena responde 403 en saldo e historial', async () => {
    const saldo = await httpServer
      .get('/api/v1/wallet')
      .query({ studentId: String(idEstudianteDos) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(saldo.status).toBe(403);
    expect(saldo.body.message).toBe('Solo puedes consultar tu propia billetera.');

    const historial = await httpServer
      .get('/api/v1/wallet/movements')
      .query({ studentId: String(idEstudianteDos) })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(historial.status).toBe(403);
  });

  it('CA 3: los no-estudiantes reciben 403', async () => {
    const saldo = await httpServer
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(saldo.status).toBe(403);

    const historial = await httpServer
      .get('/api/v1/wallet/movements')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(historial.status).toBe(403);
  });

  it('la paginación devuelve meta coherente', async () => {
    const respuesta = await httpServer
      .get('/api/v1/wallet/movements')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data.length).toBeLessThanOrEqual(1);
    expect(respuesta.body.meta).toEqual({
      total: await totalMovimientos(idEstudiante),
      page: 1,
      limit: 1,
    });
  });
});
