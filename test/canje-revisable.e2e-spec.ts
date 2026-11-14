import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_SIN_ROL } from './../src/common/guards/roles.guard';
import {
  MENSAJE_CANJE_NO_EXISTE,
  MENSAJE_CANJE_YA_RESUELTO,
  MENSAJE_SIN_PERMISO_RESOLVER,
} from './../src/modules/redemptions/redemptions.service';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Canje revisable (H7.2 / PRO-447) contra la BD REAL: el contrato de
 * `docs/propuesta_canje_revisable.md` §3 (transiciones, códigos y
 * mensajes exactos) con los triggers haciendo el negocio (reserva,
 * reversión por rechazo) y el backend solo escribiendo la auditoría de
 * resolución. Cubre los 14 escenarios de la historia:
 *
 *  1. Solicitud → `pending` con reserva (saldo/stock) y 1 `spending`.
 *  2. Sin saldo → 422 `Saldo insuficiente`, sin fila creada.
 *  3. Sin stock → 422 `Sin stock disponible`, sin fila creada.
 *  4. Aprobar → `approved` con `resueltoEn` y cero movimientos nuevos.
 *  5. Rechazar → `rejected` con saldo/stock exactamente iguales al previo
 *     y exactamente 1 `reversal`.
 *  6. Entregar → `delivered` sin movimientos nuevos.
 *  7. Doble resolución → 409 `El canje ya fue resuelto`.
 *  8. Profesor de otra clase → 403 `No tienes permiso para resolver este
 *     canje` y el canje no cambia.
 *  9. Canje inexistente / ajeno → 404 (anti-enumeración).
 * 10. Cola `GET /pending`: solo pendientes de SUS clases, paginada sin
 *     duplicados y con `meta` correcto; 403 para el rol estudiante.
 * 11. Ítem con `auto_approve` → nace `approved` (`aprobacionAutomatica:
 *     true`), fuera de la cola, sin movimientos extra.
 * 12. `GET /mine`: solo los canjes del estudiante, `redeemed_at DESC`,
 *     paginado; 403 para el rol profesor.
 * 13. `POST /:id/reverse` sobre un canje `pending` → 409.
 * 14. Un estudiante no puede resolver → 403.
 *
 * Aislamiento por corrida (patrón rankings.e2e): organización sintética
 * NUEVA con `Date.now()`, profesor/estudiantes propios (hash argon2 del
 * seed + `must_change_password: false`), clases, inscripciones e ítems
 * propios; monedas SOLO vía `coin_movements` tipo `adjustment` (el
 * trigger `trg_movements_apply` aplica contadores; jamás UPDATE manual).
 * Limpieza en `afterAll` respetando el orden FK (movimientos → canjes →
 * inscripciones → ítems → clases → usuarios → organizaciones).
 *
 * Logins: 4 (teacher1, teacher2, studentA, studentB) — dentro del rate
 * limit de auth (5/min por IP por instancia de app).
 */

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

/** Fila de los listados paginados `{ data, meta }` de canjes. */
interface FilaCola {
  id: string;
  nombreEstudiante: string;
  nombreItem: string;
  costoMonedas: number;
  estado: string;
  solicitadoEn: string;
}

