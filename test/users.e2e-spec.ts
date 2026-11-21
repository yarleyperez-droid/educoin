import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';
import { MENSAJE_SIN_ROL } from '../src/common/guards/roles.guard';
import { MENSAJE_CREDENCIALES_INVALIDAS } from '../src/modules/auth/auth.service';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import {
  MENSAJE_ACTUALIZACION_VACIA,
  MENSAJE_CORREO_DUPLICADO,
  MENSAJE_ESPECIALIDAD_SOLO_PROFESOR,
  MENSAJE_USERNAME_DUPLICADO,
  MENSAJE_USUARIO_CREADO,
} from '../src/modules/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Cuentas de usuario (e2e, BD real con datos del seed):
 * - POST /api/v1/users → solo admin; 201 con la contraseña inicial
 *   generada por el servidor (se muestra UNA vez); el usuario nace con
 *   must_change_password TRUE; duplicados de username/correo → 409
 *   (CITEXT: incluso con mayúsculas distintas); la BD guarda el hash
 *   argon2, nunca el texto plano.
 * - GET  /api/v1/users  → listado paginado con filtros (solo admin).
 * - DELETE /api/v1/users/:id → borrado LÓGICO (is_active=false): 204
 *   idempotente; el registro SIGUE en la BD y el login queda bloqueado.
 *   Objetivos válidos: solo teacher/student (espejo del POST).
 * - PATCH  /api/v1/users/:id → reactiva/desactiva con { activa }.
 *
 * El login del profesor creado con su contraseña inicial demuestra el
 * flujo completo: hash → verify → sesión con debeCambiarContrasena
 * true. OJO con el rate limit de login (5/min por IP): esta spec hace
 * exactamente 5 logins (3 en beforeAll, 1 del profesor creado y 1 del
 * usuario desactivado) — el tope exacto. NO agregues más logins aquí.
 *
 * teacher y student reciben 403 en todo el módulo: solo el admin
 * gestiona cuentas (AGENTS.md §5). Los usuarios creados por los tests
 * no tienen clases ni inscripciones, así que la limpieza física en
 * afterAll es segura; los del seed nunca se modifican.
 */
