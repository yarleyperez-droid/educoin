import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import {
  MENSAJE_NO_AUTENTICADO,
  MENSAJE_SESION_CERRADA,
} from '../src/common/guards/jwt-auth.guard';
import {
  MENSAJE_ACTUALIZACION_PERFIL_VACIA,
  MENSAJE_CONTRASENA_ACTUAL_INCORRECTA,
  MENSAJE_CORREO_ACTUAL_REQUERIDO,
  MENSAJE_CREDENCIALES_ACTUALIZADAS,
  MENSAJE_ESPECIALIDAD_SOLO_PROFESOR,
  MENSAJE_IDENTIFICACION_ERRONEA,
  MENSAJE_PERFIL_ACTUALIZADO,
  MENSAJE_USERNAME_DUPLICADO,
} from '../src/modules/users/users.service';
import {
  MENSAJE_ORGANIZACION_PROHIBIDA,
  MENSAJE_ROL_PROHIBIDO,
} from '../src/modules/users/dto/actualizar-perfil.dto';
import { NOMBRE_COOKIE_REFRESH } from '../src/modules/auth/cookies';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * PATCH /api/v1/users/me (auto-gestión del perfil) — e2e con BD real y
 * datos del seed (AGENTS.md §8):
 * - Campos genéricos (nombre/apellido/especialidad): cualquiera
 *   autenticado edita SU perfil tras confirmar la contraseña actual.
 * - Campos de credenciales (usuario/correo/contrasenaNueva): exigen
 *   identificación completa (correoActual + contrasena) y al aplicarlos
 *   el servidor CIERRA TODAS las sesiones (SesionesActivasService):
 *   el access token viejo da 401, la cookie de refresh vieja da 401 y
 *   el usuario vuelve a entrar con las credenciales nuevas.
 * - rol y organizacionId llegan a 400 con mensaje específico (solo el
 *   admin los gestiona); un campo inexistente (biografia) cae en el
 *   rechazo del ValidationPipe global.
 *
 * Pertenencia estructural: /me no recibe id del cliente — el objetivo
 * sale del JWT (IDOR imposible).
 *
 * OJO con el rate limit de login (5/min por IP): esta spec hace
 * EXACTAMENTE 5 logins — 1) admin, 2) teacher creado, 3) student
 * creado, 4) teacher re-login fresco para cambiar credenciales y 5)
 * teacher re-login con las credenciales NUEVAS. NO agregues más.
 * Los canjes de refresh (2) van por su throttler propio (5/min).
 */
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };

const NUEVA_CONTRASENA = 'NuevaClavePerfil9!';

/** Valor "name=value" de la cookie de refresh de una respuesta. */
function cookieRefresh(respuesta: request.Response): string {
  const galletas = respuesta.headers['set-cookie'];
  const lista = Array.isArray(galletas) ? galletas : [String(galletas)];
  const entrada = lista.find((g: string) =>
    g.startsWith(`${NOMBRE_COOKIE_REFRESH}=`),
  );
  return entrada?.split(';')[0] ?? '';
}

