import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';

/**
 * E2E del módulo de actividades (flujo del profesor) contra la BD real
 * con los datos del seed (db/002_seed.sql): la clase 1 'Mathematics 10A'
 * es de prof.lopez y la actividad 1 'Challenge 1: Equations' viene
 * publicada en el seed.
 *
 * La spec recorre el ciclo de vida completo sobre una actividad NUEVA
 * que ella misma crea (draft → published → deleted), de modo que los
 * datos del seed solo se leen y las corridas repetidas no chocan (no
 * hay unicidad sobre activities.title; cada corrida agrega su propia
 * fila y la deja eliminada al final, igual que haría el profesor).
 */

const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

/** Preguntas con la MISMA estructura del JSONB de la seed (§7). */
const PREGUNTAS = [
  {
    position: 1,
    type: 'test',
    prompt: 'What is x in 3x + 6 = 15?',
    score: 5,
    options: [
      { text: '1', is_correct: false },
      { text: '3', is_correct: true },
      { text: '5', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Complete: the solution of x - 2 = 4 is x = ___',
    score: 5,
    expected_answer: '6',
  },
] as const;

const CUERPO_CREAR = {
  titulo: 'E2E Challenge: Linear equations',
  descripcion: 'Solve the following linear equations',
  recompensaMonedas: 120,
  preguntas: PREGUNTAS,
};

const CIERRA_EN_FUTURO = new Date(Date.now() + 86_400_000).toISOString();
const CIERRA_EN_PASADO = new Date(Date.now() - 86_400_000).toISOString();

describe('Actividades (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenAdmin = '';
  /** Id (string) de la actividad que crea esta corrida para su flujo. */
  let idActividad = '';

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
    // Si el login falla, todo lo demás daría falsos negativos: fallar
    // aquí con el status real es el diagnóstico más claro. El endpoint
    // de login responde 201 (POST de NestJS), como el resto de la API.
    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);
    expect(loginAdmin.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('acceso y validación', () => {
    it('sin token: 401 antes de cualquier verificación', async () => {
      const respuesta = await httpServer.get('/api/v1/classes/1/activities');
      expect(respuesta.status).toBe(401);
    });

    it('el estudiante no puede crear actividades (403: solo profesores)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send(CUERPO_CREAR);
      expect(respuesta.status).toBe(403);
    });

    it('el admin tampoco crea actividades (403: flujo del profesor)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(CUERPO_CREAR);
      expect(respuesta.status).toBe(403);
    });

    it('400 sin titulo (la BD lo exige NOT NULL)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ preguntas: PREGUNTAS });
      expect(respuesta.status).toBe(400);
    });

    it('400 con preguntas vacías: la actividad nace con su JSONB', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ titulo: 'E2E sin preguntas', preguntas: [] });
      expect(respuesta.status).toBe(400);
    });

    it('400 con una pregunta test sin options (zod)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({
          titulo: 'E2E test roto',
          preguntas: [{ position: 1, type: 'test', prompt: '¿2+2?', score: 5 }],
        });
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toMatch(/options/);
    });

    it('400 si el cuerpo intenta colar el estado: status no se acepta jamás', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ ...CUERPO_CREAR, status: 'published' });
      expect(respuesta.status).toBe(400);
      // ValidationPipe con forbidNonWhitelisted: el mensaje llega como
      // arreglo de strings.
      expect(respuesta.body.message).toContain(
        'property status should not exist',
      );
    });
  });

  describe('ciclo de vida del profesor', () => {
    it('POST crea la actividad como DRAFT con el JSONB de la seed', async () => {
      const respuesta = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send(CUERPO_CREAR);

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toEqual(expect.any(String));
      expect(respuesta.body.actividad).toEqual({
        id: expect.any(String),
        claseId: '1',
        titulo: CUERPO_CREAR.titulo,
        descripcion: CUERPO_CREAR.descripcion,
        recompensaMonedas: 120,
        estado: 'draft',
        preguntas: PREGUNTAS,
        publicadaEn: null,
        cierraEn: null,
        creadoEn: expect.any(String),
        actualizadoEn: expect.any(String),
        eliminadaEn: null,
      });
      idActividad = respuesta.body.actividad.id;
    });

    it('GET detalle devuelve el JSONB completo (vista del dueño)', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('draft');
      expect(respuesta.body.preguntas).toEqual(PREGUNTAS);
      // El profesor dueño SÍ ve las respuestas correctas (AGENTS.md §9.5:
      // el DTO sin correctas es para la futura vista del estudiante).
      expect(respuesta.body.preguntas[0].options[1].is_correct).toBe(true);
      expect(respuesta.body.preguntas[1].expected_answer).toBe('6');
    });

    it('GET lista las actividades de su clase como { data, meta } sin preguntas por fila', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes/1/activities?limit=50')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({
        total: expect.any(Number),
        page: 1,
        limit: 50,
      });
      // La actividad recién creada y la del seed están en la clase 1.
      const ids = respuesta.body.data.map(
        (fila: { id: string }) => fila.id,
      ) as string[];
      expect(ids).toContain(idActividad);
      expect(ids).toContain('1');
      for (const fila of respuesta.body.data) {
        expect(fila).not.toHaveProperty('preguntas');
      }
    });

    it('GET con ?estado=draft solo devuelve borradores', async () => {
      const respuesta = await httpServer
        .get('/api/v1/classes/1/activities?estado=draft&limit=50')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.data.length).toBeGreaterThan(0);
      for (const fila of respuesta.body.data) {
        expect(fila.estado).toBe('draft');
      }
    });

    it('PATCH en borrador actualiza el título', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ titulo: 'E2E Challenge: Linear equations (v2)' });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.titulo).toBe(
        'E2E Challenge: Linear equations (v2)',
      );
      expect(respuesta.body.estado).toBe('draft');
    });

    it('PATCH con preguntas inválidas no toca la BD (400)', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({
          preguntas: [
            {
              position: 1,
              type: 'test',
              prompt: '¿2+2?',
              score: 5,
              options: [
                { text: '4', is_correct: true },
                { text: '5', is_correct: true },
              ],
            },
          ],
        });

      expect(respuesta.status).toBe(400);
    });

    it('publicar con fecha de cierre pasada: 422 sin publicar', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/publicar`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ cierraEn: CIERRA_EN_PASADO });

      expect(respuesta.status).toBe(422);
      expect(respuesta.body.message).toMatch(/cierraEn/i);
    });

    it('POST publicar pasa la actividad a published con publicadaEn', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/publicar`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({});

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('published');
      expect(respuesta.body.publicadaEn).toEqual(expect.any(String));
    });

    it('publicar dos veces: 409', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/publicar`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({});

      expect(respuesta.status).toBe(409);
    });

    it('PATCH del título estando publicada: 409 (solo cierraEn)', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ titulo: 'No debería cambiar' });

      expect(respuesta.status).toBe(409);
    });

    it('PATCH de cierraEn futuro estando publicada: 200', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ cierraEn: CIERRA_EN_FUTURO });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('published');
      expect(respuesta.body.cierraEn).toBe(CIERRA_EN_FUTURO);
    });

    it('PATCH de cierraEn pasado: 422', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ cierraEn: CIERRA_EN_PASADO });

      expect(respuesta.status).toBe(422);
    });

    it('DELETE hace borrado lógico: 204', async () => {
      const respuesta = await httpServer
        .delete(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(204);
    });

    it('PATCH tras eliminar: 404 estándar (para mutaciones ya no existe)', async () => {
      const respuesta = await httpServer
        .patch(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ titulo: 'Tarde' });

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('GET tras eliminar sigue visible para el dueño con estado deleted', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('deleted');
      expect(respuesta.body.eliminadaEn).toEqual(expect.any(String));
    });

    it('DELETE de nuevo: 404', async () => {
      const respuesta = await httpServer
        .delete(`/api/v1/activities/${idActividad}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(404);
    });
  });

  describe('pertenencia y límites', () => {
    it('actividad inexistente: el mismo 404 estándar (anti-enumeración)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/activities/999999')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('la actividad publicada del seed se lee intacta (solo lectura)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/activities/1')
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.titulo).toBe('Challenge 1: Equations');
      expect(respuesta.body.estado).toBe('published');
      expect(respuesta.body.preguntas).toHaveLength(2);
    });
  });

  describe('vista del estudiante (sin respuestas correctas)', () => {
    it('GET detalle de una actividad published de su clase: 200 SIN is_correct ni expected_answer', async () => {
      const respuesta = await httpServer
        .get('/api/v1/activities/1')
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.titulo).toBe('Challenge 1: Equations');
      expect(respuesta.body.recompensaMonedas).toBe(120);
      expect(respuesta.body.publicadaEn).toEqual(expect.any(String));
      // Verificación profunda: ninguna clave sensible en todo el cuerpo
      // (AGENTS.md §9.5: la respuesta correcta NUNCA sale al estudiante).
      expect(JSON.stringify(respuesta.body)).not.toContain('is_correct');
      expect(JSON.stringify(respuesta.body)).not.toContain('expected_answer');
      // test: opciones solo con text (sin el marcador de correcta).
      expect(respuesta.body.preguntas[0].options).toEqual([
        { text: '2' },
        { text: '3' },
        { text: '4' },
      ]);
      // completion: sin expected_answer.
      expect(respuesta.body.preguntas[1]).toEqual({
        position: 2,
        type: 'completion',
        prompt: 'Complete: the solution of x + 1 = 5 is x = ___',
        score: 5,
      });
    });

    it('GET detalle de una actividad draft: 404 (aún no es visible para estudiantes)', async () => {
      // El profesor crea un borrador; el estudiante inscrito NO lo ve.
      const creada = await httpServer
        .post('/api/v1/classes/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send(CUERPO_CREAR);
      expect(creada.status).toBe(201);
      const idDraft = creada.body.actividad.id as string;

      const respuesta = await httpServer
        .get(`/api/v1/activities/${idDraft}`)
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      // Limpieza: el profesor elimina el borrador para no acumular filas
      // de prueba en corridas repetidas.
      const limpieza = await httpServer
        .delete(`/api/v1/activities/${idDraft}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(limpieza.status).toBe(204);
    });

    it('GET listado de las actividades published de SU inscripción: { data, meta } sin preguntas', async () => {
      const respuesta = await httpServer
        .get('/api/v1/enrollments/1/activities?limit=50')
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({
        total: expect.any(Number),
        page: 1,
        limit: 50,
      });
      // La actividad publicada del seed está en la clase de la
      // inscripción 1 (est.perez en Mathematics 10A).
      const ids = respuesta.body.data.map(
        (fila: { id: string }) => fila.id,
      ) as string[];
      expect(ids).toContain('1');
      for (const fila of respuesta.body.data) {
        expect(fila.estado).toBe('published');
        expect(fila).not.toHaveProperty('preguntas');
        expect(JSON.stringify(fila)).not.toContain('is_correct');
      }
    });

    it('inscripción ajena (la de est.gomez): 404 para est.perez', async () => {
      const respuesta = await httpServer
        .get('/api/v1/enrollments/2/activities')
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('el profesor no usa la ruta del estudiante (403) y el detalle del profesor sigue completo (regresión)', async () => {
      const porProfesor = await httpServer
        .get('/api/v1/enrollments/1/activities')
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(porProfesor.status).toBe(403);

      const detalleProfesor = await httpServer
        .get('/api/v1/activities/1')
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(detalleProfesor.status).toBe(200);
      expect(detalleProfesor.body.preguntas[0].options[1].is_correct).toBe(
        true,
      );
      expect(detalleProfesor.body.preguntas[1].expected_answer).toBe('4');
    });

    it('sin token el listado del estudiante tampoco existe (401)', async () => {
      const respuesta = await httpServer.get(
        '/api/v1/enrollments/1/activities',
      );
      expect(respuesta.status).toBe(401);
    });
  });
});