describe('Canje revisable — flujo de resolución (e2e, fixtures aislados)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenProfesorDos = '';
  let tokenEstudiante = '';
  let tokenEstudianteDos = '';

  let profesorId = 0n;
  let claseId = 0n;
  let claseDosId = 0n;
  let inscripcionId = 0n;
  let inscripcionClaseDosId = 0n;
  let inscripcionEstudianteDosId = 0n;

  let itemManualId = 0n;
  let itemSinStockId = 0n;
  let itemCaroId = 0n;
  let itemClaseDosId = 0n;
  let itemAutoId = 0n;

  // Canjes creados por los escenarios (ids como string: vienen de la API).
  let canjePendienteId = '';
  let canjeRechazoId = '';
  let canjeBloqueoId = '';
  let canjeColaUnoId = '';
  let canjeColaDosId = '';
  let canjeClaseDosId = '';
  let canjeAutoId = '';
  let canjeEstudianteDosId = '';

  const inscripciones: bigint[] = [];
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
    const marca = `fixture e2e H7.2 ${unicidad}`;

    // Fixtures de BD --------------------------------------------------
    const org = await prisma.organizations.create({
      data: { name: `Org Canje Revisable ${unicidad}`, type: 'school' },
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

    profesorId = await crearUsuario('teacher', `prof.cr.${unicidad}`, 'Paula', 'Cano');
    const profesorDosId = await crearUsuario(
      'teacher',
      `prof.cr2.${unicidad}`,
      'Ramiro',
      'Soto',
    );
    const estudianteId = await crearUsuario(
      'student',
      `est.cr.${unicidad}`,
      'Ana',
      'Díaz',
    );
    const estudianteDosId = await crearUsuario(
      'student',
      `est.cr2.${unicidad}`,
      'Beto',
      'Fuentes',
    );

    // Los 4 logins (rate limit de auth: 5/min por IP por app).
    const [loginProfesor, loginProfesorDos, loginEstudiante, loginEstudianteDos] =
      await Promise.all([
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `prof.cr.${unicidad}`, contrasena: 'Estudiante123!' }),
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `prof.cr2.${unicidad}`, contrasena: 'Estudiante123!' }),
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `est.cr.${unicidad}`, contrasena: 'Estudiante123!' }),
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `est.cr2.${unicidad}`, contrasena: 'Estudiante123!' }),
      ]);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenProfesorDos = loginProfesorDos.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenEstudianteDos = loginEstudianteDos.body.accessToken;

    const clase = await prisma.classes.create({
      data: { teacher_id: profesorId, name: `Clase Canje Revisable ${unicidad}` },
    });
    claseId = clase.id;
    clases.push(clase.id);
    const claseDos = await prisma.classes.create({
      data: {
        teacher_id: profesorDosId,
        name: `Clase Canje Revisable Dos ${unicidad}`,
      },
    });
    claseDosId = claseDos.id;
    clases.push(claseDos.id);

    const inscripcion = await prisma.enrollments.create({
      data: { class_id: claseId, student_id: estudianteId },
    });
    inscripcionId = inscripcion.id;
    inscripciones.push(inscripcion.id);
    const inscripcionClaseDos = await prisma.enrollments.create({
      data: { class_id: claseDosId, student_id: estudianteId },
    });
    inscripcionClaseDosId = inscripcionClaseDos.id;
    inscripciones.push(inscripcionClaseDos.id);
    const inscripcionDos = await prisma.enrollments.create({
      data: { class_id: claseId, student_id: estudianteDosId },
    });
    inscripcionEstudianteDosId = inscripcionDos.id;
    inscripciones.push(inscripcionDos.id);

    // Monedas SOLO vía movement `adjustment` (el trigger las acredita).
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionId}, 'adjustment', 500, ${marca})
    `;
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionClaseDosId}, 'adjustment', 100, ${marca})
    `;
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionEstudianteDosId}, 'adjustment', 500, ${marca})
    `;

    // Ítems propios (sin auto-aprobación salvo el del escenario 11).
    const crearItem = async (
      class_id: bigint,
      name: string,
      cost_coins: number,
      stock: number,
    ): Promise<bigint> => {
      const item = await prisma.redeemable_items.create({
        data: { class_id, name, type: 'fun_activity', cost_coins, stock },
      });
      return item.id;
    };
    itemManualId = await crearItem(claseId, `Item manual ${unicidad}`, 30, 20);
    itemSinStockId = await crearItem(claseId, `Item sin stock ${unicidad}`, 10, 0);
    itemCaroId = await crearItem(claseId, `Item caro ${unicidad}`, 9999, 5);
    itemClaseDosId = await crearItem(claseDosId, `Item clase dos ${unicidad}`, 10, 5);

    // Ítem con auto-aprobación vía API (cubre el campo `autoApprove` del
    // catálogo, §2.6 de la propuesta).
    const itemAuto = await httpServer
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        classId: Number(claseId),
        name: `Item auto ${unicidad}`,
        type: 'fun_activity',
        costCoins: 20,
        stock: 5,
        autoApprove: true,
      });
    expect(itemAuto.status).toBe(201);
    expect(itemAuto.body.autoApprove).toBe(true);
    itemAutoId = BigInt(itemAuto.body.id);
  });

  afterAll(async () => {
    try {
      // Orden FK: movimientos → canjes → inscripciones → ítems → clases
      // → usuarios → organizaciones.
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

  /** Stock real de un ítem. */
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

  /** Solicitud real de canje (`POST /redemptions`) como estudiante A. */
  const solicitar = (idItem: bigint, token: string = tokenEstudiante) =>
    httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: String(idItem) });

  /** Resolución del profesor (`approve` | `reject` | `deliver`). */
  const resolver = (
    accion: 'approve' | 'reject' | 'deliver',
    idCanje: string,
    token: string = tokenProfesor,
  ) =>
    httpServer
      .post(`/api/v1/redemptions/${idCanje}/${accion}`)
      .set('Authorization', `Bearer ${token}`);

  it('1. la solicitud nace pending con saldo y stock descontados y 1 spending', async () => {
    const saldoAntes = await saldoDe(inscripcionId);
    const stockAntes = await stockDe(itemManualId);

    const respuesta = await solicitar(itemManualId);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.estado).toBe('pending');
    expect(respuesta.body.costoMonedas).toBe(30);
    expect(respuesta.body.resueltoEn).toBeNull();
    expect(respuesta.body.aprobacionAutomatica).toBe(false);
    canjePendienteId = respuesta.body.id;

    expect(await saldoDe(inscripcionId)).toBe(saldoAntes - 30);
    expect(await stockDe(itemManualId)).toBe((stockAntes ?? 0) - 1);
    expect(await movimientosDe(canjePendienteId)).toEqual(['spending']);
  });

  it('2. sin saldo → 422 `Saldo insuficiente` sin crear fila', async () => {
    const saldoAntes = await saldoDe(inscripcionId);
    const stockAntes = await stockDe(itemCaroId);

    const respuesta = await solicitar(itemCaroId);

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toBe('Saldo insuficiente');
    expect(await saldoDe(inscripcionId)).toBe(saldoAntes);
    expect(await stockDe(itemCaroId)).toBe(stockAntes);
    const canjes = await prisma.redemptions.count({
      where: { item_id: itemCaroId },
    });
    expect(canjes).toBe(0); // sin creación de fila
  });

  it('3. sin stock → 422 `Sin stock disponible` sin crear fila', async () => {
    const saldoAntes = await saldoDe(inscripcionId);

    const respuesta = await solicitar(itemSinStockId);

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toBe('Sin stock disponible');
    expect(await saldoDe(inscripcionId)).toBe(saldoAntes);
    const canjes = await prisma.redemptions.count({
      where: { item_id: itemSinStockId },
    });
    expect(canjes).toBe(0); // sin creación de fila
  });

  it('4. aprobar → approved con resueltoEn y cero movimientos nuevos', async () => {
    const movimientosAntes = await prisma.coin_movements.count({
      where: { enrollment_id: inscripcionId },
    });

    const respuesta = await resolver('approve', canjePendienteId);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.id).toBe(canjePendienteId);
    expect(respuesta.body.estado).toBe('approved');
    expect(typeof respuesta.body.resueltoEn).toBe('string');
    expect(respuesta.body.resueltoEn).not.toBeNull();

    // Auditoría escrita por la APP en un solo UPDATE (sin movimientos).
    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjePendienteId) },
    });
    expect(fila?.status).toBe('approved');
    expect(fila?.resolved_by).toBe(profesorId);
    expect(fila?.resolved_at).not.toBeNull();
    expect(await movimientosDe(canjePendienteId)).toEqual(['spending']);
    const movimientosDespues = await prisma.coin_movements.count({
      where: { enrollment_id: inscripcionId },
    });
    expect(movimientosDespues).toBe(movimientosAntes);
  });

  it('5. rechazar → rejected con saldo/stock exactamente iguales al previo y 1 solo reversal', async () => {
    // "Previo" = estado ANTES de la solicitud (evidencia §6 B1-B4 de la
    // propuesta: la devolución del rechazo restaura exactamente lo que la
    // reserva había descontado).
    const saldoPrevio = await saldoDe(inscripcionId);
    const stockPrevio = await stockDe(itemManualId);

    const solicitud = await solicitar(itemManualId);
    expect(solicitud.status).toBe(201);
    canjeRechazoId = solicitud.body.id;

    // La reserva quedó aplicada…
    expect(await saldoDe(inscripcionId)).toBe(saldoPrevio - 30);
    expect(await stockDe(itemManualId)).toBe((stockPrevio ?? 0) - 1);

    const respuesta = await resolver('reject', canjeRechazoId);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe('rejected');
    expect(respuesta.body.resueltoEn).not.toBeNull();

    // …y la devolución ÍNTEGRA por el trigger deja exactamente los
    // valores previos a la solicitud.
    expect(await saldoDe(inscripcionId)).toBe(saldoPrevio);
    expect(await stockDe(itemManualId)).toBe(stockPrevio);

    const movimientos = await prisma.coin_movements.findMany({
      where: { redemption_id: BigInt(canjeRechazoId) },
      orderBy: { id: 'asc' },
    });
    expect(movimientos.map((m) => m.type)).toEqual(['spending', 'reversal']);
    expect(
      await prisma.coin_movements.count({
        where: { redemption_id: BigInt(canjeRechazoId), type: 'reversal' },
      }),
    ).toBe(1);
    expect(Number(movimientos[1]?.quantity)).toBe(30); // reversal positivo

    // Decisión 6: reversed_at NO se llena en un rechazo.
    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeRechazoId) },
    });
    expect(fila?.resolved_by).toBe(profesorId);
    expect(fila?.resolved_at).not.toBeNull();
    expect(fila?.reversed_at).toBeNull();
  });

  it('6. entregar → delivered sin movimientos nuevos', async () => {
    const movimientosAntes = await prisma.coin_movements.count({
      where: { enrollment_id: inscripcionId },
    });

    const respuesta = await resolver('deliver', canjePendienteId);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.estado).toBe('delivered');
    expect(await movimientosDe(canjePendienteId)).toEqual(['spending']);
    const movimientosDespues = await prisma.coin_movements.count({
      where: { enrollment_id: inscripcionId },
    });
    expect(movimientosDespues).toBe(movimientosAntes);
  });

  it('7. doble resolución → 409 `El canje ya fue resuelto`', async () => {
    // Construir + esperar request a request (el state/listen de supertest
    // vive por construcción: pre-construirlos deja dispatch contra un
    // servidor ya cerrado).
    for (const accion of ['approve', 'deliver'] as const) {
      const respuesta = await resolver(accion, canjePendienteId); // ya delivered
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_CANJE_YA_RESUELTO);
    }
    const rechazado = await resolver('reject', canjeRechazoId); // ya rejected
    expect(rechazado.status).toBe(409);
    expect(rechazado.body.message).toBe(MENSAJE_CANJE_YA_RESUELTO);
  });

  it('8. profesor de otra clase → 403 y el canje no cambia', async () => {
    const solicitud = await solicitar(itemManualId);
    expect(solicitud.status).toBe(201);
    canjeBloqueoId = solicitud.body.id;

    const respuesta = await resolver('approve', canjeBloqueoId, tokenProfesorDos);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.message).toBe(MENSAJE_SIN_PERMISO_RESOLVER);

    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeBloqueoId) },
    });
    expect(fila?.status).toBe('pending');
    expect(fila?.resolved_by).toBeNull();
    expect(fila?.resolved_at).toBeNull();
  });

  it('9. canje inexistente o ajeno → 404 (anti-enumeración)', async () => {
    const inexistente = await resolver('approve', '999999999');
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.message).toBe(MENSAJE_CANJE_NO_EXISTE);

    // Ajeno al estudiante (reversar canje de otro) ⇒ mismo 404.
    const ajeno = await httpServer
      .post(`/api/v1/redemptions/${canjeBloqueoId}/reverse`)
      .set('Authorization', `Bearer ${tokenEstudianteDos}`);
    expect(ajeno.status).toBe(404);
    expect(ajeno.body.message).toBe(MENSAJE_CANJE_NO_EXISTE);
  });

  it('10. cola GET /pending: solo pendientes de sus clases, paginada y sin duplicados', async () => {
    // 3 pendientes en clase 1 (bloqueo + 2 nuevos) y 1 en clase 2.
    const colaUno = await solicitar(itemManualId);
    const colaDos = await solicitar(itemManualId);
    expect(colaUno.status).toBe(201);
    expect(colaDos.status).toBe(201);
    canjeColaUnoId = colaUno.body.id;
    canjeColaDosId = colaDos.body.id;

    const otraClase = await solicitar(itemClaseDosId);
    expect(otraClase.status).toBe(201);
    canjeClaseDosId = otraClase.body.id;

    // Paginación con limit=2 sobre 3 pendientes: 2 páginas, sin duplicados.
    const pagina1 = await httpServer
      .get('/api/v1/redemptions/pending')
      .query({ page: 1, limit: 2 })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    const pagina2 = await httpServer
      .get('/api/v1/redemptions/pending')
      .query({ page: 2, limit: 2 })
      .set('Authorization', `Bearer ${tokenProfesor}`);

    expect(pagina1.status).toBe(200);
    expect(pagina2.status).toBe(200);
    expect(pagina1.body.meta).toEqual({ total: 3, page: 1, limit: 2 });
    expect(pagina2.body.meta).toEqual({ total: 3, page: 2, limit: 2 });

    const filas = [...pagina1.body.data, ...pagina2.body.data] as FilaCola[];
    const ids = filas.map((fila) => fila.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // sin duplicados entre páginas
    expect(ids.sort()).toEqual(
      [canjeBloqueoId, canjeColaUnoId, canjeColaDosId].sort(),
    );
    // Solo pendientes de SUS clases (nunca el de clase 2).
    expect(ids).not.toContain(canjeClaseDosId);
    for (const fila of filas) {
      expect(fila.estado).toBe('pending');
      expect(fila.nombreEstudiante).toBe('Ana Díaz');
      expect(typeof fila.nombreItem).toBe('string');
      expect(fila.costoMonedas).toBe(30);
      expect(typeof fila.solicitadoEn).toBe('string');
    }
    // Orden FIFO por solicitud (redeemed_at ASC).
    const instantes = filas.map((fila) => Date.parse(fila.solicitadoEn));
    for (let i = 1; i < instantes.length; i++) {
      expect(instantes[i]).toBeGreaterThanOrEqual(instantes[i - 1]);
    }

    // El profesor de la otra clase ve SOLO el pendiente de la suya.
    const colaAjena = await httpServer
      .get('/api/v1/redemptions/pending')
      .set('Authorization', `Bearer ${tokenProfesorDos}`);
    expect(colaAjena.status).toBe(200);
    expect(colaAjena.body.meta.total).toBe(1);
    expect((colaAjena.body.data as FilaCola[]).map((f) => f.id)).toEqual([
      canjeClaseDosId,
    ]);

    // Rol estudiante → 403.
    const estudiante = await httpServer
      .get('/api/v1/redemptions/pending')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(estudiante.status).toBe(403);
    expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);
  });

  it('11. auto_approve → nace approved, fuera de la cola y sin movimientos extra', async () => {
    const saldoAntes = await saldoDe(inscripcionId);
    const stockAntes = await stockDe(itemAutoId);

    const respuesta = await solicitar(itemAutoId);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.estado).toBe('approved');
    expect(respuesta.body.aprobacionAutomatica).toBe(true);
    expect(respuesta.body.resueltoEn).not.toBeNull();
    expect(respuesta.body.costoMonedas).toBe(20);
    canjeAutoId = respuesta.body.id;

    expect(await saldoDe(inscripcionId)).toBe(saldoAntes - 20);
    expect(await stockDe(itemAutoId)).toBe((stockAntes ?? 0) - 1);
    // 1 solo spending: la auto-aprobación no genera movimientos.
    expect(await movimientosDe(canjeAutoId)).toEqual(['spending']);

    // Auditoría: resuelto por el profesor de la clase (autor de la política).
    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeAutoId) },
    });
    expect(fila?.status).toBe('approved');
    expect(fila?.resolved_by).toBe(profesorId);

    // No aparece en la cola de pendientes.
    const cola = await httpServer
      .get('/api/v1/redemptions/pending')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(cola.status).toBe(200);
    expect((cola.body.data as FilaCola[]).map((f) => f.id)).not.toContain(
      canjeAutoId,
    );
  });

  it('12. GET /mine devuelve solo los del estudiante, DESC y paginado', async () => {
    // Un canje del estudiante B para verificar el aislamiento.
    const deEstudianteDos = await solicitar(itemManualId, tokenEstudianteDos);
    expect(deEstudianteDos.status).toBe(201);
    canjeEstudianteDosId = deEstudianteDos.body.id;

    const propios = await httpServer
      .get('/api/v1/redemptions/mine')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(propios.status).toBe(200);

    const filas = propios.body.data as FilaCola[];
    const ids = filas.map((fila) => fila.id);
    expect(ids.sort()).toEqual(
      [
        canjePendienteId,
        canjeRechazoId,
        canjeBloqueoId,
        canjeColaUnoId,
        canjeColaDosId,
        canjeClaseDosId,
        canjeAutoId,
      ].sort(),
    );
    expect(ids).not.toContain(canjeEstudianteDosId); // solo los suyos
    expect(propios.body.meta.total).toBe(7);

    // Orden por solicitud descendente (más recientes primero).
    const instantes = filas.map((fila) => Date.parse(fila.solicitadoEn));
    for (let i = 1; i < instantes.length; i++) {
      expect(instantes[i]).toBeLessThanOrEqual(instantes[i - 1]);
    }

    // Paginado sin duplicados (limit=2 sobre 7).
    const pagina1 = await httpServer
      .get('/api/v1/redemptions/mine')
      .query({ page: 1, limit: 2 })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    const pagina2 = await httpServer
      .get('/api/v1/redemptions/mine')
      .query({ page: 2, limit: 2 })
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(pagina1.body.meta).toEqual({ total: 7, page: 1, limit: 2 });
    expect(pagina2.body.meta).toEqual({ total: 7, page: 2, limit: 2 });
    const idsPaginas = [
      ...(pagina1.body.data as FilaCola[]),
      ...(pagina2.body.data as FilaCola[]),
    ].map((fila) => fila.id);
    expect(new Set(idsPaginas).size).toBe(4);

    // El estudiante B ve solo el suyo.
    const delEstudianteDos = await httpServer
      .get('/api/v1/redemptions/mine')
      .set('Authorization', `Bearer ${tokenEstudianteDos}`);
    expect(delEstudianteDos.status).toBe(200);
    expect((delEstudianteDos.body.data as FilaCola[]).map((f) => f.id)).toEqual([
      canjeEstudianteDosId,
    ]);

    // Rol profesor → 403.
    const profesor = await httpServer
      .get('/api/v1/redemptions/mine')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(profesor.status).toBe(403);
    expect(profesor.body.message).toBe(MENSAJE_SIN_ROL);
  });

  it('13. reverse sobre un canje pending → 409', async () => {
    const respuesta = await httpServer
      .post(`/api/v1/redemptions/${canjeBloqueoId}/reverse`)
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.message).toBe(MENSAJE_CANJE_YA_RESUELTO);
  });

  it('14. un estudiante no puede aprobar/rechazar/entregar → 403', async () => {
    for (const accion of ['approve', 'reject', 'deliver'] as const) {
      const respuesta = await resolver(accion, canjeBloqueoId, tokenEstudiante);
      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
    }

    // El canje sigue intacto.
    const fila = await prisma.redemptions.findUnique({
      where: { id: BigInt(canjeBloqueoId) },
    });
    expect(fila?.status).toBe('pending');
    expect(fila?.resolved_by).toBeNull();
    expect(fila?.resolved_at).toBeNull();
  });
});