describe('PATCH /users/me (perfil propio, e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenAdmin = '';
  let cookieAdmin = '';
  let tokenTeacher = '';
  let tokenStudent = '';
  let colegioDemoId = BigInt(0);
  const idsCreados: bigint[] = [];
  let secuencia = 0;

  // Fixture del teacher que se edita a sí mismo.
  let teacherId = '';
  let teacherUsuario = '';
  let teacherCorreo = '';
  let teacherContrasena = '';

  // Fixture del student (para el 400 de especialidad).
  let studentContrasena = '';

  /** Sufijo único por llamada (Date.now() puede repetirse en el mismo ms). */
  const sufijo = (): string => `${Date.now()}${++secuencia}`;

  /** Username único que cumple el patrón del DTO (empieza en letra). */
  const usuarioUnico = (prefijo: string): string => `${prefijo}.${sufijo()}`;

  /** Correo único por llamada. */
  const correoUnico = (prefijo: string): string =>
    `${prefijo}.${sufijo()}@educoins.test`;

  /** Crea una cuenta como admin y registra el id para el afterAll. */
  const crearUsuario = async (
    cuerpo: Record<string, unknown>,
  ): Promise<{ id: string; contrasenaInicial: string; usuario: string }> => {
    const respuesta = await httpServer
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(cuerpo);
    expect(respuesta.status).toBe(201);
    const id = respuesta.body.usuario.id as string;
    idsCreados.push(BigInt(id));
    return {
      id,
      contrasenaInicial: respuesta.body.contrasenaInicial as string,
      usuario: respuesta.body.usuario.usuario as string,
    };
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

    // Login 1/5: el admin del seed crea las fixtures.
    const loginAdmin = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    expect(loginAdmin.status).toBe(201);
    tokenAdmin = loginAdmin.body.accessToken;
    cookieAdmin = cookieRefresh(loginAdmin);

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

    // Teacher fixture: es el protagonista del PATCH /me.
    teacherUsuario = usuarioUnico('prof.me');
    teacherCorreo = correoUnico('prof.me');
    const teacher = await crearUsuario({
      rol: 'teacher',
      usuario: teacherUsuario,
      correo: teacherCorreo,
      nombre: 'Perfil',
      apellido: 'Prueba',
      organizacionId: colegioDemoId.toString(),
      especialidad: 'Mathematics',
    });
    teacherId = teacher.id;
    teacherContrasena = teacher.contrasenaInicial;

    // Login 2/5: el teacher entra con la contraseña inicial (nace con
    // must_change_password TRUE, que el cambio de contraseña cerrará).
    const loginTeacher = await httpServer.post('/api/v1/auth/login').send({
      usuarioOEmail: teacherUsuario,
      contrasena: teacherContrasena,
    });
    expect(loginTeacher.status).toBe(201);
    tokenTeacher = loginTeacher.body.accessToken;
    expect(loginTeacher.body.usuario.debeCambiarContrasena).toBe(true);

    // Student fixture: para el 400 de especialidad.
    const student = await crearUsuario({
      rol: 'student',
      usuario: usuarioUnico('est.me'),
      correo: correoUnico('est.me'),
      nombre: 'Estudiante',
      apellido: 'Prueba',
      organizacionId: colegioDemoId.toString(),
    });
    studentContrasena = student.contrasenaInicial;

    // Login 3/5: el student entra.
    const loginStudent = await httpServer.post('/api/v1/auth/login').send({
      usuarioOEmail: student.usuario,
      contrasena: student.contrasenaInicial,
    });
    expect(loginStudent.status).toBe(201);
    tokenStudent = loginStudent.body.accessToken;
  });

  afterAll(async () => {
    // Limpieza física de las fixtures: ninguna tiene clases ni
    // inscripciones, así que el DELETE es seguro (patrón de users.e2e).
    for (const id of [...idsCreados].reverse()) {
      await prisma.users.delete({ where: { id } });
    }
    await app.close();
  });

  describe('campos genéricos', () => {
    it('actualiza nombre/apellido/especialidad con la contraseña actual y la sesión sigue viva', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          contrasena: teacherContrasena,
          nombre: 'Nuevo',
          apellido: 'Apellido',
          especialidad: 'Biology',
        });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_PERFIL_ACTUALIZADO);
      expect(respuesta.body.sesionCerrada).toBe(false);
      expect(respuesta.body.usuario).toEqual({
        id: teacherId,
        usuario: teacherUsuario,
        correo: teacherCorreo,
        rol: 'teacher',
        nombre: 'Nuevo',
        apellido: 'Apellido',
        especialidad: 'Biology',
        organizacionId: colegioDemoId.toString(),
        debeCambiarContrasena: true,
        activo: true,
        creadoEn: expect.any(String),
      });
      // Nunca salen entidades Prisma crudas ni el hash.
      expect(respuesta.body.usuario).not.toHaveProperty('password_hash');
      expect(respuesta.body.usuario).not.toHaveProperty('username');

      // La sesión SIGUE viva: el mismo token ve el perfil nuevo.
      const perfil = await httpServer
        .get('/api/v1/auth/perfil')
        .set('Authorization', `Bearer ${tokenTeacher}`);
      expect(perfil.status).toBe(200);
      expect(perfil.body.nombre).toBe('Nuevo');
    });

    it('la contraseña incorrecta → 403 y nada cambia', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ contrasena: 'IncorrectaTotal9!', nombre: 'Hackeado' });

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_CONTRASENA_ACTUAL_INCORRECTA);

      const fila = await prisma.users.findFirst({
        where: { id: BigInt(teacherId) },
        select: { first_name: true },
      });
      expect(fila?.first_name).toBe('Nuevo');
    });

    it('un estudiante no puede asignarse especialidad → 400', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenStudent}`)
        .send({ contrasena: studentContrasena, especialidad: 'Trucos' });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_ESPECIALIDAD_SOLO_PROFESOR);
    });

    it('cuerpo sin campos editables → 400', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ contrasena: teacherContrasena });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_ACTUALIZACION_PERFIL_VACIA);
    });
  });

  describe('estructura de la petición (rol y organización intocables)', () => {
    it('enviar rol → 400 con el mensaje específico del admin', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ contrasena: teacherContrasena, nombre: 'X', rol: 'admin' });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toContain(MENSAJE_ROL_PROHIBIDO);
    });

    it('enviar organizacionId → 400 con el mensaje específico del admin', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          contrasena: teacherContrasena,
          nombre: 'X',
          organizacionId: '1',
        });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toContain(MENSAJE_ORGANIZACION_PROHIBIDA);
    });

    it('un campo inexistente (biografia) → 400 del whitelist del ValidationPipe', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          contrasena: teacherContrasena,
          nombre: 'X',
          biografia: 'hola',
        });

      expect(respuesta.status).toBe(400);
      expect(JSON.stringify(respuesta.body.message)).toContain('biografia');
    });

    it('sin token → 401 del guard JWT', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .send({ contrasena: teacherContrasena, nombre: 'X' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });

    it('token malformado → 401 del guard JWT', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', 'Bearer no-es-un-jwt')
        .send({ contrasena: teacherContrasena, nombre: 'X' });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });

    it('nombre inválido (dígitos) → 400 de validación', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ contrasena: teacherContrasena, nombre: 'Ana123' });

      expect(respuesta.status).toBe(400);
    });
  });

  describe('cambio de credenciales (identificación completa + token fresco)', () => {
    it('username duplicado del seed → 409', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          contrasena: teacherContrasena,
          correoActual: teacherCorreo,
          usuario: 'prof.lopez',
        });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_USERNAME_DUPLICADO);
    });

    it('credencial sin correoActual → 400', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({ contrasena: teacherContrasena, contrasenaNueva: 'Otra1234!' });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_CORREO_ACTUAL_REQUERIDO);
    });

    it('correoActual que no coincide → 403 con mensaje único', async () => {
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenTeacher}`)
        .send({
          contrasena: teacherContrasena,
          correoActual: 'ajeno@educoins.test',
          contrasenaNueva: 'Otra1234!',
        });

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.message).toBe(MENSAJE_IDENTIFICACION_ERRONEA);
    });

    it('flujo completo: token fresco + identificación → 200, sesión CERRADA y re-login con credenciales nuevas', async () => {
      // Login 4/5: el teacher vuelve a entrar AHORA — el cambio de
      // credenciales exige un token reciente (iat ≤ 5 min).
      const loginFresco = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: teacherUsuario,
        contrasena: teacherContrasena,
      });
      expect(loginFresco.status).toBe(201);
      const tokenFresco = loginFresco.body.accessToken;
      const cookieFresca = cookieRefresh(loginFresco);

      const usuarioNuevo = usuarioUnico('prof.me.nuevo');
      const respuesta = await httpServer
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenFresco}`)
        .send({
          contrasena: teacherContrasena,
          correoActual: teacherCorreo,
          usuario: usuarioNuevo,
          contrasenaNueva: NUEVA_CONTRASENA,
        });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.mensaje).toBe(MENSAJE_CREDENCIALES_ACTUALIZADAS);
      expect(respuesta.body.sesionCerrada).toBe(true);
      expect(respuesta.body.usuario.usuario).toBe(usuarioNuevo);
      // El cambio de contraseña cerró el ciclo del primer inicio.
      expect(respuesta.body.usuario.debeCambiarContrasena).toBe(false);

      // La respuesta expira también la cookie del refresh.
      const galletas = String(respuesta.headers['set-cookie'] ?? '');
      expect(galletas).toContain('Max-Age=0');

      // La BD guarda el hash nuevo, jamás texto plano.
      const fila = await prisma.users.findFirst({
        where: { id: BigInt(teacherId) },
        select: { must_change_password: true, password_hash: true },
      });
      expect(fila?.must_change_password).toBe(false);
      expect(fila?.password_hash).toMatch(/^\$argon2/);
      expect(fila?.password_hash).not.toBe(NUEVA_CONTRASENA);

      // La sesión vieja murió EN EL SERVIDOR: access token → 401 con el
      // mensaje de sesión cerrada (ya no basta con tener firma válida).
      const perfilViejo = await httpServer
        .get('/api/v1/auth/perfil')
        .set('Authorization', `Bearer ${tokenFresco}`);
      expect(perfilViejo.status).toBe(401);
      expect(perfilViejo.body.message).toBe(MENSAJE_SESION_CERRADA);

      // Y la cookie de refresh vieja tampoco puede canjear sesión.
      const refrescoViejo = await httpServer
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieFresca);
      expect(refrescoViejo.status).toBe(401);
      expect(refrescoViejo.body.message).toBe(MENSAJE_SESION_CERRADA);

      // Login 5/5: el teacher vuelve a entrar con las credenciales NUEVAS.
      const loginNuevo = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: usuarioNuevo,
        contrasena: NUEVA_CONTRASENA,
      });
      expect(loginNuevo.status).toBe(201);
      expect(loginNuevo.body.usuario.debeCambiarContrasena).toBe(false);

      const perfilNuevo = await httpServer
        .get('/api/v1/auth/perfil')
        .set('Authorization', `Bearer ${loginNuevo.body.accessToken}`);
      expect(perfilNuevo.status).toBe(200);
      expect(perfilNuevo.body.username).toBe(usuarioNuevo);
    });
  });

  describe('logout (revocación real del refresh)', () => {
    it('el logout consume la cookie: el refresh posterior da 401', async () => {
      const logout = await httpServer
        .post('/api/v1/auth/logout')
        .set('Cookie', cookieAdmin);
      expect(logout.status).toBe(204);

      const refresco = await httpServer
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieAdmin);
      expect(refresco.status).toBe(401);
      expect(refresco.body.message).toBe(MENSAJE_SESION_CERRADA);
    });
  });
});
