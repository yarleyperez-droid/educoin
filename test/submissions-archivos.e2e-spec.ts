import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import {
  MENSAJE_ACTIVIDAD_CERRADA,
  MENSAJE_ENTREGA_PENDIENTE,
  MENSAJE_ENTREGA_YA_ENVIADA,
} from '../src/modules/submissions/submissions.service';
import {
  MENSAJE_ARCHIVO_AJENO,
  MENSAJE_ARCHIVO_DEMASIADO_GRANDE,
  MENSAJE_ARCHIVOS_ADJUNTADOS,
  MENSAJE_MIME_INVALIDO,
  MENSAJE_PREGUNTA_NO_ES_FILE,
  MENSAJE_SIN_ARCHIVOS,
  RUTA_ARCHIVO_REGEX,
} from '../src/modules/submissions/validar-archivo';

/**
 * E2E de la ENTREGA DE ACTIVIDADES CON ARCHIVOS (preguntas file) contra
 * la BD real con los datos del seed: subida multipart → borrador con
 * files en answers → autosave/submit que preservan los archivos →
 * revisión y DESCARGA del profesor.
 *
 * Como el resto de las specs de submissions, cada corrida crea SUS
 * PROPIAS actividades (títulos sellados con Date.now()) para no chocar
 * con uq_submission; las actividades se borran LÓGICAMENTE en afterAll
 * y los ARCHIVOS SUBIDOS de esta corrida se borran FÍSICAMENTE del
 * almacén (higiene de disco: las filas de BD se conservan por diseño,
 * AGENTS.md §6, pero los bytes de las corridas de prueba no se
 * acumulan).
 *
 * Validaciones clave (AGENTS.md §9.6): MIME real por magic bytes (un
 * texto renombrado .pdf NO pasa), tope de tamaño con mensaje en español,
 * nombre interno UUID (el nombre original jamás se persiste) y
 * anti-IDOR (un archivo subido a una actividad no se puede referenciar
 * desde otra).
 */

const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};
const LOGIN_OTRO_ESTUDIANTE = {
  usuarioOEmail: 'est.gomez',
  contrasena: 'Estudiante123!',
};
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

/** Actividad de la corrida: una pregunta file y una test. */
const PREGUNTAS_FILE_TEST = [
  {
    position: 1,
    type: 'file',
    prompt: 'Upload your solution as PDF',
    score: 5,
  },
  {
    position: 2,
    type: 'test',
    prompt: 'Pick the right option',
    score: 5,
    options: [
      { text: 'a', is_correct: false },
      { text: 'b', is_correct: true },
    ],
  },
] as const;

/** Actividad solo-file (para la referenciación ajena entre actividades). */
const PREGUNTA_SOLO_FILE = [
  {
    position: 1,
    type: 'file',
    prompt: 'Upload your solution as PDF',
    score: 5,
  },
] as const;

/** Actividad solo-test (para el 400 de "pregunta no es file"). */
const PREGUNTA_SOLO_TEST = [
  {
    position: 1,
    type: 'test',
    prompt: 'Pick the right option',
    score: 5,
    options: [
      { text: 'a', is_correct: false },
      { text: 'b', is_correct: true },
    ],
  },
] as const;

/**
 * Contenidos de prueba con las firmas REALES de cada tipo: la validación
 * es por magic bytes, así que un contenido mínimo basta.
 */
