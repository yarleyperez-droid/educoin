import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_CREDENCIALES_INVALIDAS } from '../src/modules/auth/auth.service';
import { MENSAJE_ACCESO_DENEGADO } from '../src/modules/auth/guards/auth-throttler.guard';

const CUERPO_LOGIN_FALLIDO = {
  usuarioOEmail: 'admin',
  contrasena: 'Incorrecta123!',
};

const CUERPO_LOGIN_VALIDO = {
  usuarioOEmail: 'admin',
  contrasena: 'Admin123!',
};

describe('Rate limit en /api/v1/auth (e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it('bloquea con 429 tras superar la cuota de logins fallidos', async () => {
    // 5 intentos fallidos dentro de la ventana → todos 401 genérico.
    for (let i = 1; i <= 5; i++) {
      const respuesta = await httpServer
        .post('/api/v1/auth/login')
        .send(CUERPO_LOGIN_FALLIDO)
        .expect(401);
      expect(respuesta.body.message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);
    }

    // 6.º intento → bloqueado por rate limit, sin llegar a validar credenciales.
    const bloqueado = await httpServer
      .post('/api/v1/auth/login')
      .send(CUERPO_LOGIN_FALLIDO);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.message).toBe(MENSAJE_ACCESO_DENEGADO);
  });

  it('incluso la contraseña correcta recibe 429 mientras la IP está bloqueada', async () => {
    for (let i = 0; i < 5; i++) {
      await httpServer
        .post('/api/v1/auth/login')
        .send(CUERPO_LOGIN_FALLIDO)
        .expect(401);
    }

    const respuesta = await httpServer
      .post('/api/v1/auth/login')
      .send(CUERPO_LOGIN_VALIDO);
    expect(respuesta.status).toBe(429);
    expect(respuesta.body.message).toBe(MENSAJE_ACCESO_DENEGADO);
  });

  it('el bloqueo del login no afecta al contador independiente de refresh', async () => {
    for (let i = 0; i < 5; i++) {
      await httpServer
        .post('/api/v1/auth/login')
        .send(CUERPO_LOGIN_FALLIDO)
        .expect(401);
    }
    // Login agotado: el siguiente login sale 429...
    await httpServer
      .post('/api/v1/auth/login')
      .send(CUERPO_LOGIN_FALLIDO)
      .expect(429);

    // ...pero refresh (sin cookie → 401 propio) responde con su propio error,
    // demostrando que su contador está aislado del de login.
    const refresh = await httpServer.post('/api/v1/auth/refresh');
    expect(refresh.status).toBe(401);
    expect(refresh.body.message).toBe('No hay sesión activa que refrescar.');
  });

  it('refresh también se bloquea tras superar su propia cuota', async () => {
    for (let i = 0; i < 5; i++) {
      await httpServer.post('/api/v1/auth/refresh').expect(401);
    }

    const bloqueado = await httpServer.post('/api/v1/auth/refresh');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.message).toBe(MENSAJE_ACCESO_DENEGADO);
  });

  it('las rutas sin throttler (perfil) no se ven afectadas', async () => {
    for (let i = 0; i < 5; i++) {
      await httpServer
        .post('/api/v1/auth/login')
        .send(CUERPO_LOGIN_FALLIDO)
        .expect(401);
    }

    // perfil no consume ni depende de los contadores: responde su 401 normal.
    const respuesta = await httpServer.get('/api/v1/auth/perfil');
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.message).toBe('No autenticado o sesión expirada.');
  });
});