const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_PROFESOR = { usuarioOEmail: 'prof.lopez', contrasena: 'Prof123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

describe('Users (e2e, datos del seed)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenAdmin = '';
  let tokenProfesor = '';
  let tokenEstudiante = '';
  let colegioDemoId = BigInt(0);
  let idAdminSeed = BigInt(0);
  const idsCreados: bigint[] = [];
  let secuencia = 0;

  /** Sufijo único por llamada: Date.now() solo puede repetirse en el mismo ms. */
  const sufijo = (): string => `${Date.now()}${++secuencia}`;

  /** Username único que cumple el patrón del DTO (empieza en letra). */
  const usuarioUnico = (prefijo: string): string => `${prefijo}.${sufijo()}`;

  /** Correo único por llamada. */
  const correoUnico = (prefijo: string): string =>
    `${prefijo}${sufijo()}@educoins.test`;

  /** Crea un usuario como admin y registra el id para el afterAll. */
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

    // La organización del seed es la que recibe las cuentas de prueba;
    // se busca por nombre para no asumir su id.
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

    // El admin del seed (solo lectura) sirve como objetivo PROHIBIDO de
    // DELETE/PATCH: los objetivos válidos son teacher/student.
    const adminSeed = await prisma.users.findFirst({
      where: { username: 'admin' },
      select: { id: true },
    });
    if (adminSeed === null) {
      throw new Error(
        "El seed no trae al usuario 'admin': aplica db/002_seed.sql antes de los e2e.",
      );
    }
    idAdminSeed = adminSeed.id;
  });

  afterAll(async () => {
    // Limpieza física de las fixtures: ninguna tiene clases ni
    // inscripciones, así que el DELETE es seguro (la única vía de
    // borrado físico son los tests, igual que en organizations.e2e).
    for (const id of [...idsCreados].reverse()) {
      await prisma.users.delete({ where: { id } });
    }
    await app.close();
  });

  describe('POST /users (crear, solo admin)', () => {
    it('el admin crea un profesor con especialidad y recibe la contraseña inicial una sola vez', async () => {
      const usuario = usuarioUnico('prof.e2e');
      const correo = correoUnico('prof.e2e');
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'teacher',
          usuario,
          correo,
          nombre: 'Ana',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
          especialidad: 'Mathematics',
        });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.mensaje).toBe(MENSAJE_USUARIO_CREADO);
      // Contraseña generada por el servidor: 16 chars base64url dentro
      // del rango 8–128 que exige el login.
      expect(respuesta.body.contrasenaInicial).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(respuesta.body.usuario).toEqual({
        id: expect.any(String),
        usuario,
        correo,
        rol: 'teacher',
        nombre: 'Ana',
        apellido: 'Prueba',
        especialidad: 'Mathematics',
        organizacionId: colegioDemoId.toString(),
        // El DEFAULT TRUE de la BD: nace obligado a cambiarla.
        debeCambiarContrasena: true,
        activo: true,
        creadoEn: expect.any(String),
      });
      // Nunca salen entidades Prisma crudas (snake_case) ni el hash.
      expect(respuesta.body.usuario).not.toHaveProperty('password_hash');
      expect(respuesta.body.usuario).not.toHaveProperty('username');
      expect(respuesta.body.usuario).not.toHaveProperty('is_active');
      idsCreados.push(BigInt(respuesta.body.usuario.id));
    });

    it('el admin crea un estudiante sin especialidad', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.e2e'),
          correo: correoUnico('est.e2e'),
          nombre: 'Juan',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.usuario.rol).toBe('student');
      expect(respuesta.body.usuario.especialidad).toBeNull();
      expect(respuesta.body.usuario.debeCambiarContrasena).toBe(true);
      idsCreados.push(BigInt(respuesta.body.usuario.id));
    });

    it('la BD guarda el HASH argon2, jamás el texto plano de la contraseña', async () => {
      const creado = await crearUsuario({
        rol: 'teacher',
        usuario: usuarioUnico('prof.hash'),
        correo: correoUnico('prof.hash'),
        nombre: 'Hash',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const fila = await prisma.users.findFirst({
        where: { id: BigInt(creado.id) },
        select: { password_hash: true, must_change_password: true },
      });
      expect(fila).not.toBeNull();
      if (fila === null) {
        return;
      }
      expect(fila.password_hash).not.toBe(creado.contrasenaInicial);
      expect(fila.password_hash).toMatch(/^\$argon2/);
      // El DEFAULT TRUE de must_change_password quedó aplicado.
      expect(fila.must_change_password).toBe(true);
    });

    it('el usuario creado inicia sesión con la contraseña inicial y debe cambiarla', async () => {
      const creado = await crearUsuario({
        rol: 'teacher',
        usuario: usuarioUnico('prof.login'),
        correo: correoUnico('prof.login'),
        nombre: 'Login',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const login = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: creado.usuario,
        contrasena: creado.contrasenaInicial,
      });

      expect(login.status).toBe(201);
      expect(login.body.usuario.debeCambiarContrasena).toBe(true);
      expect(login.body.usuario.role).toBe('teacher');
      expect(login.body.usuario.username).toBe(creado.usuario);
    });

    it('rechaza con 409 un correo duplicado del seed (users.email CITEXT UNIQUE)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'teacher',
          usuario: usuarioUnico('prof.dup'),
          correo: 'lopez@educoins.test',
          nombre: 'Duplicado',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_CORREO_DUPLICADO);
    });

    it('el correo duplicado no distingue mayúsculas (CITEXT)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.dup'),
          correo: 'LOPEZ@EDUCOINS.TEST',
          nombre: 'Duplicado',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_CORREO_DUPLICADO);
    });

    it('rechaza con 409 un username duplicado aunque el correo sea nuevo', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'teacher',
          usuario: 'prof.lopez',
          correo: correoUnico('prof.username.dup'),
          nombre: 'Duplicado',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body.message).toBe(MENSAJE_USERNAME_DUPLICADO);
    });

    it('rechaza con 409 de username cuando usuario Y correo colisionan con la misma cuenta del seed', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'teacher',
          usuario: 'prof.lopez',
          correo: 'lopez@educoins.test',
          nombre: 'Duplicado',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });

      expect(respuesta.status).toBe(409);
      // El pre-check encuentra la MISMA fila con ambos valores: el
      // mensaje del username es el determinístico (primera rama).
      expect(respuesta.body.message).toBe(MENSAJE_USERNAME_DUPLICADO);
    });

    it('rechaza con 404 una organización inexistente (antes que un error de FK)', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.org404'),
          correo: correoUnico('est.org404'),
          nombre: 'Sin Org',
          apellido: 'Prueba',
          organizacionId: '999999999',
        });

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    it('rechaza con 400 bodies inválidos (rol, username, correo, nombres, organización)', async () => {
      const cuerpoBase = {
        usuario: usuarioUnico('valido'),
        correo: correoUnico('valido'),
        nombre: 'Valido',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      };

      const rolAdmin = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...cuerpoBase, rol: 'admin' });
      expect(rolAdmin.status).toBe(400);

      const sinRol = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(cuerpoBase);
      expect(sinRol.status).toBe(400);

      const usernameCorto = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...cuerpoBase, rol: 'student', usuario: 'ab' });
      expect(usernameCorto.status).toBe(400);

      const correoMalo = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...cuerpoBase, rol: 'student', correo: 'no-es-correo' });
      expect(correoMalo.status).toBe(400);

      const nombreConDigitos = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...cuerpoBase, rol: 'student', nombre: 'Ana123' });
      expect(nombreConDigitos.status).toBe(400);

      const orgNoNumerica = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...cuerpoBase, rol: 'student', organizacionId: 'abc' });
      expect(orgNoNumerica.status).toBe(400);
    });

    it('rechaza con 400 la especialidad en una cuenta de estudiante', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.spec'),
          correo: correoUnico('est.spec'),
          nombre: 'Con Especialidad',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
          especialidad: 'Trucos',
        });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_ESPECIALIDAD_SOLO_PROFESOR);
    });

    it('el admin NO puede inyectar must_change_password ni is_active desde el body', async () => {
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.inject'),
          correo: correoUnico('est.inject'),
          nombre: 'Inject',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
          must_change_password: false,
          is_active: false,
          password_hash: 'intentazo',
        });

      expect(respuesta.status).toBe(400);
    });

    it('teacher y student reciben 403 (solo el admin crea cuentas)', async () => {
      const cuerpo = {
        rol: 'student',
        usuario: usuarioUnico('est.prohibido'),
        correo: correoUnico('est.prohibido'),
        nombre: 'Prohibido',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      };

      const profesor = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send(cuerpo);
      expect(profesor.status).toBe(403);
      expect(profesor.body.message).toBe(MENSAJE_SIN_ROL);

      const estudiante = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenEstudiante}`)
        .send(cuerpo);
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);
    });

    it('sin token la creación no pasa del guard JWT (401)', async () => {
      const respuesta = await httpServer.post('/api/v1/users').send({
        rol: 'student',
        usuario: usuarioUnico('est.sintoken'),
        correo: correoUnico('est.sintoken'),
        nombre: 'Sin Token',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      expect(respuesta.status).toBe(401);
      expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });

    it('un token malformado no pasa del guard JWT (401 en POST y GET)', async () => {
      const post = await httpServer
        .post('/api/v1/users')
        .set('Authorization', 'Bearer no-es-un-jwt')
        .send({
          rol: 'student',
          usuario: usuarioUnico('est.tokenmalo'),
          correo: correoUnico('est.tokenmalo'),
          nombre: 'Token Malo',
          apellido: 'Prueba',
          organizacionId: colegioDemoId.toString(),
        });
      expect(post.status).toBe(401);
      expect(post.body.message).toBe(MENSAJE_NO_AUTENTICADO);

      const listado = await httpServer
        .get('/api/v1/users')
        .set('Authorization', 'Bearer no-es-un-jwt');
      expect(listado.status).toBe(401);
      expect(listado.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });

  describe('GET /users (listado paginado, solo admin)', () => {
    it('el admin lista usuarios con { data, meta } y ve los del seed', async () => {
      const respuesta = await httpServer
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.meta).toEqual({
        total: expect.any(Number),
        page: 1,
        limit: 20,
      });
      const usernames = respuesta.body.data.map(
        (u: { usuario: string }) => u.usuario,
      );
      expect(usernames).toContain('prof.lopez');
      expect(usernames).toContain('est.perez');
      // Nunca salen entidades Prisma crudas ni datos sensibles.
      expect(respuesta.body.data[0]).not.toHaveProperty('password_hash');
      expect(respuesta.body.data[0]).not.toHaveProperty('username');
      expect(respuesta.body.data[0]).not.toHaveProperty('is_active');
      expect(respuesta.body.data[0]).not.toHaveProperty('contrasenaInicial');
    });

    it('el listado incluye las cuentas que el admin acaba de crear', async () => {
      const creado = await crearUsuario({
        rol: 'student',
        usuario: usuarioUnico('est.listado'),
        correo: correoUnico('est.listado'),
        nombre: 'Listado',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const respuesta = await httpServer
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      const ids = respuesta.body.data.map((u: { id: string }) => u.id);
      expect(ids).toContain(creado.id);
    });

    it('filtra por rol', async () => {
      const estudiantes = await httpServer
        .get('/api/v1/users')
        .query({ rol: 'student' })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(estudiantes.status).toBe(200);
      const roles = estudiantes.body.data.map((u: { rol: string }) => u.rol);
      expect(roles.length).toBeGreaterThan(0);
      expect(new Set(roles)).toEqual(new Set(['student']));

      const profesores = await httpServer
        .get('/api/v1/users')
        .query({ rol: 'teacher' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const usernamesProfesores = profesores.body.data.map(
        (u: { usuario: string }) => u.usuario,
      );
      expect(usernamesProfesores).toContain('prof.lopez');
    });

    it('filtra por texto en usuario/correo/nombre sin distinguir mayúsculas', async () => {
      const creado = await crearUsuario({
        rol: 'teacher',
        usuario: usuarioUnico('prof.q'),
        correo: correoUnico('prof.q'),
        nombre: 'Buscame',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });
      // El sufijo del username es único por llamada: buscar por él
      // acota el resultado a la cuenta recién creada.
      const sufijoUnico = creado.usuario.split('.')[2] ?? creado.usuario;

      const porUsuario = await httpServer
        .get('/api/v1/users')
        .query({ q: sufijoUnico.toUpperCase() })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(porUsuario.status).toBe(200);
      const ids = porUsuario.body.data.map((u: { id: string }) => u.id);
      expect(ids).toContain(creado.id);

      const porNombre = await httpServer
        .get('/api/v1/users')
        .query({ q: 'buscame' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const idsPorNombre = porNombre.body.data.map((u: { id: string }) => u.id);
      expect(idsPorNombre).toContain(creado.id);
    });

    it('filtra por organización: excluye a los admins globales (organization_id NULL)', async () => {
      const respuesta = await httpServer
        .get('/api/v1/users')
        .query({ organizacionId: colegioDemoId.toString() })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.data.length).toBeGreaterThan(0);
      for (const usuario of respuesta.body.data as {
        organizacionId: string | null;
      }[]) {
        expect(usuario.organizacionId).toBe(colegioDemoId.toString());
      }
    });

    it('valida la paginación y los parámetros de filtro (400 en vez de interpretar)', async () => {
      const pageCero = await httpServer
        .get('/api/v1/users')
        .query({ page: 0 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(pageCero.status).toBe(400);

      const limitGrande = await httpServer
        .get('/api/v1/users')
        .query({ limit: 99 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(limitGrande.status).toBe(400);

      const rolInvalido = await httpServer
        .get('/api/v1/users')
        .query({ rol: 'hacker' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(rolInvalido.status).toBe(400);

      const orgNoNumerica = await httpServer
        .get('/api/v1/users')
        .query({ organizacionId: 'abc' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(orgNoNumerica.status).toBe(400);

      // 'si' no es booleano: el @Transform lo deja intacto y @IsBoolean
      // responde 400 (nunca Boolean('si') → true).
      const activaInvalida = await httpServer
        .get('/api/v1/users')
        .query({ activa: 'si' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(activaInvalida.status).toBe(400);
    });

    it('respeta el limit de la paginación', async () => {
      const respuesta = await httpServer
        .get('/api/v1/users')
        .query({ limit: 2 })
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.data.length).toBeLessThanOrEqual(2);
      expect(respuesta.body.meta.limit).toBe(2);
      expect(respuesta.body.meta.total).toBeGreaterThanOrEqual(4);
    });

    it('limit=50 es válido y limit=51 responde 400 (borde exacto del tope)', async () => {
      const enElTope = await httpServer
        .get('/api/v1/users')
        .query({ limit: 50 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(enElTope.status).toBe(200);
      expect(enElTope.body.meta.limit).toBe(50);

      const fueraDelTope = await httpServer
        .get('/api/v1/users')
        .query({ limit: 51 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(fueraDelTope.status).toBe(400);
    });

    it('una página más allá del total y una búsqueda sin resultados devuelven listados vacíos', async () => {
      const paginaVacia = await httpServer
        .get('/api/v1/users')
        .query({ page: 999 })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(paginaVacia.status).toBe(200);
      expect(paginaVacia.body.data).toEqual([]);
      expect(paginaVacia.body.meta.page).toBe(999);
      expect(typeof paginaVacia.body.meta.total).toBe('number');

      const sinResultados = await httpServer
        .get('/api/v1/users')
        .query({ q: 'no-existe-tal-usuario-xyz' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(sinResultados.status).toBe(200);
      expect(sinResultados.body.data).toEqual([]);
      expect(sinResultados.body.meta.total).toBe(0);
    });

    it('teacher y student reciben 403; sin token 401', async () => {
      const profesor = await httpServer
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(profesor.status).toBe(403);
      expect(profesor.body.message).toBe(MENSAJE_SIN_ROL);

      const estudiante = await httpServer
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(estudiante.status).toBe(403);
      expect(estudiante.body.message).toBe(MENSAJE_SIN_ROL);

      const sinToken = await httpServer.get('/api/v1/users');
      expect(sinToken.status).toBe(401);
      expect(sinToken.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });

  describe('DELETE y PATCH /users/:id (borrado lógico, solo admin)', () => {
    it('desactiva la cuenta sin borrarla de la BD y bloquea su login', async () => {
      const creado = await crearUsuario({
        rol: 'student',
        usuario: usuarioUnico('est.borrado'),
        correo: correoUnico('est.borrado'),
        nombre: 'Borrado',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const borrado = await httpServer
        .delete(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(borrado.status).toBe(204);

      // El registro SIGUE en la BD con is_active=false: borrado
      // lógico, jamás físico (contexto_mvp §2.7).
      const fila = await prisma.users.findFirst({
        where: { id: BigInt(creado.id) },
        select: { is_active: true, role: true, username: true },
      });
      expect(fila).not.toBeNull();
      if (fila === null) {
        return;
      }
      expect(fila.is_active).toBe(false);
      expect(fila.role).toBe('student');
      expect(fila.username).toBe(creado.usuario);

      // 5º y ÚLTIMO login del presupuesto: la cuenta inactiva no entra
      // (AuthService.validarUsuario ya rechaza is_active=false).
      const login = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: creado.usuario,
        contrasena: creado.contrasenaInicial,
      });
      expect(login.status).toBe(401);
      expect(login.body.message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);

      // El listado lo refleja: aparece entre activa=false y desaparece
      // de activa=true.
      const inactivos = await httpServer
        .get('/api/v1/users')
        .query({ q: creado.usuario, activa: 'false' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(inactivos.body.data.map((u: { id: string }) => u.id)).toContain(
        creado.id,
      );

      const activos = await httpServer
        .get('/api/v1/users')
        .query({ q: creado.usuario, activa: 'true' })
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(activos.body.data.map((u: { id: string }) => u.id)).not.toContain(
        creado.id,
      );
    });

    it('es idempotente: un segundo DELETE de la misma cuenta vuelve a dar 204', async () => {
      const creado = await crearUsuario({
        rol: 'student',
        usuario: usuarioUnico('est.idempotente'),
        correo: correoUnico('est.idempotente'),
        nombre: 'Idempotente',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const primero = await httpServer
        .delete(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(primero.status).toBe(204);

      const segundo = await httpServer
        .delete(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(segundo.status).toBe(204);
    });

    it('reactiva con PATCH { activa: true } y la cuenta queda activa en la BD', async () => {
      const creado = await crearUsuario({
        rol: 'teacher',
        usuario: usuarioUnico('prof.reactivado'),
        correo: correoUnico('prof.reactivado'),
        nombre: 'Reactivado',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const borrado = await httpServer
        .delete(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(borrado.status).toBe(204);

      const reactivado = await httpServer
        .patch(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: true });
      expect(reactivado.status).toBe(200);
      expect(reactivado.body.id).toBe(creado.id);
      expect(reactivado.body.usuario).toBe(creado.usuario);
      expect(reactivado.body.activo).toBe(true);

      const fila = await prisma.users.findFirst({
        where: { id: BigInt(creado.id) },
        select: { is_active: true },
      });
      expect(fila).not.toBeNull();
      if (fila === null) {
        return;
      }
      expect(fila.is_active).toBe(true);
    });

    it('un objetivo admin recibe 404 y el admin del seed sigue activo', async () => {
      const borrar = await httpServer
        .delete(`/api/v1/users/${idAdminSeed}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(borrar.status).toBe(404);
      expect(borrar.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const parchar = await httpServer
        .patch(`/api/v1/users/${idAdminSeed}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activa: false });
      expect(parchar.status).toBe(404);
      expect(parchar.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      // El admin del seed jamás fue tocado.
      const fila = await prisma.users.findFirst({
        where: { id: idAdminSeed },
        select: { is_active: true },
      });
      expect(fila).not.toBeNull();
      if (fila === null) {
        return;
      }
      expect(fila.is_active).toBe(true);
    });

    it('inexistente e id no numérico → 404 estándar', async () => {
      const inexistente = await httpServer
        .delete('/api/v1/users/999999999')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(inexistente.status).toBe(404);
      expect(inexistente.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);

      const noNumerico = await httpServer
        .delete('/api/v1/users/abc')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(noNumerico.status).toBe(404);
    });

    it('PATCH con cuerpo vacío → 400', async () => {
      const creado = await crearUsuario({
        rol: 'student',
        usuario: usuarioUnico('est.vacio'),
        correo: correoUnico('est.vacio'),
        nombre: 'Cuerpo Vacio',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });

      const respuesta = await httpServer
        .patch(`/api/v1/users/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toBe(MENSAJE_ACTUALIZACION_VACIA);
    });

    it('teacher y student reciben 403; sin token 401', async () => {
      const creado = await crearUsuario({
        rol: 'student',
        usuario: usuarioUnico('est.prohibido2'),
        correo: correoUnico('est.prohibido2'),
        nombre: 'Prohibido',
        apellido: 'Prueba',
        organizacionId: colegioDemoId.toString(),
      });
      const ruta = `/api/v1/users/${creado.id}`;

      const borradoProfesor = await httpServer
        .delete(ruta)
        .set('Authorization', `Bearer ${tokenProfesor}`);
      expect(borradoProfesor.status).toBe(403);
      expect(borradoProfesor.body.message).toBe(MENSAJE_SIN_ROL);

      const parcheProfesor = await httpServer
        .patch(ruta)
        .set('Authorization', `Bearer ${tokenProfesor}`)
        .send({ activa: true });
      expect(parcheProfesor.status).toBe(403);
      expect(parcheProfesor.body.message).toBe(MENSAJE_SIN_ROL);

      const borradoEstudiante = await httpServer
        .delete(ruta)
        .set('Authorization', `Bearer ${tokenEstudiante}`);
      expect(borradoEstudiante.status).toBe(403);

      const sinToken = await httpServer.delete(ruta);
      expect(sinToken.status).toBe(401);
      expect(sinToken.body.message).toBe(MENSAJE_NO_AUTENTICADO);
    });
  });
});
