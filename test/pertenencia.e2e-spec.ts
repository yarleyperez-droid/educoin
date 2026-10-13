import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PerteneceA } from '../src/common/decorators/pertenece-a.decorator';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';

/**
 * Controlador de PRUEBA que existe solo dentro de esta spec para poder
 * ejercitar PertenenciaGuard contra la BD real con las rutas @PerteneceA.
 * No forma parte de la API de producción.
 */
@Controller('prueba-pertenencia')
class ControladorPrueba {
  @PerteneceA('clase', 'id')
  @Get('clases/:id')
  clase(): { ok: boolean } {
    return { ok: true };
  }

  @PerteneceA('inscripcion', 'id')
  @Get('inscripciones/:id')
  inscripcion(): { ok: boolean } {
    return { ok: true };
  }

  @PerteneceA('item', 'id')
  @Get('items/:id')
  item(): { ok: boolean } {
    return { ok: true };
  }

  @PerteneceA('entrega', 'id')
  @Get('entregas/:id')
  entrega(): { ok: boolean } {
    return { ok: true };
  }
}

const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

describe('Pertenencia de recursos (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let tokenAdmin = '';
  let tokenProfesor = '';
  let tokenEstudiante = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ControladorPrueba],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('el profesor accede a su propia clase (clase 1 = prof.lopez)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/clases/1')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.ok).toBe(true);
  });

  it('el estudiante NO accede a clases (ni a la existente)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/clases/1')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('el admin pasa siempre (clase de otro profesor: 200)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/clases/1')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(respuesta.status).toBe(200);
  });

  it('un recurso inexistente devuelve el mismo 404 que uno ajeno', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/clases/999')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('sin token, la verificación de pertenencia ni siquiera corre (401)', async () => {
    const respuesta = await httpServer.get(
      '/api/v1/prueba-pertenencia/clases/1',
    );
    expect(respuesta.status).toBe(401);
  });

  it('el estudiante accede a SU inscripción (inscripción 1 = est.perez)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/inscripciones/1')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(respuesta.status).toBe(200);
  });

  it('el estudiante NO accede a la inscripción de otro (inscripción 2 = est.gomez)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/inscripciones/2')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('el profesor accede a las inscripciones de su clase (gestión de inscriptos)', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/inscripciones/1')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(respuesta.status).toBe(200);
  });

  it('el profesor accede a los ítems de su clase; el estudiante no', async () => {
    const profesor = await httpServer
      .get('/api/v1/prueba-pertenencia/items/1')
      .set('Authorization', `Bearer ${tokenProfesor}`);
    expect(profesor.status).toBe(200);

    const estudiante = await httpServer
      .get('/api/v1/prueba-pertenencia/items/1')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(estudiante.status).toBe(404);
  });

  it('entrega inexistente (no hay en el seed) → 404 para cualquier rol', async () => {
    const respuesta = await httpServer
      .get('/api/v1/prueba-pertenencia/entregas/999')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });
});
