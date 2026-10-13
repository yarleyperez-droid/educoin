import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_SIN_ROL } from '../src/common/guards/roles.guard';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';

/**
 * Creación de clases (e2e, BD real con datos del seed):
 * POST /api/v1/classes solo para teacher, con el código de unión
 * generado internamente por la BD (DEFAULT de classes.code).
 */
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

describe('Creación de clases (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenAdmin = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());

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
  });

  afterAll(async () => {
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
});
