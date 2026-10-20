import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_SIN_ROL } from '../src/common/guards/roles.guard';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import {
  MENSAJE_INSCRIPCION_NO_ACTIVA,
  MENSAJE_YA_INSCRIPTO,
  mensajeUnidoAClase,
} from '../src/modules/classes/classes.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Unión a clase por código (H3.2, e2e con BD real y datos del seed):
 * - POST /api/v1/classes/join → 201 con inscripción active (CA 1),
 *   404 amable para código inexistente o clase archivada (CA 2),
 *   409 para inscripción active previa (CA 3) y 422 para
 *   withdrawn/blocked (CA 4) u organización distinta (regla de la BD).
 *
 * Fixtures (patrón classes.e2e-spec.ts): clase propia creada por
 * prof.lopez vía API (para conocer su código real), clase archivada vía
 * API + PATCH, y org + profesor + clase de OTRA organización creados con
 * Prisma en beforeAll y borrados en afterAll. La inscripción de la
 * clase propia nace en estos tests y se borra con ella; los cambios de
 * status (withdrawn/blocked) son directos con Prisma porque no existe
 * endpoint de estados (supuesto 11 de la spec).
 */
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

describe('Unión a clase por código (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenProfesor = '';
  let tokenEstudiante = '';
  const fixture: {
    claseId?: bigint;
    claseCodigo?: string;
    claseNombre?: string;
    estudianteId?: bigint;
    archivadaCodigo?: string;
    orgId?: bigint;
    profesorAjenoId?: bigint;
    claseAjenaId?: bigint;
    claseAjenaCodigo?: string;
  } = {};

  const unir = (body: Record<string, unknown>) =>
    httpServer
      .post('/api/v1/classes/join')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send(body);

  const ubicarInscripcion = () => ({
    class_id: fixture.claseId,
    student_id: fixture.estudianteId,
  });

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
    tokenProfesor = loginProfesor.body.accessToken;
    tokenEstudiante = loginEstudiante.body.accessToken;

    // Clase propia de prof.lopez vía API: el código real lo genera la BD.
    const creada = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: `Clase Unión E2E ${Date.now()}` });
    expect(creada.status).toBe(201);
    fixture.claseId = BigInt(creada.body.clase.id);
    fixture.claseCodigo = creada.body.clase.codigo;
    fixture.claseNombre = creada.body.clase.nombre;

    const estudiante = await prisma.users.findFirst({
      where: { username: 'est.perez' },
    });
    if (estudiante === null) {
      throw new Error('Falta el usuario est.perez en el seed (002_seed.sql)');
    }
    fixture.estudianteId = estudiante.id;

    // Clase ARCHIVADA de prof.lopez: el seed solo trae 'Mathematics 10A'
    // (active) y el caso "archivada → 404" necesita un código real.
    const archivada = await httpServer
      .post('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre: `Clase Archivada Unión E2E ${Date.now()}` });
    expect(archivada.status).toBe(201);
    fixture.archivadaCodigo = archivada.body.clase.codigo;
    const archivadaOk = await httpServer
      .patch(`/api/v1/classes/${archivada.body.clase.id}`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ estado: 'archived' });
    expect(archivadaOk.status).toBe(200);

    // Fixture: clase de OTRA organización (mismo patrón que classes.e2e).
    const unicidad = Date.now();
    const org = await prisma.organizations.create({
      data: { name: `Org Fixture Unión ${unicidad}`, type: 'school' },
    });
    const profesorAjeno = await prisma.users.create({
      data: {
        organization_id: org.id,
        role: 'teacher',
        username: `prof.union.${unicidad}`,
        email: `prof.union.${unicidad}@educoins.test`,
        password_hash: 'SOLO-FIXTURE-NO-LOGUEABLE',
        first_name: 'Fito',
        last_name: 'Fijo',
        must_change_password: false,
      },
    });
    const claseAjena = await prisma.classes.create({
      data: { teacher_id: profesorAjeno.id, name: `OtherOrg Unión ${unicidad}` },
    });
    fixture.orgId = org.id;
    fixture.profesorAjenoId = profesorAjeno.id;
    fixture.claseAjenaId = claseAjena.id;
    fixture.claseAjenaCodigo = claseAjena.code;
  });

  afterAll(async () => {
    // FK primero: inscripciones creadas por los tests → clases → usuario → org.
    if (fixture.claseId !== undefined) {
      await prisma.enrollments.deleteMany({
        where: { class_id: fixture.claseId },
      });
      await prisma.classes.delete({ where: { id: fixture.claseId } });
    }
    if (fixture.claseAjenaId !== undefined) {
      await prisma.enrollments.deleteMany({
        where: { class_id: fixture.claseAjenaId },
      });
      await prisma.classes.delete({ where: { id: fixture.claseAjenaId } });
    }
    if (fixture.profesorAjenoId !== undefined) {
      await prisma.users.delete({ where: { id: fixture.profesorAjenoId } });
    }
    if (fixture.orgId !== undefined) {
      await prisma.organizations.delete({ where: { id: fixture.orgId } });
    }
    await app.close();
  });

  it('CA 1: une con el código en minúsculas y la inscripción queda active', async () => {
    // El DTO normaliza a mayúsculas: la BD genera códigos uppercase.
    const respuesta = await unir({
      codigo: fixture.claseCodigo?.toLowerCase(),
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.mensaje).toBe(
      mensajeUnidoAClase(fixture.claseNombre ?? ''),
    );
    expect(respuesta.body.clase).toEqual({
      id: fixture.claseId?.toString(),
      nombre: fixture.claseNombre,
    });
    expect(respuesta.body.inscripcion.estado).toBe('active');
    expect(respuesta.body.inscripcion.inscritoEn).toEqual(expect.any(String));
    // Sin exponer el código ni campos crudos de la BD.
    expect(respuesta.body.clase).not.toHaveProperty('codigo');
    expect(respuesta.body.clase).not.toHaveProperty('code');
    expect(respuesta.body.clase).not.toHaveProperty('teacher_id');

    // Verificación directa en la BD (CA 1: status active).
    const fila = await prisma.enrollments.findFirst({
      where: ubicarInscripcion(),
    });
    expect(fila?.status).toBe('active');
  });

  it('CA 2: código inexistente → 404 con mensaje amable (no crudo de BD)', async () => {
    const respuesta = await unir({ codigo: 'NOEXISTE9' });

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    // Nunca un detalle crudo de la base de datos.
    expect(JSON.stringify(respuesta.body)).not.toMatch(
      /P2002|P2025|SQL|relation/i,
    );
  });

  it('CA 3: ya inscripto (active) → 409 con mensaje amable', async () => {
    const respuesta = await unir({ codigo: fixture.claseCodigo });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.message).toBe(MENSAJE_YA_INSCRIPTO);
  });

  it('CA 4: inscripción withdrawn → 422 y NO se reactiva', async () => {
    await prisma.enrollments.updateMany({
      where: ubicarInscripcion(),
      data: { status: 'withdrawn' },
    });

    const respuesta = await unir({ codigo: fixture.claseCodigo });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toBe(MENSAJE_INSCRIPCION_NO_ACTIVA);

    const fila = await prisma.enrollments.findFirst({
      where: ubicarInscripcion(),
    });
    expect(fila?.status).toBe('withdrawn');
  });

  it('CA 4: inscripción blocked → 422 sin reactivar', async () => {
    await prisma.enrollments.updateMany({
      where: ubicarInscripcion(),
      data: { status: 'blocked' },
    });

    const respuesta = await unir({ codigo: fixture.claseCodigo });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toBe(MENSAJE_INSCRIPCION_NO_ACTIVA);

    const fila = await prisma.enrollments.findFirst({
      where: ubicarInscripcion(),
    });
    expect(fila?.status).toBe('blocked');
  });

  it('organización distinta → 422 con el mensaje de regla de la BD (trigger)', async () => {
    const respuesta = await unir({ codigo: fixture.claseAjenaCodigo });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.message).toMatch(
      /regla de validación de la base de datos/,
    );
    // El trigger impidió el INSERT: no existe ninguna inscripción.
    const fila = await prisma.enrollments.findFirst({
      where: {
        class_id: fixture.claseAjenaId,
        student_id: fixture.estudianteId,
      },
    });
    expect(fila).toBeNull();
  });

  it('clase archivada → 404 idéntico al inexistente (anti-enumeración)', async () => {
    const respuesta = await unir({ codigo: fixture.archivadaCodigo });

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
  });

  it('el profesor recibe 403 (solo estudiantes se unen)', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes/join')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ codigo: fixture.claseCodigo });

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.message).toBe(MENSAJE_SIN_ROL);
  });

  it('sin token la petición no pasa del guard JWT (401)', async () => {
    const respuesta = await httpServer
      .post('/api/v1/classes/join')
      .send({ codigo: fixture.claseCodigo });

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('body inválido → 400 (sin codigo, vacío, demasiado largo o con campos extra)', async () => {
    const sinCodigo = await unir({});
    expect(sinCodigo.status).toBe(400);

    const vacio = await unir({ codigo: '' });
    expect(vacio.status).toBe(400);

    const largo = await unir({ codigo: 'x'.repeat(13) });
    expect(largo.status).toBe(400);

    // Whitelist global (H6.1): campos no declarados → 400 por rechazo.
    const conExtra = await unir({
      codigo: fixture.claseCodigo,
      rol: 'teacher',
    });
    expect(conExtra.status).toBe(400);
  });
});
