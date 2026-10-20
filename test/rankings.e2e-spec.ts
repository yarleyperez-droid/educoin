import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Rankings global y por clase (H4.3 / PRO-281, T4.3.2) contra la BD REAL:
 * solo lectura sobre las vistas `global_ranking`/`class_ranking`, así que
 * los CAs 1–7 + invariante + aislamiento por clase se verifican con
 * fixtures propios y asserts relativos (S12).
 *
 * Aislamiento por corrida (S12): organización sintética NUEVA con
 * `Date.now()`, profesor y estudiantes propios (hash argon2 del seed +
 * `must_change_password: false`, patrón redemptions.e2e) — el ranking de
 * esa org contiene solo los fixtures de ESTA corrida. La suite necesita
 * tokens de 5 usuarios (profesor sintético, 2 estudiantes sintéticos,
 * admin y prof.lopez) y el rate limit de login es 5/min por IP por
 * instancia de app (auth-throttler.guard): se hacen EXACTAMENTE 5 logins.
 * Por eso CA 1 y CA 2 comparten protagonista (estA: ajustes 120 + 100000)
 * y el caso "no inscripto" de CA 4 se cubre con una clase vacía ajena al
 * estudiante en vez de un tercer estudiante con token.
 *
 * Acreditación de monedas: SOLO `INSERT` en `coin_movements` tipo
 * `adjustment` (el trigger `trg_movements_apply` aplica contadores);
 * jamás UPDATE manual. El canje del CA 2 es la API real (`POST
 * /redemptions`) con un ítem `fun_activity` con stock creado vía
 * `POST /items` como el profesor sintético.
 */

const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_PROFESOR_SEED = {
  usuarioOEmail: 'prof.lopez',
  contrasena: 'Prof123!',
};

/** Hash argon2id real de `Estudiante123!` (mismo que `db/002_seed.sql`). */
const HASH_ESTUDIANTE_SEED =
  '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw';

interface FilaApi {
  posicion: number;
  estudianteId: string;
  nombres: string;
  monedasGanadas: number;
  monedasDisponibles: number;
}

