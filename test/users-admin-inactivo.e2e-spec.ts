import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { hash } from 'argon2';
import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../src/modules/autorizacion/autorizacion.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Defensa en profundidad contra la BD real: un token de admin firmado
 * ANTES de desactivar la cuenta sigue pasando los guards (el JWT no se
 * re-valida contra la BD en cada petición), pero UsersService.crear
 * re-verifica que el admin exista y esté activo antes del INSERT
 * (misma regla que OrganizationsService.crear, AGENTS.md §8).
 *
 * Flujo: se crea un admin fixture DIRECTO en la BD (hash argon2 real,
 * username único, sin organización — permitido solo para admins por
 * ck_users_org), se inicia sesión para obtener un token legítimo, se
 * desactiva la cuenta con un UPDATE y se usa el token YA vencido en
 * cuanto a estado: POST /users responde el 404 estándar.
 *
 * Archivo SEPARADO de users.e2e-spec.ts a propósito: cada spec tiene
 * su propia instancia de la app y por tanto su propio contador del
 * rate limit de login (5/min por IP); la otra spec ya usa 4 de 5.
 */
const CONTRASENA_FIXTURE = 'AdminFixture123!';

describe('Users — admin desactivado con token vigente (e2e, BD real)', () => {
  let app: INestApplication<App>;
  let httpServer: ReturnType<typeof request>;
  let prisma: PrismaService;
  let tokenAdmin = '';
  let idAdmin = BigInt(0);
  let idColegioDemo = BigInt(0);
  const sufijo = `${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    httpServer = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    // Admin fixture directo en la BD (el endpoint no crea admins, y
    // mutar el admin del seed rompería las specs paralelas).
    // must_change_password: false explícito: el DEFAULT es TRUE y desde
    // H2.2 el guard bloquea toda ruta protegida mientras el flag esté en
    // TRUE; aquí se prueba el ciclo "token vigente tras desactivar", no el
    // cambio obligatorio (ese flujo vive en guards-globales.e2e-spec.ts).
    const admin = await prisma.users.create({
      data: {
        organization_id: null,
        role: 'admin',
        username: `admin.e2e.${sufijo}`,
        email: `admin.e2e.${sufijo}@educoins.test`,
        password_hash: await hash(CONTRASENA_FIXTURE),
        first_name: 'Admin',
        last_name: 'Fixture',
        must_change_password: false,
      },
      select: { id: true },
    });
    idAdmin = admin.id;

    const login = await httpServer.post('/api/v1/auth/login').send({
      usuarioOEmail: `admin.e2e.${sufijo}`,
      contrasena: CONTRASENA_FIXTURE,
    });
    expect(login.status).toBe(201);
    tokenAdmin = login.body.accessToken;

    // La organización del seed (solo lectura) sirve para que el body
    // del POST sea válido y el único 404 posible sea el del admin.
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
  });

  afterAll(async () => {
    await prisma.users.delete({ where: { id: idAdmin } });
    await app.close();
  });

  it('POST /users con el token del admin YA desactivado responde el 404 estándar', async () => {
    // El token pasa JwtAuthGuard (firma/validez OK) y RolesGuard (el
    // rol viaja en el payload), pero la re-verificación de la BD en el
    // service corta la operación antes del INSERT.
    await prisma.users.update({
      where: { id: idAdmin },
      data: { is_active: false },
    });

    const respuesta = await httpServer
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rol: 'student',
        usuario: `est.adminoff.${sufijo}`,
        correo: `est.adminoff.${sufijo}@educoins.test`,
        nombre: 'Huerfano',
        apellido: 'Prueba',
        organizacionId: idColegioDemo.toString(),
      });

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe(MENSAJE_RECURSO_NO_ENCONTRADO);
    // El estudiante jamás se creó (la BD no tiene la fila).
    const creado = await prisma.users.findFirst({
      where: { username: `est.adminoff.${sufijo}` },
      select: { id: true },
    });
    expect(creado).toBeNull();
  });

  it('GET /users con el mismo token responde 200 (comportamiento documentado)', async () => {
    // Asimetría deliberada, heredada del patrón de organizations: solo
    // la CREACIÓN re-verifica el estado del admin en la BD; el listado
    // confía en el rol del token. Si el equipo decide endurecerlo,
    // este test deberá cambiar junto al service.
    const respuesta = await httpServer
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.meta).toEqual({
      total: expect.any(Number),
      page: 1,
      limit: 20,
    });
  });
});
