import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Borrado lógico + reactivación sobre la cuenta REAL de Alejandro
 * (username 'alejandro', teacher, correo alejandro@gmail.com; id 49 en
 * la BD de desarrollo, creada en la demo en vivo). Se busca POR
 * USERNAME en vez de amarrar el id físico: si la BD fue re-sembrada y
 * la cuenta no existe, se provisiona con el MISMO endpoint de la API
 * (datos idénticos) y se limpia físicamente en afterAll — la spec es
 * portable para CI y a la vez ejercita la cuenta real cuando existe.
 *
 * La cuenta REAL nunca queda dañada: el test desactiva, verifica y
 * REACTIVA, y afterAll fuerza is_active=true como red de seguridad
 * pase lo que pase en las pruebas.
 *
 * Instancia de app propia → presupuesto propio del rate limit de login
 * (esta spec usa exactamente 1 login: el admin del seed).
 */
describe('Users — Alejandro (borrado lógico de la cuenta real, e2e)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenAdmin = '';
  let idAlejandro = BigInt(0);
  let creadoPorSpec = false;
  let idColegioDemo = BigInt(0);

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
      .send({ usuarioOEmail: 'admin', contrasena: 'Admin123!' });
    expect(loginAdmin.status).toBe(201);
    tokenAdmin = loginAdmin.body.accessToken;

    const colegioDemo = await prisma.organizations.findFirst({
      where: { name: 'Colegio Demo' },
      select: { id: true },
    });
    if (colegioDemo === null) {
      throw new Error(
        "El seed no trae la organización 'Colegio Demo': aplica db/002_seed.sql antes de los e2e.",
      );
    }
    idColegioDemo = colegioDemo.id;

    const alejandro = await prisma.users.findFirst({
      where: { username: 'alejandro' },
      select: { id: true, is_active: true },
    });
    if (alejandro === null) {
      // BD sin la cuenta real (p. ej. re-sembrada para CI): se
      // provisiona con el propio endpoint, datos idénticos a la demo.
      const respuesta = await httpServer
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          rol: 'teacher',
          usuario: 'alejandro',
          correo: 'alejandro@gmail.com',
          nombre: 'Alejandro',
          apellido: 'Prueba',
          organizacionId: idColegioDemo.toString(),
        });
      expect(respuesta.status).toBe(201);
      idAlejandro = BigInt(respuesta.body.usuario.id as string);
      creadoPorSpec = true;
    } else {
      idAlejandro = alejandro.id;
      // Normaliza el punto de partida: la cuenta real debe estar activa
      // antes de probar el borrado (PATCH es idempotente).
      if (!alejandro.is_active) {
        const reactivado = await httpServer
          .patch(`/api/v1/users/${idAlejandro}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ activa: true });
        expect(reactivado.status).toBe(200);
      }
    }
  });

  afterAll(async () => {
    if (!creadoPorSpec) {
      // Red de seguridad para la cuenta REAL: Alejandro termina activo
      // aunque algún test falle a mitad de camino.
      await prisma.users.update({
        where: { id: idAlejandro },
        data: { is_active: true },
        select: { id: true },
      });
    } else {
      // La fixture provisionada no tiene clases ni inscripciones: su
      // limpieza física es segura (la única vía de borrado físico son
      // los tests).
      await prisma.users.delete({ where: { id: idAlejandro } });
    }
    await app.close();
  });

  it('DELETE desactiva a Alejandro sin borrarlo de la BD (y es idempotente)', async () => {
    const primero = await httpServer
      .delete(`/api/v1/users/${idAlejandro}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(primero.status).toBe(204);

    // El registro SIGUE en la BD con is_active=false: sus clases,
    // inscripciones y monedas quedan intactas.
    const fila = await prisma.users.findFirst({
      where: { id: idAlejandro },
      select: { is_active: true, role: true, username: true, email: true },
    });
    expect(fila).not.toBeNull();
    if (fila === null) {
      return;
    }
    expect(fila.is_active).toBe(false);
    expect(fila.role).toBe('teacher');
    expect(fila.username).toBe('alejandro');
    expect(fila.email).toBe('alejandro@gmail.com');

    // Idempotencia: repetir el borrado lógico vuelve a dar 204.
    const segundo = await httpServer
      .delete(`/api/v1/users/${idAlejandro}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(segundo.status).toBe(204);

    // El listado lo refleja: aparece entre activa=false y desaparece
    // de activa=true.
    const inactivos = await httpServer
      .get('/api/v1/users')
      .query({ q: 'alejandro', activa: 'false' })
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(inactivos.body.data.map((u: { id: string }) => u.id)).toContain(
      idAlejandro.toString(),
    );

    const activos = await httpServer
      .get('/api/v1/users')
      .query({ q: 'alejandro', activa: 'true' })
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(activos.body.data.map((u: { id: string }) => u.id)).not.toContain(
      idAlejandro.toString(),
    );
  });

  it('PATCH { activa: true } reactiva la cuenta de Alejandro', async () => {
    const reactivado = await httpServer
      .patch(`/api/v1/users/${idAlejandro}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ activa: true });

    expect(reactivado.status).toBe(200);
    expect(reactivado.body.id).toBe(idAlejandro.toString());
    expect(reactivado.body.usuario).toBe('alejandro');
    expect(reactivado.body.correo).toBe('alejandro@gmail.com');
    expect(reactivado.body.rol).toBe('teacher');
    expect(reactivado.body.activo).toBe(true);

    const fila = await prisma.users.findFirst({
      where: { id: idAlejandro },
      select: { is_active: true },
    });
    expect(fila).not.toBeNull();
    if (fila === null) {
      return;
    }
    expect(fila.is_active).toBe(true);
  });
});
