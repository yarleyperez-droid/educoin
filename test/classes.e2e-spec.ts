import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_SIN_ROL } from '../src/common/guards/roles.guard';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Clases de profesores (e2e, BD real con datos del seed):
 * - POST  /api/v1/classes   → solo teacher; código de unión generado por la BD.
 * - PATCH /api/v1/classes/:id → editar/archivar con @PerteneceA.
 * - GET   /api/v1/classes   → búsqueda por nombre con pg_trgm; estudiante
 *   ve clases activas de SU organización, profesor solo las suyas.
 *
 * La búsqueda necesita una clase de OTRA organización para probar el
 * alcance negativamente: se crea una fixture (org + profesor + clase) en
 * beforeAll y se limpia físicamente en afterAll. Del mismo modo se crea
 * una clase ARCHIVADA propia de prof.lopez, porque el seed solo genera
 * 'Mathematics 10A' (active) y el caso "el profesor ve sus archivadas"
 * necesita un registro archivado real.
 */
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

describe('Clases (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenAdmin = '';
  const fixture: {
    orgId?: bigint;
    profesorId?: bigint;
    claseId?: bigint;
    claseArchivadaId?: bigint;
  } = {};

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
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;

    // Fixture: clase de OTRA organización (clase ajena a prof.lopez y
    // a la organización de est.perez) para los casos negativos de alcance.
    const unicidad = Date.now();
    const org = await prisma.organizations.create({
      data: {
        name: `Org Fixture E2E ${unicidad}`,
        type: 'school',
      },
    });
    const profesorFixture = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'teacher',
        username: `prof.fixture.${unicidad}`,
        email: `prof.fixture.${unicidad}@educoins.test`,
        password_hash: 'SOLO-FIXTURE-NO-LOGUEABLE',
        first_name: 'Fito',
        last_name: 'Fijo',
        must_change_password: false,
      },
    });
    const claseFixture = await prisma.classes.create({
      data: {
        teacher_id: profesorFixture.id,
        name: 'Mathematics OtherOrg',
      },
    });
    fixture.orgId = org.id;
    fixture.profesorId = profesorFixture.id;
    fixture.claseId = claseFixture.id;

    // Fixture: clase ARCHIVADA del profesor del seed. El seed solo crea
    // 'Mathematics 10A' (active), así que sin este registro el caso
    // "el profesor sí encuentra sus clases archivadas" no puede pasar.
    const profesorSeed = await prisma.users.findFirst({
      where: { username: 'prof.lopez' },
    });
    if (!profesorSeed) {
      throw new Error('Falta el usuario prof.lopez en el seed (002_seed.sql)');
    }
    const claseArchivada = await prisma.classes.create({
      data: {
        teacher_id: profesorSeed.id,
        name: 'Proyecto integrador Renombrado',
        status: 'archived',
      },
    });
    fixture.claseArchivadaId = claseArchivada.id;
  });

  afterAll(async () => {
    if (fixture.claseArchivadaId !== undefined) {
      await prisma.classes.delete({
        where: { id: fixture.claseArchivadaId },
      });
    }
    if (fixture.claseId !== undefined) {
      await prisma.classes.delete({ where: { id: fixture.claseId } });
    }
    if (fixture.profesorId !== undefined) {
      await prisma.users.delete({ where: { id: fixture.profesorId } });
    }
    if (fixture.orgId !== undefined) {
      await prisma.organizations.delete({ where: { id: fixture.orgId } });
    }
    await app.close();
  });

  it('el profesor crea una clase y la BD genera el código de unión', async () => {
    const nombreUnico = `Clase E2E ${Date.now()}`;
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: nombreUnico });

    expect(respuesta.status).toBe(201);
    // El mensaje de éxito destaca el código real que la BD generó para
    // compartirlo con los estudiantes.
    expect(respuesta.body.clase).toEqual({
      id: expect.any(String),
      profesorId: expect.any(String),
      nombre: nombreUnico,
      codigo: expect.stringMatching(/^[0-9A-F]{8}$/),
      estado: 'active',
      creadoEn: expect.any(String),
      actualizadoEn: expect.any(String),
    });
    expect(respuesta.body.mensaje).toBe(
      `Clase creada con éxito. Comparte el código ${respuesta.body.clase.codigo} con tus estudiantes.`,
    );
    // Nunca salen entidades Prisma crudas (snake_case) hacia el cliente.
    expect(respuesta.body.clase).not.toHaveProperty('code');
    expect(respuesta.body.clase).not.toHaveProperty('name');
    expect(respuesta.body.clase).not.toHaveProperty('teacher_id');
    expect(respuesta.body.clase).not.toHaveProperty('status');
  });

  it('el profesor NO puede injectar el código ni el profesor desde el body', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        nombre: `Clase E2E inject ${Date.now()}`,
        code: 'HACKED123',
        teacher_id: 999,
      });

    expect(respuesta.status).toBe(400);
  });

  it('rechaza con 409 un nombre duplicado (índice lower(name), sin distinguir mayúsculas)', async () => {
    // El seed trae 'Mathematics 10A' de prof.lopez: otra grafía choca
    // igual por el índice único sobre lower(name).
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: 'mathematics 10a' });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.message).toMatch(
      /Ya existe un registro con ese valor único/,
    );
  });

  it('el estudiante recibe 403 (solo profesores crean clases)', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ nombre: 'Clase que no debe crearse' });

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
  });

  it('el admin también recibe 403 (la regla de negocio reserva la creación al profesor)', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Clase que no debe crearse' });

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
  });

  it('sin token de acceso la petición no pasa del guard JWT (401)', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes')
      .send({ nombre: 'Clase que no debe crearse' });

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('rechaza con 400 nombres inválidos (corto, vacío o de más de 150)', async () => {
    const corto = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: 'Corto' });
    expect(corto.status).toBe(400);

    const vacio = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: '' });
    expect(vacio.status).toBe(400);

    const largo = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: 'x'.repeat(151) });
    expect(largo.status).toBe(400);

    const sinNombre = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({});
    expect(sinNombre.status).toBe(400);
  });

  describe('PATCH /classes/:id (editar y archivar, @PerteneceA activo)', () => {
    const crearClasePropia = async (): Promise<string> => {
      const creada = await httpServer
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: `Clase Editable E2E ${Date.now()}` });
      expect(creada.status).toBe(201);
      return creada.body.clase.id as string;
    };

    it('el profesor renombra su clase y el trigger de la BD renueva updated_at', async () => {
      const id = await crearClasePropia();
      const nuevoNombre = `Clase Editable E2E Renombrada ${Date.now()}`;

      const respuesta = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: nuevoNombre });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        id,
        profesorId: expect.any(String),
        nombre: nuevoNombre,
        codigo: expect.stringMatching(/^[0-9A-F]{8}$/),
        estado: 'active',
        creadoEn: expect.any(String),
        actualizadoEn: expect.any(String),
      });
      expect(new Date(respuesta.body.actualizadoEn).getTime()).toBeGreaterThan(
        new Date(respuesta.body.creadoEn).getTime(),
      );
    });

    it('el profesor archiva su clase y luego la reactiva', async () => {
      const id = await crearClasePropia();

      const archivada = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });
      expect(archivada.status).toBe(200);
      expect(archivada.body.estado).toBe('archived');

      const reactivada = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'active' });
      expect(reactivada.status).toBe(200);
      expect(reactivada.body.estado).toBe('active');
    });

    it('rechaza renombrar a un nombre duplicado con 409 (índice lower(name))', async () => {
      const id = await crearClasePropia();

      const respuesta = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: 'mathematics 10a' });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toMatch(
        /Ya existe un registro con ese valor único/,
      );
    });

    it('clase inexistente → 404 estándar (anti-enumeración)', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/classes/999999')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('estudiante y admin reciben 403 (rol); sin token 401', async () => {
      const id = await crearClasePropia();

      const estudiante = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ estado: 'archived' });
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);

      const admin = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ estado: 'archived' });
      expect(admin.status).toBe(403);

      const sinToken = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .send({ estado: 'archived' });
      expect(sinToken.status).toBe(401);
    });

    it('rechaza cuerpo vacío (400) y estados fuera del enum (400)', async () => {
      const id = await crearClasePropia();

      const vacio = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({});
      expect(vacio.status).toBe(400);

      const estadoInvalido = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'deleted' });
      expect(estadoInvalido.status).toBe(400);
    });
  });

  describe('GET /classes (búsqueda pg_trgm por rol)', () => {
    it('el estudiante encuentra la clase del seed AUN CON un error de tipeo', async () => {
      // 'mathemtics 1a' no es subcadena de 'Mathematics 10A': solo la
      // similitud de trigramas (operador %) puede encontrarla.
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'mathemtics 1a' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      const nombres = respuesta.body.data.map(
        (c: { nombre: string }) => c.nombre,
      );
      expect(nombres).toContain('Mathematics 10A');
      // La clase de la otra organización no debe aparecerle.
      expect(nombres).not.toContain('Mathematics OtherOrg');
      expect(respuesta.body.meta.total).toBeGreaterThanOrEqual(1);
      // El ítem no expone código de unión ni ids internos.
      expect(respuesta.body.data[0]).not.toHaveProperty('codigo');
      expect(respuesta.body.data[0]).not.toHaveProperty('code');
    });

    it('el estudiante encuentra por subcadena (ILIKE vía índice trgm)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'mathe' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      expect(
        respuesta.body.data.some(
          (c: { nombre: string }) => c.nombre === 'Mathematics 10A',
        ),
      ).toBe(true);
    });

    it('el estudiante NO ve clases archivadas de su organización', async () => {
      // 'Proyecto integrador Renombrado' está archived en la BD (fixture
      // creada en el beforeAll del suite).
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'Proyecto integrador' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      const nombres = respuesta.body.data.map(
        (c: { nombre: string }) => c.nombre,
      );
      expect(nombres).not.toContain('Proyecto integrador Renombrado');
    });

    it('el estudiante NO ve clases de otra organización aunque coincidan', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'mathematics' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      const nombres = respuesta.body.data.map(
        (c: { nombre: string }) => c.nombre,
      );
      expect(nombres).toContain('Mathematics 10A');
      expect(nombres).not.toContain('Mathematics OtherOrg');
    });

    it('el profesor solo ve SUS clases (ni archivadas de otros ni de otra org)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'mathematics' })
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      const nombres = respuesta.body.data.map(
        (c: { nombre: string }) => c.nombre,
      );
      expect(nombres).toContain('Mathematics 10A');
      expect(nombres).not.toContain('Mathematics OtherOrg');
    });

    it('el profesor SÍ encuentra sus clases archivadas (para reactivarlas)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'Proyecto integrador' })
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      const archivada = respuesta.body.data.find(
        (c: { nombre: string }) =>
          c.nombre === 'Proyecto integrador Renombrado',
      );
      expect(archivada).toMatchObject({ estado: 'archived' });
      // El nombre del profesor depende del encoding con que se aplicó el
      // seed (hoy almacena mojibake: ver reporte de bugs); solo se
      // comprueba que venga el nombre de pila.
      expect(String(archivada.profesorNombre)).toMatch(/^Ana /);
    });

    it('el admin ve clases de todas las organizaciones (rol global)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'mathematics' })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      const nombres = respuesta.body.data.map(
        (c: { nombre: string }) => c.nombre,
      );
      expect(nombres).toContain('Mathematics 10A');
      expect(nombres).toContain('Mathematics OtherOrg');
    });

    it('sin coincidencias devuelve 200 con lista y total en cero', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'zzzzzzzzzz' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('valida los parámetros: q corto, page y limit fuera de rango', async () => {
      const qCorto = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'ab' })
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(qCorto.status).toBe(400);

      const pageCero = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'matema', page: 0 })
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(pageCero.status).toBe(400);

      const limitGrande = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'matema', limit: 99 })
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(limitGrande.status).toBe(400);
    });

    it('sin q lista todas las clases visibles para el rol (200 paginado)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(Array.isArray(respuesta.body.data)).toBe(true);
      expect(respuesta.body.meta).toMatchObject({ page: 1, limit: 20 });
    });

    it('sin token la búsqueda no pasa del guard JWT (401)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes')
        .query({ q: 'matema' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });

  describe('GET /classes/:id/estudiantes (inscriptos de la clase propia)', () => {
    it('el profesor lista los estudiantes inscritos en SU clase del seed', async () => {
      // Clase 1 = 'Mathematics 10A' de prof.lopez; el seed inscribe a
      // est.perez y est.gomez. Las aserciones usan username (ASCII)
      // porque los nombres del seed tienen el mojibake ya reportado.
      const respuesta = await httpServer
        .get('/api/v1/classes/1/estudiantes')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({ total: 2, page: 1, limit: 20 });

      const usernames = respuesta.body.data.map(
        (e: { username: string }) => e.username,
      );
      expect(usernames).toEqual(
        expect.arrayContaining(['est.perez', 'est.gomez']),
      );
      expect(respuesta.body.data).toHaveLength(2);

      // Identidad + estado solamente: sin monedas ni email.
      const primero = respuesta.body.data[0];
      expect(primero).toMatchObject({
        estado: 'active',
        nombre: expect.any(String),
        inscritoEn: expect.any(String),
      });
      expect(primero.id).toMatch(/^\d+$/);
      expect(primero.estudianteId).toMatch(/^\d+$/);
      expect(primero).not.toHaveProperty('monedasGanadas');
      expect(primero).not.toHaveProperty('email');
    });

    it('una clase nueva sin inscriptos devuelve lista vacía con total 0', async () => {
      const creada = await httpServer
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: `Clase Sin Estudiantes E2E ${Date.now()}` });
      expect(creada.status).toBe(201);
      const id = creada.body.clase.id as string;

      const respuesta = await httpServer
        .get(`/api/v1/classes/${id}/estudiantes`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('clase inexistente → 404 estándar (anti-enumeración)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes/999999/estudiantes')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('estudiante y admin reciben 403 (solo profesores gestionan inscriptos)', async () => {
      const estudiante = await httpServer
        .get('/api/v1/classes/1/estudiantes')
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);

      const admin = await httpServer
        .get('/api/v1/classes/1/estudiantes')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(admin.status).toBe(403);
    });

    it('valida la paginación: page=0 y limit=99 → 400', async () => {
      const pageCero = await httpServer
        .get('/api/v1/classes/1/estudiantes')
        .query({ page: 0 })
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(pageCero.status).toBe(400);

      const limitGrande = await httpServer
        .get('/api/v1/classes/1/estudiantes')
        .query({ limit: 99 })
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(limitGrande.status).toBe(400);
    });

    it('sin token el listado no pasa del guard JWT (401)', async () => {
      const respuesta = await httpServer.get('/api/v1/classes/1/estudiantes');

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });

  describe('Flujo: un profesor busca una clase por nombre y la archiva', () => {
    it('crear → buscar → archivar → re-buscar, con el guard cortando clases ajenas', async () => {
      const nombreUnico = `Flujo E2E ${Date.now()}`;

      // 1. El profesor crea la clase con la que correrá el flujo.
      const creada = await httpServer
        .post('/api/v1/classes')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ nombre: nombreUnico });
      expect(creada.status).toBe(201);
      const id = creada.body.clase.id as string;

      // 2. La busca por su nombre y el resultado entrega el mismo id.
      const busqueda = await httpServer
        .get('/api/v1/classes')
        .query({ q: nombreUnico })
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(busqueda.status).toBe(200);
      const encontrada = busqueda.body.data.find(
        (c: { id: string }) => c.id === id,
      );
      expect(encontrada).toMatchObject({
        nombre: nombreUnico,
        estado: 'active',
      });

      // 3. La archiva (PATCH con @PerteneceA: es SU clase).
      const archivada = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });
      expect(archivada.status).toBe(200);
      expect(archivada.body.estado).toBe('archived');

      // 4. Su búsqueda sigue listándola — el profesor ve sus archivadas.
      const reBusquedaProfesor = await httpServer
        .get('/api/v1/classes')
        .query({ q: nombreUnico })
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(reBusquedaProfesor.status).toBe(200);
      const trasArchivar = reBusquedaProfesor.body.data.find(
        (c: { id: string }) => c.id === id,
      );
      expect(trasArchivar).toMatchObject({ estado: 'archived' });

      // 5. El estudiante ya no la ve (filtro de estado por rol en la búsqueda).
      const busquedaEstudiante = await httpServer
        .get('/api/v1/classes')
        .query({ q: nombreUnico })
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(busquedaEstudiante.status).toBe(200);
      expect(
        busquedaEstudiante.body.data.some((c: { id: string }) => c.id === id),
      ).toBe(false);

      // 6. Guard de pertenencia: la clase de la OTRA organización es
      // ajena → el PATCH responde el 404 estándar, no 403 ni 200.
      const idClaseAjena = String(fixture.claseId);
      const ajena = await httpServer
        .patch(`/api/v1/classes/${idClaseAjena}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });
      expect(ajena.status).toBe(404);
      expect(ajena.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      // 7. El estudiante no llega a la pertenencia: RolesGuard da 403.
      const estudiante = await httpServer
        .patch(`/api/v1/classes/${id}`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ estado: 'archived' });
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);
    });
  });
});
