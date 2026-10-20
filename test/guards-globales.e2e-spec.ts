import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_NO_AUTENTICADO } from '../src/common/guards/jwt-auth.guard';

const LOGIN_ADMIN = { usuarioOEmail: 'admin', contrasena: 'Admin123!' };
const LOGIN_ESTUDIANTE = {
  usuarioOEmail: 'est.perez',
  contrasena: 'Estudiante123!',
};

describe('Guards globales de JWT y rol (e2e)', () => {
  let prisma: PrismaService;
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let tokenAdmin = '';
  let tokenEstudiante = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    httpServer = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('el healthcheck público de la raíz responde sin token', async () => {
    const respuesta = await httpServer.get('/api/v1/');
    expect(respuesta.status).toBe(200);
    expect(respuesta.text).toBe('Hello World!');
  });

  it('login es público: responde 201 sin token previo', async () => {
    const respuesta = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ADMIN);
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.accessToken).toBeDefined();
    tokenAdmin = respuesta.body.accessToken;

    const sesionEstudiante = await httpServer
      .post('/api/v1/auth/login')
      .send(LOGIN_ESTUDIANTE);
    expect(sesionEstudiante.status).toBe(201);
    tokenEstudiante = sesionEstudiante.body.accessToken;
  });

  it('logout es público: responde 204 sin token', async () => {
    const respuesta = await httpServer.post('/api/v1/auth/logout');
    expect(respuesta.status).toBe(204);
  });

  it('una ruta protegida rechaza con 401 si falta el token', async () => {
    const respuesta = await httpServer.get('/api/v1/auth/perfil');
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('cambiar contrasena rechaza con 401 si falta el token', async () => {
    const respuesta = await httpServer
      .post('/api/v1/auth/cambiar-contrasena')
      .send({
        contrasenaActual: 'Admin123!',
        contrasenaNueva: 'NuevaClave123!',
      });

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('una ruta protegida acepta un token válido de cualquier rol', async () => {
    const admin = await httpServer
      .get('/api/v1/auth/perfil')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(admin.status).toBe(200);
    expect(admin.body.username).toBe('admin');

    const estudiante = await httpServer
      .get('/api/v1/auth/perfil')
      .set('Authorization', `Bearer ${tokenEstudiante}`);
    expect(estudiante.status).toBe(200);
    expect(estudiante.body.username).toBe('est.perez');
  });

  it('bloquea las rutas protegidas si el usuario debe cambiar su contraseña', async () => {
    const config = app.get(ConfigService);
    const jwt = new JwtService({
      secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });

    const tokenCambioPendiente = jwt.sign({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: true,
    });

    const respuesta = await httpServer
      .get('/api/v1/auth/perfil')
      .set('Authorization', `Bearer ${tokenCambioPendiente}`);

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(
      'Debes cambiar tu contraseña inicial antes de continuar.',
    );
  });

  it('rechaza con 401 un token EXPIRADO (caducidad validada en e2e)', async () => {
    const config = app.get(ConfigService);
    const jwt = new JwtService({
      secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
    // Token con el payload real pero firmado con 1 hora de antigüedad:
    // verify() debe rechazarlo por expiración.
    const tokenVencido = jwt.sign(
      {
        id: '1',
        username: 'admin',
        role: 'admin',
        organizacionId: null,
        debeCambiarContrasena: true,
      },
      { expiresIn: -3600 },
    );

    const respuesta = await httpServer
      .get('/api/v1/auth/perfil')
      .set('Authorization', `Bearer ${tokenVencido}`);
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('rechaza con 401 un token firmado con un secreto ajeno', async () => {
    const jwtAjeno = new JwtService({
      secret: 'otro-secreto-que-no-es-el-de-la-app-987654321',
    });
    const tokenAjeno = jwtAjeno.sign({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: true,
    });

    const respuesta = await httpServer
      .get('/api/v1/auth/perfil')
      .set('Authorization', `Bearer ${tokenAjeno}`);
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe(MENSAJE_NO_AUTENTICADO);
  });

  it('cambiar contraseña rechaza con 401 si la contraseña actual es incorrecta', async () => {
    const respuesta = await httpServer
      .post('/api/v1/auth/cambiar-contrasena')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        contrasenaActual: 'ClaveIncorrecta123!',
        contrasenaNueva: 'NuevaClave123!',
      });

    expect(respuesta.status).toBe(401);
  });
  it('cambiar contraseña permite completar el cambio inicial y desbloquea la API', async () => {
    const admin = await prisma.users.findFirst({
      where: { username: 'admin' },
      select: {
        id: true,
        password_hash: true,
        must_change_password: true,
      },
    });

    expect(admin).not.toBeNull();

    if (!admin) {
      throw new Error('No se encontró el administrador de prueba');
    }

    try {
      // Simular que el administrador todavía debe cambiar su contraseña.
      await prisma.users.update({
        where: { id: admin.id },
        data: { must_change_password: true },
      });

      // Iniciar sesión para obtener un token con el cambio pendiente.
      const loginInicial = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: LOGIN_ADMIN.usuarioOEmail,
        contrasena: LOGIN_ADMIN.contrasena,
      });

      expect(loginInicial.status).toBe(201);
      expect(loginInicial.body.accessToken).toBeDefined();

      const tokenInicial = loginInicial.body.accessToken;

      // La API protegida debe estar bloqueada antes del cambio.
      const perfilBloqueado = await httpServer
        .get('/api/v1/auth/perfil')
        .set('Authorization', `Bearer ${tokenInicial}`);

      expect(perfilBloqueado.status).toBe(401);
      expect(perfilBloqueado.body.message).toBe(
        'Debes cambiar tu contraseña inicial antes de continuar.',
      );

      // Cambiar la contraseña usando la contraseña inicial correcta.
      const respuestaCambio = await httpServer
        .post('/api/v1/auth/cambiar-contrasena')
        .set('Authorization', `Bearer ${tokenInicial}`)
        .send({
          contrasenaActual: LOGIN_ADMIN.contrasena,
          contrasenaNueva: 'NuevaClave123!',
        });

      expect(respuestaCambio.status).toBe(204);

      // Comprobar que la base de datos ya no exige el cambio inicial.
      const adminActualizado = await prisma.users.findUnique({
        where: { id: admin.id },
        select: { must_change_password: true },
      });

      expect(adminActualizado?.must_change_password).toBe(false);

      // Comprobar que la contraseña nueva permite iniciar sesión.
      const loginNuevo = await httpServer.post('/api/v1/auth/login').send({
        usuarioOEmail: LOGIN_ADMIN.usuarioOEmail,
        contrasena: 'NuevaClave123!',
      });

      expect(loginNuevo.status).toBe(201);
      expect(loginNuevo.body.accessToken).toBeDefined();

      // El usuario debe poder entrar a la API con la nueva sesión.
      const perfilDesbloqueado = await httpServer
        .get('/api/v1/auth/perfil')
        .set('Authorization', `Bearer ${loginNuevo.body.accessToken}`);

      expect(perfilDesbloqueado.status).toBe(200);
    } finally {
      // Restaurar las credenciales originales para no afectar otras pruebas.
      await prisma.users.update({
        where: { id: admin.id },
        data: {
          password_hash: admin.password_hash,
          must_change_password: admin.must_change_password,
        },
      });
    }
  });
});
