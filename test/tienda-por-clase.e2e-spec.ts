import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_ITEMS_AJENOS } from './../src/modules/items/items.service';
import { MENSAJE_SIN_INSCRIPCION } from './../src/modules/redemptions/redemptions.service';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * H10.5 / PRO-508 — Suite E2E de la tienda por clase (T10.5.1–T10.5.3).
 *
 * Certifica el recorrido nuevo de la épica E10 contra la BD REAL:
 * publicación por clase → visibilidad solo para los inscritos → canje →
 * resolución, con evidencia de que saldo y stock quedan consistentes.
 * Complementa (no duplica) `regresion-hito.e2e-spec.ts`, que cubre H7.5.
 *
 * Escenarios:
 *  1. **Publicar (CA 1):** el profesor publica un bono de 0.3 y una
 *     actividad con stock en SU clase; el bono solo existe en esa clase.
 *  2. **Canjear (CA 2):** el estudiante inscrito ve los artículos en su
 *     materia y los canjea: el canje nace `pending`, el saldo baja y el
 *     stock de la actividad se descuenta (el bono es ilimitado: `stock`
 *     `NULL` por regla de tipo de H10.2/H4.1).
 *  3. **Resolver (CA 3):** el profesor aprueba y entrega; al final saldo,
 *     stock y estados coinciden con la BD y no hay movimientos extra.
 *  4. **Aislamiento (CA 4):** un estudiante de otra clase no ve el artículo
 *     (403 en el catálogo acotado, ausente del listado global) ni puede
 *     canjearlo (404 anti-enumeración).
 *
 * Registro en CI (CA 5 / T10.5.3): `test/jest-e2e.json` selecciona todos
 * los `*.e2e-spec.ts` (testRegex) y `.github/workflows/ci.yml` ejecuta
 * `pnpm test:e2e` en cada PR a `main`/`develop` y en cada push a
 * `develop`, así que este archivo corre sin registro adicional.
 *
 * Aislamiento por corrida (T10.5.1, patrón `canje-revisable.e2e`):
 * organización sintética NUEVA con `Date.now()`, profesor y dos
 * estudiantes propios (hash argon2 del seed + `must_change_password:
 * false`), dos clases, una inscripción en cada una, monedas SOLO vía
 * `coin_movements` tipo `adjustment` (el trigger aplica los contadores) e
 * ítems publicados por la API real. Limpieza en `afterAll` respetando el
 * orden FK: movimientos → canjes → inscripciones → ítems → clases →
 * usuarios → organización.
 *
 * Logins: 3 (profesor, estudiante A, estudiante B) — dentro del rate
 * limit de auth (5/min por IP por instancia de app).
 */

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

/** Costo en EduCoins del bono de 0.3 y de la actividad con stock. */
const COSTO_BONO = 40;
const COSTO_ACTIVIDAD = 15;

/** Monedas iniciales de cada estudiante (suficientes para el recorrido). */
const MONEDAS_INICIALES = 500;

/** Décimas del bono publicado (H10.1: el rango válido es 0.1–0.5). */
const DECIMAS_BONO = 0.3;

/** Stock inicial de la actividad lúdica (el bono no lleva stock). */
const STOCK_ACTIVIDAD = 2;

/** Fila mínima de un ítem tal como la devuelve `GET /items`. */
interface ItemRespuesta {
  id: string;
  classId: string;
  className: string | null;
  name: string;
  type: string;
  costCoins: number;
  gradePoints: number | null;
  stock: number | null;
  status: string;
}