describe('Rankings global y por clase (e2e, fixtures aislados por corrida)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;

  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenEstudianteDos = '';
  let tokenProfesorAjeno = '';
  let tokenAdmin = '';

  let claseId = 0n;
  let claseOtraId = 0n;
  let claseVaciaId = 0n;
  let itemFixtureId = 0n;
  let estudianteId = 0n;
  let estudianteDosId = 0n;
  let estudianteTerceroId = 0n;
  let estudianteCrossId = 0n;

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
    const marca = `fixture e2e H4.3 ${unicidad}`;

    // Fixtures de BD --------------------------------------------------
    const org = await prisma.organizations.create({
      data: { name: `Org Rankings E2E ${unicidad}`, type: 'school' },
    });
    organizaciones.push(org.id);

    const profesor = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'teacher',
        username: `prof.rank.${unicidad}`,
        email: `prof.rank.${unicidad}@educoins.test`,
        password_hash: HASH_ESTUDIANTE_SEED,
        first_name: 'Profe',
        last_name: 'Rankings',
        must_change_password: false,
      },
    });
    usuarios.push(profesor.id);

    const crearEstudiante = async (
      username: string,
      first_name: string,
      last_name: string,
    ): Promise<bigint> => {
      const estudiante = await prisma.users.create({
        data: {
          organization_id: org.id,
          role: 'student',
          username,
          email: `${username}@educoins.test`,
          password_hash: HASH_ESTUDIANTE_SEED,
          first_name,
          last_name,
          must_change_password: false,
        },
      });
      usuarios.push(estudiante.id);
      return estudiante.id;
    };
    estudianteId = await crearEstudiante(`est.perez.${unicidad}`, 'Juan', 'Pérez');
    estudianteDosId = await crearEstudiante(
      `est.gomez.${unicidad}`,
      'María',
      'Gómez',
    );
    estudianteTerceroId = await crearEstudiante(
      `est.rios.${unicidad}`,
      'Rita',
      'Ríos',
    );

    // Los 5 logins admitidos por el rate limit de auth (5/min por IP).
    const [loginProfesor, loginEstudiante, loginEstudianteDos, loginAdmin] =
      await Promise.all([
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: profesor.username, contrasena: 'Estudiante123!' }),
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `est.perez.${unicidad}`, contrasena: 'Estudiante123!' }),
        httpServer
          .post('/api/v1/auth/login')
          .send({ usuarioOEmail: `est.gomez.${unicidad}`, contrasena: 'Estudiante123!' }),
        httpServer.post('/api/v1/auth/login').send(LOGIN_ADMIN),
      ]);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenEstudianteDos = loginEstudianteDos.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;
    const loginAjeno = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR_SEED);
    tokenProfesorAjeno = loginAjeno.body.accessToken;

    // Clase propia (CA 1–4) con estA active y estB withdrawn, más una
    // clase OTRA (E9) y una clase VACÍA (CA 4 "no inscripto", sin 6.º login).
    for (const nombre of [
      `Clase Rankings E2E ${unicidad}`,
      `Clase Rankings Otra ${unicidad}`,
      `Clase Rankings Vacia ${unicidad}`,
    ]) {
      const creada = await httpServer
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre });
      expect(creada.status).toBe(201);
      clases.push(BigInt(creada.body.clase.id));
    }
    claseId = clases[0];
    claseOtraId = clases[1];
    claseVaciaId = clases[2];

    const inscripcion = await prisma.enrollments.create({
      data: { class_id: claseId, student_id: estudianteId },
    });
    inscripciones.push(inscripcion.id);
    const inscripcionDos = await prisma.enrollments.create({
      data: {
        class_id: claseId,
        student_id: estudianteDosId,
        status: 'withdrawn',
      },
    });
    inscripciones.push(inscripcionDos.id);
    const inscripcionTercera = await prisma.enrollments.create({
      data: { class_id: claseOtraId, student_id: estudianteTerceroId },
    });
    inscripciones.push(inscripcionTercera.id);

    // CA 1 y CA 2 comparten protagonista (rate limit de logins): estA
    // termina con 100120 ganadas (120 del orden del CA 1 + 100000 del
    // puesto inmune del CA 2) y estB con 60.
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcion.id}, 'adjustment', 120, ${marca})
    `;
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcion.id}, 'adjustment', 100000, ${marca})
    `;
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionDos.id}, 'adjustment', 60, ${marca})
    `;

    // Estudiante de OTRA organización con monedas ganadas (CA 5).
    const orgCross = await prisma.organizations.create({
      data: { name: `Org Rankings Cross ${unicidad}`, type: 'school' },
    });
    organizaciones.push(orgCross.id);
    const profesorCross = await prisma.users.create({
      data: {
        organization_id: orgCross.id,
        role: 'teacher',
        username: `prof.cross.${unicidad}`,
        email: `prof.cross.${unicidad}@educoins.test`,
        password_hash: HASH_ESTUDIANTE_SEED,
        first_name: 'Cruz',
        last_name: 'Org',
        must_change_password: false,
      },
    });
    usuarios.push(profesorCross.id);
    const estudianteCross = await prisma.users.create({
      data: {
        organization_id: orgCross.id,
        role: 'student',
        username: `est.cross.${unicidad}`,
        email: `est.cross.${unicidad}@educoins.test`,
        password_hash: HASH_ESTUDIANTE_SEED,
        first_name: 'Carla',
        last_name: 'Cruz',
        must_change_password: false,
      },
    });
    usuarios.push(estudianteCross.id);
    estudianteCrossId = estudianteCross.id;
    const claseCross = await prisma.classes.create({
      data: {
        teacher_id: profesorCross.id,
        name: `Clase Rankings Cross ${unicidad}`,
      },
    });
    clases.push(claseCross.id);
    const inscripcionCross = await prisma.enrollments.create({
      data: { class_id: claseCross.id, student_id: estudianteCrossId },
    });
    inscripciones.push(inscripcionCross.id);
    await prisma.$executeRaw`
      INSERT INTO coin_movements (enrollment_id, type, quantity, description)
      VALUES (${inscripcionCross.id}, 'adjustment', 500, ${marca})
    `;

    // Ítem con stock en la clase de estA para el canje real del CA 2.
    const item = await httpServer
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        classId: Number(claseId),
        name: `Item Rankings ${unicidad}`,
        type: 'fun_activity',
        costCoins: 30,
        stock: 5,
      });
    expect(item.status).toBe(201);
    itemFixtureId = BigInt(item.body.id);
  });

  afterAll(async () => {
    try {
      // FK primero: movimientos → canjes → inscripciones → ítems → clases
      // → usuarios → organizaciones. Los movimientos se borran por las
      // inscripciones propias (incluye los del trigger del canje).
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

  /** GET /rankings con token y query opcionales. */
  const rankingGlobal = (
    token: string,
    query: Record<string, string | number> = {},
  ) =>
    httpServer
      .get('/api/v1/rankings')
      .set('Authorization', `Bearer ${token}`)
      .query(query);

  /** GET /rankings/classes/:id con token y query opcionales. */
  const rankingClase = (
    token: string,
    id: bigint | string,
    query: Record<string, string | number> = {},
  ) =>
    httpServer
      .get(`/api/v1/rankings/classes/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .query(query);

  const filaDe = (data: FilaApi[], id: bigint): FilaApi | undefined =>
    data.find((fila) => fila.estudianteId === String(id));

  it('CA 1: ordena por monedas ganadas descendente (120 antes que 60)', async () => {
    const respuesta = await rankingGlobal(tokenProfesor);
    expect(respuesta.status).toBe(200);

    const datos = respuesta.body.data as FilaApi[];
    for (let i = 1; i < datos.length; i++) {
      expect(datos[i].monedasGanadas).toBeLessThanOrEqual(
        datos[i - 1].monedasGanadas,
      );
    }

    const filaEstudiante = filaDe(datos, estudianteId);
    const filaEstudianteDos = filaDe(datos, estudianteDosId);
    expect(filaEstudiante).toBeDefined();
    expect(filaEstudianteDos).toBeDefined();
    expect(filaEstudiante?.posicion).toBeLessThan(
      filaEstudianteDos?.posicion ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('CA 2: canjear no baja de puesto ni cambia las monedas ganadas', async () => {
    const antes = await rankingGlobal(tokenProfesor);
    const filaAntes = filaDe(antes.body.data as FilaApi[], estudianteId);
    expect(filaAntes).toBeDefined();

    const canje = await httpServer
      .post('/api/v1/redemptions')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ itemId: String(itemFixtureId) });
    expect(canje.status).toBe(201);
    expect(canje.body.estado).toBe('completed');
    expect(canje.body.costoMonedas).toBe(30);

    const despues = await rankingGlobal(tokenProfesor);
    const filaDespues = filaDe(despues.body.data as FilaApi[], estudianteId);
    expect(filaDespues?.posicion).toBe(filaAntes?.posicion);
    expect(filaDespues?.monedasGanadas).toBe(filaAntes?.monedasGanadas);
    expect(filaDespues?.monedasDisponibles).toBe(
      (filaAntes?.monedasDisponibles ?? 0) - 30,
    );
  });

  it('CA 3: el ranking por clase solo incluye inscripciones active', async () => {
    const respuesta = await rankingClase(tokenProfesor, claseId);
    expect(respuesta.status).toBe(200);

    const datos = respuesta.body.data as FilaApi[];
    const ids = datos.map((fila) => fila.estudianteId);
    expect(ids).toEqual([String(estudianteId)]);
    expect(ids).not.toContain(String(estudianteDosId));
    expect(ids).not.toContain(String(estudianteTerceroId));
  });

  it('CA 4: el profesor dueño ve la clase y el profesor ajeno recibe 404', async () => {
    const dueno = await rankingClase(tokenProfesor, claseId);
    expect(dueno.status).toBe(200);

    const ajeno = await rankingClase(tokenProfesorAjeno, claseId);
    expect(ajeno.status).toBe(404);
    expect(ajeno.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('CA 4: estudiante active 200; withdrawn o no inscripto 404; admin 200', async () => {
    const activo = await rankingClase(tokenEstudiante, claseId);
    expect(activo.status).toBe(200);

    const retirado = await rankingClase(tokenEstudianteDos, claseId);
    expect(retirado.status).toBe(404);
    expect(retirado.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

    const noInscripto = await rankingClase(tokenEstudiante, claseVaciaId);
    expect(noInscripto.status).toBe(404);
    expect(noInscripto.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

    const admin = await rankingClase(tokenAdmin, claseId);
    expect(admin.status).toBe(200);
  });

  it('CA 5: el ranking global no cruza organizaciones (admin sí ve todas)', async () => {
    const deLaCasa = await rankingGlobal(tokenProfesorAjeno, { limit: 100 });
    const idsAjenos = (deLaCasa.body.data as FilaApi[]).map(
      (fila) => fila.estudianteId,
    );
    expect(idsAjenos).not.toContain(String(estudianteCrossId));

    const delProfe = await rankingGlobal(tokenProfesor, { limit: 100 });
    const idsPropios = (delProfe.body.data as FilaApi[]).map(
      (fila) => fila.estudianteId,
    );
    expect(idsPropios).not.toContain(String(estudianteCrossId));

    const global = await rankingGlobal(tokenAdmin, { limit: 100 });
    const idsAdmin = (global.body.data as FilaApi[]).map(
      (fila) => fila.estudianteId,
    );
    expect(idsAdmin).toContain(String(estudianteCrossId));
  });

  it('CA 6: ?page=2&limit=5 devuelve meta coherente y sin params defaults 1/20', async () => {
    const completa = await rankingGlobal(tokenProfesor, { limit: 100 });
    const total = completa.body.meta.total as number;
    expect(total).toBe((completa.body.data as FilaApi[]).length);

    const segunda = await rankingGlobal(tokenProfesor, { page: 2, limit: 5 });
    expect(segunda.status).toBe(200);
    expect(segunda.body.meta).toEqual({ total, page: 2, limit: 5 });

    const porDefecto = await rankingGlobal(tokenProfesor);
    expect(porDefecto.body.meta).toEqual({ total, page: 1, limit: 20 });
  });

  it('CA 6: page=0, limit=0 o limit=101 se rechazan con 400', async () => {
    const pageCero = await rankingGlobal(tokenProfesor, { page: 0 });
    expect(pageCero.status).toBe(400);

    const limitCero = await rankingGlobal(tokenProfesor, { limit: 0 });
    expect(limitCero.status).toBe(400);

    const limitGrande = await rankingGlobal(tokenProfesor, { limit: 101 });
    expect(limitGrande.status).toBe(400);
  });

  it('CA 7: sin token 401 y :id no numérico 404 (anti-enumeración)', async () => {
    const sinToken = await httpServer.get('/api/v1/rankings');
    expect(sinToken.status).toBe(401);
    expect(sinToken.body.message).toBe(MENSAJE_NO_AUTENTICADO);

    const idRaro = await rankingClase(tokenProfesor, 'abc');
    expect(idRaro.status).toBe(404);
    expect(idRaro.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('invariante: monedasGanadas no creciente y posicion no decreciente en data', async () => {
    const respuesta = await rankingGlobal(tokenProfesor);
    expect(respuesta.status).toBe(200);

    const datos = respuesta.body.data as FilaApi[];
    for (let i = 1; i < datos.length; i++) {
      expect(datos[i].monedasGanadas).toBeLessThanOrEqual(
        datos[i - 1].monedasGanadas,
      );
      expect(datos[i].posicion).toBeGreaterThanOrEqual(datos[i - 1].posicion);
    }
  });

  it('E9: el ranking por clase no mezcla estudiantes de otra clase de la misma org', async () => {
    const propia = await rankingClase(tokenProfesor, claseId);
    const idsPropia = (propia.body.data as FilaApi[]).map(
      (fila) => fila.estudianteId,
    );
    expect(idsPropia).not.toContain(String(estudianteTerceroId));

    const otra = await rankingClase(tokenProfesor, claseOtraId);
    const idsOtra = (otra.body.data as FilaApi[]).map(
      (fila) => fila.estudianteId,
    );
    expect(idsOtra).toContain(String(estudianteTerceroId));
    expect(idsOtra).not.toContain(String(estudianteId));
  });
});
