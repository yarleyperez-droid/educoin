import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_SIN_ROL } from '../src/common/guards/roles.guard';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import { MENSAJE_ORGANIZACION_CREADA } from '../src/modules/organizations/organizations.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Organizaciones (e2e, BD real con datos del seed):
 * - POST   /api/v1/organizations     → solo admin; 201 + mensaje; 409 duplicado.
 * - GET    /api/v1/organizations      → listado paginado con filtros (solo admin).
 * - GET    /api/v1/organizations/:id  → detalle; 404 inexistente/no numérico.
 * - PATCH  /api/v1/organizations/:id  → editar campos; 400 cuerpo vacío.
 * - DELETE /api/v1/organizations/:id  → borrado LÓGICO (is_active=false): el
 *   registro SIGUE en la BD y se reactiva con PATCH { activa: true }.
 *
 * teacher y student reciben 403 en todo el módulo: solo el admin gestiona
 * organizaciones (AGENTS.md §5). Las organizaciones creadas por los tests
 * son fixtures sin usuarios y se limpian físicamente en afterAll; el
 * 'Colegio Demo' del seed nunca se modifica.
 */
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

describe('Organizaciones (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenAdmin = '';
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let colegioDemoId = BigInt(0);
  const idsCreados: bigint[] = [];
  let secuencia = 0;

  /** Nombre único por llamada: Date.now() solo puede repetirse en el mismo ms. */
  const nombreUnico = (prefijo: string): string =>
    `${prefijo} ${Date.now()} ${++secuencia}`;

  /** Crea una organización como admin y registra el id para el afterAll. */
  const crearOrganizacion = async (
    sobrescrituras: Record<string, unknown> = {},
  ): Promise<string> => {
    const respuesta = await httpServer
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: nombreUnico('Org Fixture E2E'),
        tipo: 'school',
        ...sobrescrituras,
      });
    expect(respuesta.status).toBe(201);
    const id = respuesta.body.organizacion.id as string;
    idsCreados.push(BigInt(id));
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const loginAdmin = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    const loginProfesor = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR);
    const loginEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ESTUDIANTE);
    tokenAdmin = loginAdmin.body.accessToken;
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;

    // La organización del seed sirve para el detalle y el 409 de
    // duplicado; se busca por nombre para no asumir su id.
    const colegioDemo = await prisma.organizations.findFirst({
      where: { name: 'Colegio Demo' },
      select: { id: true },
    });
    if (colegioDemo === null) {
      throw new Error(
        "El seed no trae la organización 'Colegio Demo': aplica db/002_seed.sql antes de los e2e.",
      );
    }
    colegioDemoId = colegioDemo.id;
  });

  afterAll(async () => {
    // Limpieza física de las fixtures: ninguna tiene usuarios, así que
    // el DELETE es seguro (el endpoint solo desactiva; la limpieza de
    // tests es la única vía de borrado físico, igual que en classes.e2e).
    for (const id of [...idsCreados].reverse()) {
      await prisma.organizations.delete({ where: { id } });
    }
    await app.close();
  });

  describe('POST /organizations (crear, solo admin)', () => {
    it('el admin crea una organización y recibe mensaje + DTO en español', async () => {
      const nombre = nombreUnico('Colegio E2E');
      const respuesta = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre, tipo: 'university' });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body).toEqual({
        mensaje: MENSAJE_ORGANIZACION_CREADA,
        organizacion: {
          id: expect.any(String),
          nombre,
          tipo: 'university',
          // Sin ciudad en el body → null (columna nullable).
          ciudad: null,
          // is_active lo puso la BD con su DEFAULT TRUE.
          activa: true,
          creadoEn: expect.any(String),
          actualizadoEn: expect.any(String),
        },
      });
      // Nunca salen entidades Prisma crudas (snake_case) hacia el cliente.
      expect(respuesta.body.organizacion).not.toHaveProperty('name');
      expect(respuesta.body.organizacion).not.toHaveProperty('is_active');
      expect(respuesta.body.organizacion).not.toHaveProperty('created_at');
      idsCreados.push(BigInt(respuesta.body.organizacion.id));
    });

    it('el admin NO puede injectar is_active ni timestamps desde el body', async () => {
      const respuesta = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: nombreUnico('Org Inject E2E'),
          tipo: 'school',
          is_active: false,
          created_at: '2000-01-01T00:00:00Z',
        });

      expect(respuesta.status).toBe(400);
    });

    it('rechaza con 409 un nombre duplicado (organizations.name UNIQUE)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: 'Colegio Demo', tipo: 'school' });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toMatch(
        /Ya existe un registro con ese valor único/,
      );
    });

    it('teacher y student reciben 403 (solo el admin crea organizaciones)', async () => {
      const cuerpo = { nombre: nombreUnico('Org Prohibida'), tipo: 'school' };

      const profesor = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send(cuerpo);
      expect(profesor.status).toBe(403);
      expect(profesor.body.message).toBe(MENSAJE_SIN_ROL);

      const estudiante = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send(cuerpo);
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);
    });

    it('sin token la creación no pasa del guard JWT (401)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/organizations')
        .send({ nombre: nombreUnico('Org Sin Token'), tipo: 'school' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });

    it('rechaza con 400 bodies inválidos (nombre, tipo, ciudad)', async () => {
      const corto = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: 'AB', tipo: 'school' });
      expect(corto.status).toBe(400);

      const vacio = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: '', tipo: 'school' });
      expect(vacio.status).toBe(400);

      const sinNombre = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'school' });
      expect(sinNombre.status).toBe(400);

      const tipoInvalido = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: nombreUnico('Org Tipo Malo'), tipo: 'college' });
      expect(tipoInvalido.status).toBe(400);

      const ciudadLarga = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: nombreUnico('Org Ciudad Larga'),
          tipo: 'school',
          ciudad: 'x'.repeat(101),
        });
      expect(ciudadLarga.status).toBe(400);
    });
  });

  describe('GET /organizations (listado paginado, solo admin)', () => {
    it('el admin lista organizaciones con { data, meta } y ve las del seed', async () => {
      const respuesta = await httpServer
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({
        total: expect.any(Number),
        page: 1,
        limit: 20,
      });
      const nombres = respuesta.body.data.map(
        (o: { nombre: string }) => o.nombre,
      );
      expect(nombres).toContain('Colegio Demo');
      // Nunca salen entidades Prisma crudas (snake_case) hacia el cliente.
      expect(respuesta.body.data[0]).not.toHaveProperty('name');
      expect(respuesta.body.data[0]).not.toHaveProperty('is_active');
    });

    it('filtra por nombre sin distinguir mayúsculas (contains insensible)', async () => {
      const id = await crearOrganizacion({
        nombre: nombreUnico('Org Filtro Nombre E2E'),
      });

      const respuesta = await httpServer
        .get('/api/v1/organizations')
        .query({ q: 'org filtro nombre e2e' })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      const ids = respuesta.body.data.map((o: { id: string }) => o.id);
      expect(ids).toContain(id);
    });

    it('filtra por tipo de organización', async () => {
      const id = await crearOrganizacion({
        nombre: nombreUnico('Org Filtro Tipo E2E'),
        tipo: 'university',
      });

      const universidades = await httpServer
        .get('/api/v1/organizations')
        .query({ tipo: 'university' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(universidades.status).toBe(200);
      expect(
        universidades.body.data.map((o: { id: string }) => o.id),
      ).toContain(id);

      const colegios = await httpServer
        .get('/api/v1/organizations')
        .query({ tipo: 'school' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(colegios.body.data.map((o: { id: string }) => o.id)).not.toContain(
        id,
      );
    });

    it('valida la paginación y el booleano activa (400 en vez de interpretar)', async () => {
      const pageCero = await httpServer
        .get('/api/v1/organizations')
        .query({ page: 0 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(pageCero.status).toBe(400);

      const limitGrande = await httpServer
        .get('/api/v1/organizations')
        .query({ limit: 99 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(limitGrande.status).toBe(400);

      // 'si' no es booleano: el @Transform lo deja intacto y @IsBoolean
      // responde 400 (nunca Boolean('si') → true).
      const activaInvalida = await httpServer
        .get('/api/v1/organizations')
        .query({ activa: 'si' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(activaInvalida.status).toBe(400);
    });

    it('teacher y student reciben 403; sin token 401', async () => {
      const profesor = await httpServer
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(profesor.status).toBe(403);
      expect(profesor.body.message).toBe(MENSAJE_SIN_ROL);

      const estudiante = await httpServer
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(estudiante.status).toBe(403);

      const sinToken = await httpServer.get('/api/v1/organizations');
      expect(sinToken.status).toBe(401);
      expect(sinToken.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });

  describe('GET /organizations/:id (detalle, solo admin)', () => {
    it('el admin obtiene el detalle de la organización del seed', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/organizations/${colegioDemoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({
        id: String(colegioDemoId),
        nombre: 'Colegio Demo',
        tipo: 'school',
        ciudad: 'Buga',
        activa: true,
      });
    });

    it('el detalle de una recién creada coincide con su respuesta de creación', async () => {
      const nombre = nombreUnico('Org Detalle E2E');
      const id = await crearOrganizacion({ nombre, ciudad: 'Cali' });

      const respuesta = await httpServer
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        id,
        nombre,
        tipo: 'school',
        ciudad: 'Cali',
        activa: true,
        creadoEn: expect.any(String),
        actualizadoEn: expect.any(String),
      });
    });

    it('inexistente y no numérico → 404 estándar (anti-enumeración)', async () => {
      const inexistente = await httpServer
        .get('/api/v1/organizations/999999999')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(inexistente.status).toBe(404);
      expect(inexistente.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const noNumerico = await httpServer
        .get('/api/v1/organizations/abc')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(noNumerico.status).toBe(404);
      expect(noNumerico.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('teacher recibe 403 (el rol corta antes de la existencia)', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/organizations/${colegioDemoId}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
    });
  });

  describe('PATCH /organizations/:id (editar, solo admin)', () => {
    it('el admin renombra, cambia el tipo y el trigger renueva updated_at', async () => {
      const id = await crearOrganizacion();
      const nuevoNombre = nombreUnico('Org Editada E2E');

      const respuesta = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: nuevoNombre, tipo: 'university', ciudad: 'Cali' });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({
        id,
        nombre: nuevoNombre,
        tipo: 'university',
        ciudad: 'Cali',
        activa: true,
        creadoEn: expect.any(String),
        actualizadoEn: expect.any(String),
      });
      expect(new Date(respuesta.body.actualizadoEn).getTime()).toBeGreaterThan(
        new Date(respuesta.body.creadoEn).getTime(),
      );
    });

    it('limpia la ciudad cuando llega null (columna nullable)', async () => {
      const id = await crearOrganizacion({ ciudad: 'Buga' });

      const respuesta = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ciudad: null });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.ciudad).toBeNull();
    });

    it('desactiva con activa=false y reactiva con activa=true', async () => {
      const id = await crearOrganizacion();

      const desactivada = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: false });
      expect(desactivada.status).toBe(200);
      expect(desactivada.body.activa).toBe(false);

      const reactivada = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: true });
      expect(reactivada.status).toBe(200);
      expect(reactivada.body.activa).toBe(true);
    });

    it('rechaza renombrar a un nombre duplicado con 409', async () => {
      const id = await crearOrganizacion();

      const respuesta = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: 'Colegio Demo' });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toMatch(
        /Ya existe un registro con ese valor único/,
      );
    });

    it('inexistente y no numérico → 404 estándar', async () => {
      const inexistente = await httpServer
        .patch('/api/v1/organizations/999999999')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: false });
      expect(inexistente.status).toBe(404);
      expect(inexistente.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const noNumerico = await httpServer
        .patch('/api/v1/organizations/abc')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: false });
      expect(noNumerico.status).toBe(404);
      expect(noNumerico.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('rechaza cuerpo vacío (400) y valores fuera de regla (400)', async () => {
      const id = await crearOrganizacion();

      const vacio = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(vacio.status).toBe(400);

      const tipoInvalido = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'college' });
      expect(tipoInvalido.status).toBe(400);

      const nombreLargo = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: 'x'.repeat(201) });
      expect(nombreLargo.status).toBe(400);
    });

    it('teacher recibe 403', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/organizations/${colegioDemoId}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ activa: false });

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
    });
  });

  describe('DELETE /organizations/:id (borrado lógico, solo admin)', () => {
    it('responde 204, el registro SIGUE en la BD con is_active=false', async () => {
      const id = await crearOrganizacion();

      const respuesta = await httpServer
        .delete(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(respuesta.status).toBe(204);

      // Borrado LÓGICO (decisión del equipo): el detalle sigue
      // existiendo, solo cambia el estado activo.
      const detalle = await httpServer
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body.activa).toBe(false);

      const enBd = await prisma.organizations.findFirst({
        where: { id: BigInt(id) },
        select: { is_active: true },
      });
      expect(enBd).toEqual({ is_active: false });
    });

    it('es idempotente: un segundo DELETE vuelve a responder 204', async () => {
      const id = await crearOrganizacion();

      const primero = await httpServer
        .delete(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(primero.status).toBe(204);

      const segundo = await httpServer
        .delete(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(segundo.status).toBe(204);
    });

    it('inexistente y no numérico → 404 estándar', async () => {
      const inexistente = await httpServer
        .delete('/api/v1/organizations/999999999')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(inexistente.status).toBe(404);
      expect(inexistente.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const noNumerico = await httpServer
        .delete('/api/v1/organizations/abc')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(noNumerico.status).toBe(404);
      expect(noNumerico.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('teacher recibe 403', async () => {
      const respuesta = await httpServer
        .delete(`/api/v1/organizations/${colegioDemoId}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
    });
  });

  describe('Flujo: admin registra, consulta, desactiva y reactiva', () => {
    it('crear → listar (q) → detallar → editar → DELETE lógico → filtrar → reactivar', async () => {
      const nombre = nombreUnico('Org Flujo E2E');

      // 1. Registra la organización con la que correrá el flujo.
      const creada = await httpServer
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre, tipo: 'other', ciudad: 'Tulúa' });
      expect(creada.status).toBe(201);
      const id = creada.body.organizacion.id as string;
      idsCreados.push(BigInt(id));

      // 2. La lista por su nombre (contains insensible) y obtiene su id.
      const listado = await httpServer
        .get('/api/v1/organizations')
        .query({ q: nombre.toLowerCase() })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(listado.status).toBe(200);
      expect(listado.body.data.map((o: { id: string }) => o.id)).toContain(id);

      // 3. El detalle coincide con la creación.
      const detalle = await httpServer
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body).toMatchObject({ id, nombre, tipo: 'other' });

      // 4. La edita a 'school'.
      const editada = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo: 'school' });
      expect(editada.status).toBe(200);
      expect(editada.body.tipo).toBe('school');

      // 5. La desactiva con DELETE: borrado lógico, no físico.
      const eliminada = await httpServer
        .delete(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(eliminada.status).toBe(204);

      // 6. El listado por estado la muestra entre las inactivas y ya
      //    no entre las activas.
      const inactivas = await httpServer
        .get('/api/v1/organizations')
        .query({ activa: 'false' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(inactivas.status).toBe(200);
      expect(inactivas.body.data.map((o: { id: string }) => o.id)).toContain(
        id,
      );

      const activas = await httpServer
        .get('/api/v1/organizations')
        .query({ activa: 'true' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(activas.status).toBe(200);
      expect(activas.body.data.map((o: { id: string }) => o.id)).not.toContain(
        id,
      );

      // 7. Solo PATCH { activa: true } la reactiva.
      const reactivada = await httpServer
        .patch(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: true });
      expect(reactivada.status).toBe(200);
      expect(reactivada.body.activa).toBe(true);
    });
  });
});