describe('Tienda por clase — publicar, canjear y entregar (e2e, fixtures aislados)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudianteA = '';
  let tokenEstudianteB = '';

  let profesorId = 0n;
  let estudianteAId = 0n;
  let estudianteBId = 0n;
  let claseAId = 0n;
  let claseBId = 0n;
  let inscripcionAId = 0n;
  let inscripcionBId = 0n;
  let bonoId = 0n;
  let actividadId = 0n;

  let canjeBonoId = '';
  let canjeActividadId = '';

  const usuarios: bigint[] = [];
  const clases: bigint[] = [];
  const inscripciones: bigint[] = [];
  const organizaciones: bigint[] = [];

  let sello = 0;

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
    const marca = `fixture e2e H10.5 ${sello}`;

    // Fixtures de BD (T10.5.1) -----------------------------------------
    const org = await prisma.organizations.create({
      data: { name: `Org Tienda E2E ${sello}`, type: 'school' },
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

    profesorId = await crearUsuario(
      'teacher',
      `prof.tienda.${sello}`,
      'Laura',
      'Méndez',
    );
    estudianteAId = await crearUsuario(
      'student',
      `est.tienda.a.${sello}`,
      'Ana',
      'Ríos',
    );
    estudianteBId = await crearUsuario(
      'student',
      `est.tienda.b.${sello}`,
      'Beto',
      'Salas',
    );

    // 3 logins en paralelo (el throttler de auth permite 5/min por app).
    const [loginProfesor, loginA, loginB] = await Promise.all([
      httpServer
        .post('/api/v1/auth/login')
        .send({
          usuarioOEmail: `prof.tienda.${sello}`,
          contrasena: 'Estudiante123!',
        }),
      httpServer
        .post('/api/v1/auth/login')
        .send({
          usuarioOEmail: `est.tienda.a.${sello}`,
          contrasena: 'Estudiante123!',
        }),
      httpServer
        .post('/api/v1/auth/login')
        .send({
          usuarioOEmail: `est.tienda.b.${sello}`,
          contrasena: 'Estudiante123!',
        }),
    ]);
    expect(loginProfesor.status).toBe(201);
    expect(loginA.status).toBe(201);
    expect(loginB.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudianteA = loginA.body.accessToken;
    tokenEstudianteB = loginB.body.accessToken;

    const claseA = await prisma.classes.create({
      data: {
        teacher_id: profesorId,
        name: `Matemáticas 10A tienda ${sello}`,
      },
    });
    claseAId = claseA.id;
    clases.push(claseA.id);
    const claseB = await prisma.classes.create({
      data: {
        teacher_id: profesorId,
        name: `Ciencias 10B tienda ${sello}`,
      },
    });
    claseBId = claseB.id;
    clases.push(claseB.id);

    // El estudiante A está en las DOS clases (así se prueba que el
    // artículo aparece solo en su materia); el B solo en la otra.
    const inscripcionA = await prisma.enrollments.create({
      data: { class_id: claseAId, student_id: estudianteAId },
    });
    inscripcionAId = inscripcionA.id;
    inscripciones.push(inscripcionA.id);
    const inscripcionAOtra = await prisma.enrollments.create({
      data: { class_id: claseBId, student_id: estudianteAId },
    });
    inscripciones.push(inscripcionAOtra.id);
    const inscripcionB = await prisma.enrollments.create({
      data: { class_id: claseBId, student_id: estudianteBId },
    });
    inscripcionBId = inscripcionB.id;
    inscripciones.push(inscripcionB.id);

    // Monedas SOLO vía movement `adjustment` (el trigger acredita).
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionAId}, 'adjustment', ${MONEDAS_INICIALES}, ${marca})
    `;
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionBId}, 'adjustment', ${MONEDAS_INICIALES}, ${marca})
    `;
  });

  afterAll(async () => {
    try {
      // Orden FK: movimientos → canjes → inscripciones → ítems → clases
      // → usuarios → organización (T10.5.1).
      await prisma.coin_movements.deleteMany({
        where: { enrollment_id: { in: inscripciones } },
      });
      await prisma.redemptions.deleteMany({
        where: { enrollment_id: { in: inscripciones } },
      });
      await prisma.enrollments.deleteMany({
        where: { id: { in: inscripciones } },
      });
      await prisma.redeemable_items.deleteMany({
        where: { class_id: { in: clases } },
      });
      await prisma.classes.deleteMany({ where: { id: { in: clases } } });
      await prisma.users.deleteMany({ where: { id: { in: usuarios } } });
      await prisma.organizations.deleteMany({
        where: { id: { in: organizaciones } },
      });
    } finally {
      await app.close();
    }
  });

  /** Saldo real (`coins_available`) de una inscripción fixture. */
  async function saldoDe(idInscripcion: bigint): Promise<number> {
    const filas = await prisma.$queryRaw<{ coins_available: number }[]>`
      SELECT coins_available FROM enrollments WHERE id = ${idInscripcion}
    `;
    return Number(filas[0]?.coins_available ?? 0);
  }

  /** Stock real de un ítem (`null` = ilimitado). */
  async function stockDe(idItem: bigint): Promise<number | null> {
    const filas = await prisma.$queryRaw<{ stock: number | null }[]>`
      SELECT stock FROM redeemable_items WHERE id = ${idItem}
    `;
    return filas[0] === undefined ? null : filas[0].stock;
  }

  /** Movimientos del libro mayor ligados a un canje, por id ascendente. */
  async function movimientosDe(idCanje: string): Promise<string[]> {
    const movimientos = await prisma.coin_movements.findMany({
      where: { redemption_id: BigInt(idCanje) },
      orderBy: { id: 'asc' },
    });
    return movimientos.map((m) => m.type);
  }

  /** Publica un ítem por la API real como el profesor de la clase. */
  const publicar = (cuerpo: Record<string, unknown>) =>
    httpServer
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ classId: Number(claseAId), ...cuerpo });

  /** Catálogo visible para un estudiante (opcionalmente acotado a clase). */
  const catalogoDe = (token: string, classId?: bigint) =>
    httpServer
      .get('/api/v1/items')
      .query(classId === undefined ? {} : { classId: Number(classId) })
      .set('Authorization', `Bearer ${token}`);

  /** Solicitud real de canje (`POST /redemptions`). */
  const canjear = (idItem: bigint, token: string) =>
    httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: String(idItem) });

  /** Resolución del profesor (`approve` | `deliver`). */
  const resolver = (accion: 'approve' | 'deliver', idCanje: string) =>
    httpServer
      .post(`/api/v1/redemptions/${idCanje}/${accion}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);

  it('CA 1 (T10.5.2): el profesor publica el bono de 0.3 y una actividad con stock en su clase', async () => {
    const bono = await publicar({
      name: `Bono 0.3 tienda ${sello}`,
      description: 'Bono de tres décimas de la suite H10.5',
      type: 'grade_bonus',
      costCoins: COSTO_BONO,
      gradePoints: DECIMAS_BONO,
    });

    expect(bono.status).toBe(201);
    expect(bono.body.type).toBe('grade_bonus');
    expect(bono.body.gradePoints).toBe(DECIMAS_BONO);
    expect(bono.body.costCoins).toBe(COSTO_BONO);
    expect(bono.body.stock).toBeNull(); // el bono no lleva stock (H10.2)
    expect(bono.body.status).toBe('active');
    expect(bono.body.autoApprove).toBe(false);
    expect(bono.body.classId).toBe(String(claseAId));
    expect(bono.body.className).toBe(`Matemáticas 10A tienda ${sello}`);
    bonoId = BigInt(bono.body.id);

    const actividad = await publicar({
      name: `Actividad tienda ${sello}`,
      description: 'Actividad lúdica con stock de la suite H10.5',
      type: 'fun_activity',
      costCoins: COSTO_ACTIVIDAD,
      stock: STOCK_ACTIVIDAD,
    });

    expect(actividad.status).toBe(201);
    expect(actividad.body.type).toBe('fun_activity');
    expect(actividad.body.gradePoints).toBeNull();
    expect(actividad.body.stock).toBe(STOCK_ACTIVIDAD);
    expect(actividad.body.className).toBe(`Matemáticas 10A tienda ${sello}`);
    actividadId = BigInt(actividad.body.id);

    // CA 1: publicado SOLO en esa clase: el catálogo del profesor dueño
    // tiene exactamente los dos artículos de la clase.
    const catalogoProfesor = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(claseAId) })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(catalogoProfesor.status).toBe(200);
    expect(
      (catalogoProfesor.body as ItemRespuesta[]).map((item) => item.id).sort(),
    ).toEqual([String(bonoId), String(actividadId)].sort());

    // La otra clase del mismo profesor no los muestra.
    const otraClase = await httpServer
      .get('/api/v1/items')
      .query({ classId: Number(claseBId) })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(otraClase.status).toBe(200);
    expect(otraClase.body).toEqual([]);
  });

  it('CA 2: el estudiante inscrito lo ve solo en su materia, lo canjea y saldo/stock bajan', async () => {
    // El bono aparece en el catálogo de la materia de A (y no en la otra
    // clase donde A también está inscrito).
    const materia = await catalogoDe(tokenEstudianteA, claseAId);
    expect(materia.status).toBe(200);
    const itemsMateria = materia.body as ItemRespuesta[];
    expect(itemsMateria).toHaveLength(2);
    for (const item of itemsMateria) {
      expect(item.classId).toBe(String(claseAId));
      expect(item.className).toBe(`Matemáticas 10A tienda ${sello}`);
      expect(item.status).toBe('active');
    }
    const bonoVisto = itemsMateria.find((item) => item.id === String(bonoId));
    expect(bonoVisto).toBeDefined();
    expect(bonoVisto?.gradePoints).toBe(DECIMAS_BONO);
    expect(bonoVisto?.costCoins).toBe(COSTO_BONO);
    expect(bonoVisto?.stock).toBeNull();

    const otraMateria = await catalogoDe(tokenEstudianteA, claseBId);
    expect(otraMateria.status).toBe(200);
    expect(otraMateria.body).toEqual([]);

    // Previsualización del bono: costo congelado a la vista y saldo real.
    const previewBono = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(bonoId) })
      .set('Authorization', `Bearer ${tokenEstudianteA}`);
    expect(previewBono.status).toBe(200);
    expect(previewBono.body.item.costoMonedas).toBe(COSTO_BONO);
    expect(previewBono.body.item.puntosNota).toBe('0.3');
    expect(previewBono.body.item.stock).toBeNull();
    expect(previewBono.body.saldo.monedasDisponibles).toBe(MONEDAS_INICIALES);
    expect(previewBono.body.puedeCanjear).toBe(true);

    // Canje del bono: nace `pending` y descuenta solo monedas.
    const canjeBono = await canjear(bonoId, tokenEstudianteA);
    expect(canjeBono.status).toBe(201);
    expect(canjeBono.body.estado).toBe('pending');
    expect(canjeBono.body.costoMonedas).toBe(COSTO_BONO);
    expect(canjeBono.body.itemId).toBe(String(bonoId));
    canjeBonoId = canjeBono.body.id;

    expect(await saldoDe(inscripcionAId)).toBe(MONEDAS_INICIALES - COSTO_BONO);
    expect(await stockDe(bonoId)).toBeNull(); // ilimitado: nunca cambia

    const filaBono = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeBonoId) },
    });
    expect(filaBono?.status).toBe('pending');
    expect(Number(filaBono?.cost_coins)).toBe(COSTO_BONO);
    expect(Number(filaBono?.grade_points)).toBe(DECIMAS_BONO); // congeladas por la BD

    // Canje de la actividad: además descuenta stock.
    const canjeActividad = await canjear(actividadId, tokenEstudianteA);
    expect(canjeActividad.status).toBe(201);
    expect(canjeActividad.body.estado).toBe('pending');
    expect(canjeActividad.body.costoMonedas).toBe(COSTO_ACTIVIDAD);
    canjeActividadId = canjeActividad.body.id;

    expect(await saldoDe(inscripcionAId)).toBe(
      MONEDAS_INICIALES - COSTO_BONO - COSTO_ACTIVIDAD,
    );
    expect(await stockDe(actividadId)).toBe(STOCK_ACTIVIDAD - 1);
    expect(await movimientosDe(canjeActividadId)).toEqual(['spending']);
  });

  it('CA 3 (T10.5.2): el profesor aprueba y entrega; saldo, stock y estados quedan consistentes', async () => {
    // La cola del profesor ve exactamente las dos solicitudes pendientes.
    const cola = await httpServer
      .get('/api/v1/redemptions/pending')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(cola.status).toBe(200);
    const idsCola = (cola.body.data as Array<{ id: string }>).map(
      (fila) => fila.id,
    );
    expect(idsCola.sort()).toEqual([canjeBonoId, canjeActividadId].sort());

    for (const canje of [canjeBonoId, canjeActividadId]) {
      const aprobado = await resolver('approve', canje);
      expect(aprobado.status).toBe(200);
      expect(aprobado.body.estado).toBe('approved');
      expect(aprobado.body.resueltoEn).not.toBeNull();

      const entregado = await resolver('deliver', canje);
      expect(entregado.status).toBe(200);
      expect(entregado.body.estado).toBe('delivered');
    }

    // Saldo y stock finales: los descuentos de la reserva no se repiten.
    expect(await saldoDe(inscripcionAId)).toBe(
      MONEDAS_INICIALES - COSTO_BONO - COSTO_ACTIVIDAD,
    );
    expect(await stockDe(bonoId)).toBeNull();
    expect(await stockDe(actividadId)).toBe(STOCK_ACTIVIDAD - 1);

    // Estados y auditoría en BD + exactamente 1 `spending` por canje.
    const filas = await prisma.redemptions.findMany({
      where: { id: { in: [BigInt(canjeBonoId), BigInt(canjeActividadId)] } },
      orderBy: { id: 'asc' },
    });
    expect(filas.map((fila) => fila.status)).toEqual([
      'delivered',
      'delivered',
    ]);
    for (const fila of filas) {
      expect(fila.resolved_by).toBe(profesorId);
      expect(fila.resolved_at).not.toBeNull();
      expect(await movimientosDe(String(fila.id))).toEqual(['spending']);
    }

    // Libro mayor de A: 1 adjustment del fixture + 2 spending, ni uno más.
    const movimientos = await prisma.coin_movements.findMany({
      where: { enrollment_id: inscripcionAId },
      orderBy: { id: 'asc' },
    });
    expect(movimientos.map((m) => m.type).sort()).toEqual([
      'adjustment',
      'spending',
      'spending',
    ]);
    expect(
      movimientos
        .filter((m) => m.type === 'spending')
        .map((m) => Number(m.quantity))
        .sort((a, b) => a - b),
    ).toEqual([-COSTO_BONO, -COSTO_ACTIVIDAD]);
  });

  it('CA 4 (T10.5.3): un estudiante de otra clase no lo ve ni puede canjearlo (403/404)', async () => {
    // No ve el catálogo de una clase donde no está inscrito (403 uniforme).
    const catalogoAjeno = await catalogoDe(tokenEstudianteB, claseAId);
    expect(catalogoAjeno.status).toBe(403);
    expect(catalogoAjeno.body.message).toBe(MENSAJE_ITEMS_AJENOS);

    // Su listado global solo trae los artículos de SUS clases (ninguno).
    const catalogoGlobal = await catalogoDe(tokenEstudianteB);
    expect(catalogoGlobal.status).toBe(200);
    expect(catalogoGlobal.body).toEqual([]);
    expect(
      (catalogoGlobal.body as ItemRespuesta[]).some(
        (item) => item.id === String(bonoId),
      ),
    ).toBe(false);

    // Tampoco puede previsualizar ni canjear: 404 anti-enumeración, sin
    // distinguir "no inscrito" de "no existe".
    const preview = await httpServer
      .get('/api/v1/redemptions/preview')
      .query({ itemId: String(bonoId) })
      .set('Authorization', `Bearer ${tokenEstudianteB}`);
    expect(preview.status).toBe(404);
    expect(preview.body.message).toBe(MENSAJE_SIN_INSCRIPCION);

    const intento = await canjear(bonoId, tokenEstudianteB);
    expect(intento.status).toBe(404);
    expect(intento.body.message).toBe(MENSAJE_SIN_INSCRIPCION);

    // Nada cambió: saldo y stock ajenos intactos y sin fila nueva.
    expect(await saldoDe(inscripcionBId)).toBe(MONEDAS_INICIALES);
    expect(await stockDe(actividadId)).toBe(STOCK_ACTIVIDAD - 1);
    expect(
      await prisma.redemptions.count({
        where: {
          item_id: bonoId,
          enrollment_id: inscripcionBId,
        },
      }),
    ).toBe(0);
    expect(await prisma.redemptions.count({ where: { item_id: bonoId } })).toBe(
      1,
    ); // solo el canje de A
  });
});