const PDF = Buffer.from('%PDF-1.4\n%E2E archivos\n%%EOF');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('Entregas con archivos: subida, respuestas y descarga (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let tokenOtroEstudiante = '';
  let tokenAdmin = '';

  /** Actividad principal de la corrida (file + test, publicada). */
  let idActividad = '';
  /** Segunda actividad file de la MISMA clase: para referenciar archivos ajenos. */
  let idActividadAjenaFiles = '';
  /** Actividad publicada con fecha de cierre ya pasada: 422 al subir. */
  let idActividadCerrada = '';
  /** Actividad solo-test: 400 al subir a una pregunta que no es file. */
  let idActividadTest = '';
  /** Actividad en draft (no publicada): 404 para el estudiante. */
  let idActividadDraft = '';
  /** Actividad de una clase donde est.perez NO está inscrito: 404. */
  let idActividadNoInscrito = '';
  let idClaseNoInscrito = '';

  /** Entrega enviada de la actividad principal (capturada en el flujo). */
  let idEntrega = '';
  /** Metadata de los archivos vigentes de la pregunta 1 (tras el reemplazo). */
  let archivosPregunta1: { path: string; mime: string; bytes: number }[] = [];

  const crearActividad = async (
    claseId: string,
    titulo: string,
    preguntas: unknown,
    recompensaMonedas?: number,
  ): Promise<string> => {
    const respuesta = await httpServer
      .post(`/api/v1/classes/${claseId}/activities`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({
        titulo,
        preguntas,
        ...(recompensaMonedas !== undefined ? { recompensaMonedas } : {}),
      });
    expect(respuesta.status).toBe(201);
    return respuesta.body.actividad.id as string;
  };

  const publicarActividad = async (id: string): Promise<void> => {
    const respuesta = await httpServer
      .post(`/api/v1/activities/${id}/publicar`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({});
    expect(respuesta.status).toBe(200);
  };

  /** Subida multipart: campos question_position + archivos en 'archivos'. */
  const subirArchivos = (
    id: string,
    posicion: number | string,
    buffers: Buffer[],
    nombres: string[] = buffers.map((_, indice) => `archivo-${indice}.pdf`),
    token: string = tokenEstudiante,
  ) => {
    const req = httpServer
      .post(`/api/v1/activities/${id}/submissions/archivos`)
      .set('Authorization', `Bearer ${token}`)
      .field('question_position', String(posicion));
    buffers.forEach((buffer, indice) => {
      req.attach('archivos', buffer, nombres[indice]);
    });
    return req;
  };

  /** Descarga autorizada del archivo :indice de la pregunta :posicion. */
  const descargar = (
    id: string,
    entregaId: string,
    posicion: string,
    indice: string,
    token: string,
  ) =>
    httpServer
      .get(
        `/api/v1/activities/${id}/submissions/${entregaId}/archivos/${posicion}/${indice}`,
      )
      .set('Authorization', `Bearer ${token}`);

  /**
   * Descarga con parser BINARIO: para afirmar el contenido byte a byte
   * (el parser por defecto dejaría body vacío para image/jpeg y afines).
   * Solo para las 200 con archivo; los errores JSON usan `descargar`.
   */
  const descargarBinario = (
    id: string,
    entregaId: string,
    posicion: string,
    indice: string,
    token: string,
  ) =>
    descargar(id, entregaId, posicion, indice, token)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  /** Monedas ganadas de la inscripción de est.perez en Mathematics 10A. */
  const monedasGanadas = async (): Promise<number> => {
    const inscripcion = await prisma.enrollments.findFirst({
      where: {
        classes: { name: 'Mathematics 10A' },
        users: { username: 'est.perez' },
      },
      select: { coins_earned: true },
    });
    expect(inscripcion).not.toBeNull();
    return inscripcion!.coins_earned;
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

    const loginProfesor = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_PROFESOR);
    const loginEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ESTUDIANTE);
    const loginOtroEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_OTRO_ESTUDIANTE);
    const loginAdmin = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    // Si un login falla, todo lo demás daría falsos negativos: el
    // status real aquí es el diagnóstico más claro (201 = POST de Nest).
    expect(loginProfesor.status).toBe(201);
    expect(loginEstudiante.status).toBe(201);
    expect(loginOtroEstudiante.status).toBe(201);
    expect(loginAdmin.status).toBe(201);
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;
    tokenOtroEstudiante = loginOtroEstudiante.body.accessToken;
    tokenAdmin = loginAdmin.body.accessToken;

    const sello = Date.now();

    // Actividad principal (clase 1 del seed, donde est.perez está
    // inscrito): pregunta file + pregunta test.
    idActividad = await crearActividad(
      '1',
      `E2E Archivos: solución y test ${sello}`,
      PREGUNTAS_FILE_TEST,
      120,
    );
    await publicarActividad(idActividad);

    // Segunda actividad file en la MISMA clase: su PUT intentará
    // referenciar los archivos de la actividad principal (ajenos).
    idActividadAjenaFiles = await crearActividad(
      '1',
      `E2E Archivos (ajena-files) ${sello}`,
      PREGUNTA_SOLO_FILE,
    );
    await publicarActividad(idActividadAjenaFiles);

    // Actividad cerrada: se publica y luego se le atrasan los
    // timestamps por fixture directo en la BD (closes_at ya pasó, pero
    // respetando ck_activity_dates: closes_at > published_at).
    idActividadCerrada = await crearActividad(
      '1',
      `E2E Archivos (cerrada) ${sello}`,
      PREGUNTA_SOLO_FILE,
    );
    await publicarActividad(idActividadCerrada);
    await prisma.activities.update({
      where: { id: BigInt(idActividadCerrada) },
      data: {
        published_at: new Date(Date.now() - 60_000),
        closes_at: new Date(Date.now() - 1_000),
      },
    });

    idActividadTest = await crearActividad(
      '1',
      `E2E Archivos (solo test) ${sello}`,
      PREGUNTA_SOLO_TEST,
    );
    await publicarActividad(idActividadTest);

    idActividadDraft = await crearActividad(
      '1',
      `E2E Archivos (draft) ${sello}`,
      PREGUNTA_SOLO_FILE,
    );

    // Clase nueva del profesor: est.perez no tiene inscripción en ella.
    const clase = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: `E2E Archivos clase no inscrito ${sello}` });
    expect(clase.status).toBe(201);
    idClaseNoInscrito = clase.body.clase.id as string;
    idActividadNoInscrito = await crearActividad(
      idClaseNoInscrito,
      `E2E Archivos (no inscrito) ${sello}`,
      PREGUNTA_SOLO_FILE,
    );
    await publicarActividad(idActividadNoInscrito);
  });

  afterAll(async () => {
    // Borrado LÓGICO de las actividades de esta corrida (AGENTS.md §6);
    // las entregas quedan como historial de las actividades eliminadas.
    for (const id of [
      idActividad,
      idActividadAjenaFiles,
      idActividadCerrada,
      idActividadTest,
      idActividadDraft,
      idActividadNoInscrito,
    ]) {
      if (id !== '') {
        const respuesta = await httpServer
          .delete(`/api/v1/activities/${id}`)
          .set('Authorization', `Bearer ${tokenProfesor}`);
        expect(respuesta.status).toBe(204);
      }
    }
    if (idClaseNoInscrito !== '') {
      const respuesta = await httpServer
        .patch(`/api/v1/classes/${idClaseNoInscrito}`)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ estado: 'archived' });
      expect(respuesta.status).toBe(200);
    }
    // Higiene de DISCO: los bytes subidos por esta corrida se borran
    // físicamente (las filas de la BD se conservan por diseño).
    if (idActividad !== '') {
      const uploadDir =
        app.get(ConfigService).get<string>('UPLOAD_DIR') ?? '.data/uploads';
      await rm(join(uploadDir, idActividad), {
        recursive: true,
        force: true,
      });
    }
    await app.close();
  });

  describe('acceso a la subida (POST .../submissions/archivos)', () => {
    it('sin token: 401 antes de cualquier verificación', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/submissions/archivos`)
        .field('question_position', '1')
        .attach('archivos', PDF, 'informe.pdf');
      expect(respuesta.status).toBe(401);
    });

    it('teacher y admin: 403 (solo el estudiante sube)', async () => {
      expect(
        (await subirArchivos(idActividad, 1, [PDF], ['a.pdf'], tokenProfesor))
          .status,
      ).toBe(403);
      expect(
        (await subirArchivos(idActividad, 1, [PDF], ['a.pdf'], tokenAdmin))
          .status,
      ).toBe(403);
    });

    it('actividad de una clase en la que NO está inscrito: el 404 estándar', async () => {
      const respuesta = await subirArchivos(
        idActividadNoInscrito,
        1,
        [PDF],
        ['a.pdf'],
      );
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('actividad draft (no publicada): el mismo 404 para el estudiante', async () => {
      const respuesta = await subirArchivos(
        idActividadDraft,
        1,
        [PDF],
        ['a.pdf'],
      );
      expect(respuesta.status).toBe(404);
    });

    it('actividad inexistente: el mismo 404 (anti-enumeración)', async () => {
      const respuesta = await subirArchivos('999999', 1, [PDF], ['a.pdf']);
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('actividad cerrada: 422 sin subir nada', async () => {
      const respuesta = await subirArchivos(
        idActividadCerrada,
        1,
        [PDF],
        ['a.pdf'],
      );
      expect(respuesta.status).toBe(422);
      expect(respuesta.body.message).toBe(MENSAJE_ACTIVIDAD_CERRADA);
    });
  });

  describe('validación de la subida (MIME real, tamaño, pregunta)', () => {
    it('contenido de texto plano: 415 aunque el archivo se llame .pdf', async () => {
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [Buffer.from('no soy un pdf')],
        ['informe.pdf'],
      );
      expect(respuesta.status).toBe(415);
      expect(respuesta.body.message).toBe(MENSAJE_MIME_INVALIDO);
    });

    it('PDF FALSO (bytes de texto renombrados): 415 — se valida el contenido, no la extensión', async () => {
      const falso = Buffer.from('MZ archivo ejecutable renombrado');
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [falso],
        ['tarea.pdf'],
      );
      expect(respuesta.status).toBe(415);
      expect(respuesta.body.message).toBe(MENSAJE_MIME_INVALIDO);
    });

    it('archivo que supera UPLOAD_MAX_BYTES: 413 con el mensaje de la plataforma', async () => {
      const gigante = Buffer.alloc(10_485_761, 0x25); // 10 MB + 1 byte
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [gigante],
        ['grande.pdf'],
      );
      expect(respuesta.status).toBe(413);
      expect(respuesta.body.message).toBe(MENSAJE_ARCHIVO_DEMASIADO_GRANDE);
    });

    it('pregunta que NO es de tipo file: 400', async () => {
      const respuesta = await subirArchivos(
        idActividadTest,
        1,
        [PDF],
        ['informe.pdf'],
      );
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_PREGUNTA_NO_ES_FILE);
    });

    it('posición que no corresponde a ninguna pregunta: 400', async () => {
      const respuesta = await subirArchivos(idActividad, 99, [PDF], ['a.pdf']);
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toMatch(/no corresponde a ninguna/);
    });

    it('sin ningún archivo: 400', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/submissions/archivos`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .field('question_position', '1');
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_SIN_ARCHIVOS);
    });

    it('sin question_position: 400 del DTO', async () => {
      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/submissions/archivos`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .attach('archivos', PDF, 'informe.pdf');
      expect(respuesta.status).toBe(400);
    });

    it('más de 3 archivos en una sola petición: 400', async () => {
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [PDF, PDF, PDF, PDF],
        ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'],
      );
      expect(respuesta.status).toBe(400);
    });
  });

  describe('flujo de la entrega con archivos', () => {
    it('sube un PDF: 201, borrador con files y NOMBRE INTERNO (el original no se guarda)', async () => {
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [PDF],
        ['mi-informe-importante.pdf'],
      );

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ARCHIVOS_ADJUNTADOS);
      expect(respuesta.body.entrega.estado).toBe('in_progress');
      expect(respuesta.body.entrega.puntaje).toBeNull();
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);

      const archivo = respuesta.body.entrega.respuestas[0].files[0] as {
        path: string;
        mime: string;
        bytes: number;
      };
      expect(archivo.mime).toBe('application/pdf');
      expect(archivo.bytes).toBe(PDF.length);
      // Ruta interna: {actividad}/{inscripción}/{uuid}.pdf — nada del
      // nombre original del estudiante.
      expect(RUTA_ARCHIVO_REGEX.test(archivo.path)).toBe(true);
      expect(archivo.path.startsWith(`${idActividad}/`)).toBe(true);
      expect(archivo.path).not.toContain('mi-informe-importante');
    });

    it('GET retoma el borrador con los archivos adjuntos', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.estado).toBe('in_progress');
      expect(respuesta.body.respuestas[0].files).toHaveLength(1);
      expect(respuesta.body.respuestas[0].files[0].mime).toBe(
        'application/pdf',
      );
    });

    it('responde la pregunta test por PUT y una subida posterior CONSERVA esa respuesta (merge)', async () => {
      const put = await httpServer
        .put(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ respuestas: [{ question_position: 2, option: 'b' }] });
      expect(put.status).toBe(200);

      // Subir de nuevo SOLO la pregunta file: la respuesta del test queda.
      const respuesta = await subirArchivos(
        idActividad,
        1,
        [JPG, PNG],
        ['foto.jpg', 'captura.png'],
      );
      expect(respuesta.status).toBe(201);

      const respuestas = respuesta.body.entrega.respuestas as {
        question_position: number;
        files?: unknown[];
      }[];
      expect(respuestas).toHaveLength(2);
      expect(respuestas.find((r) => r.question_position === 2)).toEqual({
        question_position: 2,
        option: 'b',
      });
      // La pregunta file quedó REEMPLAZADA por los dos archivos nuevos
      // (el PDF anterior ya no está referenciado).
      const files = (respuestas.find((r) => r.question_position === 1)?.files ??
        []) as { path: string; mime: string; bytes: number }[];
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.mime)).toEqual(['image/jpeg', 'image/png']);
      archivosPregunta1 = files;
    });

    it('PUT conserva los archivos junto con las demás respuestas (autosave completo)', async () => {
      const respuesta = await httpServer
        .put(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({
          respuestas: [
            { question_position: 1, files: archivosPregunta1 },
            { question_position: 2, option: 'b' },
          ],
        });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.entrega.respuestas).toEqual([
        { question_position: 1, files: archivosPregunta1 },
        { question_position: 2, option: 'b' },
      ]);
    });

    it('PUT que referencia un archivo de OTRA actividad: 400 (anti-IDOR)', async () => {
      const ajeno = archivosPregunta1[0];
      const respuesta = await httpServer
        .put(`/api/v1/activities/${idActividadAjenaFiles}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ respuestas: [{ question_position: 1, files: [ajeno] }] });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_ARCHIVO_AJENO);
    });

    it('POST envía la entrega con los archivos: queda pendiente del profesor, sin monedas', async () => {
      const monedasAntes = await monedasGanadas();

      const respuesta = await httpServer
        .post(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({
          respuestas: [
            { question_position: 1, files: archivosPregunta1 },
            { question_position: 2, option: 'b' },
          ],
        });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_ENTREGA_PENDIENTE);
      expect(respuesta.body.entrega.estado).toBe('submitted');
      expect(respuesta.body.entrega.monedasOtorgadas).toBe(0);
      // La respuesta file viaja SIN veredicto: la califica el profesor.
      expect(respuesta.body.entrega.respuestas[0]).toEqual({
        question_position: 1,
        files: archivosPregunta1,
        is_correct: null,
        score: null,
      });
      expect(await monedasGanadas()).toBe(monedasAntes);
      idEntrega = respuesta.body.entrega.id as string;
      expect(idEntrega).not.toBe('');
    });

    it('subir a una entrega ya enviada: 409', async () => {
      const respuesta = await subirArchivos(idActividad, 1, [PDF], ['a.pdf']);
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_ENTREGA_YA_ENVIADA);
    });

    it('PUT después de enviar: el mismo 409', async () => {
      const respuesta = await httpServer
        .put(`/api/v1/activities/${idActividad}/submissions`)
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send({ respuestas: [] });
      expect(respuesta.status).toBe(409);
    });
  });

  describe('revisión y descarga del profesor', () => {
    it('la vista de revisión muestra los archivos de la entrega', async () => {
      const respuesta = await httpServer
        .get(`/api/v1/activities/${idActividad}/submissions/${idEntrega}`)
        .set('Authorization', `Bearer ${tokenProfesor}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.respuestas[0].files).toEqual(archivosPregunta1);
    });

    it('el profesor dueño descarga cada archivo con su contenido íntegro', async () => {
      const jpg = await descargarBinario(
        idActividad,
        idEntrega,
        '1',
        '0',
        tokenProfesor,
      );
      expect(jpg.status).toBe(200);
      expect(jpg.headers['content-type']).toBe('image/jpeg');
      const nombreInterno = archivosPregunta1[0].path.split('/').pop();
      expect(jpg.headers['content-disposition']).toBe(
        `attachment; filename="${nombreInterno}"`,
      );
      expect(Buffer.isBuffer(jpg.body)).toBe(true);
      expect((jpg.body as Buffer).equals(JPG)).toBe(true);

      const png = await descargarBinario(
        idActividad,
        idEntrega,
        '1',
        '1',
        tokenProfesor,
      );
      expect(png.status).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      expect((png.body as Buffer).equals(PNG)).toBe(true);
    });

    it('el estudiante dueño también descarga su archivo', async () => {
      const respuesta = await descargarBinario(
        idActividad,
        idEntrega,
        '1',
        '0',
        tokenEstudiante,
      );
      expect(respuesta.status).toBe(200);
      expect((respuesta.body as Buffer).equals(JPG)).toBe(true);
    });

    it('otro estudiante (inscrito en la clase, no dueño): el 404 estándar', async () => {
      const respuesta = await descargar(
        idActividad,
        idEntrega,
        '1',
        '0',
        tokenOtroEstudiante,
      );
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('admin: 403 (la descarga es solo del estudiante dueño y del profesor)', async () => {
      const respuesta = await descargar(
        idActividad,
        idEntrega,
        '1',
        '0',
        tokenAdmin,
      );
      expect(respuesta.status).toBe(403);
    });

    it('entrega inexistente: el 404 estándar', async () => {
      const respuesta = await descargar(
        idActividad,
        '999999',
        '1',
        '0',
        tokenProfesor,
      );
      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('posición o índice sin archivo: el mismo 404', async () => {
      expect(
        (await descargar(idActividad, idEntrega, '99', '0', tokenProfesor))
          .status,
      ).toBe(404);
      expect(
        (await descargar(idActividad, idEntrega, '1', '99', tokenProfesor))
          .status,
      ).toBe(404);
      // La pregunta 2 no es file: no tiene archivos que descargar.
      expect(
        (await descargar(idActividad, idEntrega, '2', '0', tokenProfesor))
          .status,
      ).toBe(404);
    });

    it('ids no numéricos en la ruta: el mismo 404 (anti-enumeración)', async () => {
      expect(
        (await descargar(idActividad, 'abc', '1', '0', tokenProfesor)).status,
      ).toBe(404);
      expect(
        (await descargar(idActividad, idEntrega, 'x', '0', tokenProfesor))
          .status,
      ).toBe(404);
      expect(
        (await descargar(idActividad, idEntrega, '1', 'x', tokenProfesor))
          .status,
      ).toBe(404);
    });
  });
});
