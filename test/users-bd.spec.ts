import { hash } from 'argon2';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Restricciones REALES de la tabla users en PostgreSQL (AGENTS.md §6:
 * la BD es la red de seguridad final). Aquí NO se prueba el endpoint
 * ni el service: se inserta directo con Prisma para comprobar que las
 * reglas viven en la base aunque el backend falle o tenga un bug:
 * - users.email CITEXT UNIQUE → duplicado rechazado incluso con
 *   mayúsculas distintas (CITEXT real del servidor, sin mocks).
 * - users.username CITEXT UNIQUE → ídem.
 * - CHECK ck_users_org → todo teacher/student pertenece a una
 *   organización; solo los admins pueden quedar sin ella.
 *
 * Corre bajo `pnpm test` (misma familia que prisma-smoke.spec.ts).
 * Fixtures propias (organización + usuario con hash argon2 real),
 * usernames únicos por ejecución y limpieza física en afterAll; los
 * datos del seed nunca se tocan.
 */
describe('users — restricciones reales de la BD', () => {
  const prisma = new PrismaService();
  const sufijo = `${Date.now()}`;
  const USERNAME_FIJO = `prof.bd.${sufijo}`;
  const CORREO_FIJO = `prof.bd.${sufijo}@educoins.test`;
  const idsCreados: bigint[] = [];
  let idOrganizacion = BigInt(0);

  beforeAll(async () => {
    // Organización fixture propia: aislada del seed 'Colegio Demo'.
    const organizacion = await prisma.organizations.create({
      data: { name: `Org BD Test ${sufijo}`, type: 'school' },
      select: { id: true },
    });
    idOrganizacion = organizacion.id;

    // Usuario fixture: teacher con hash argon2 real (AGENTS.md §9.3:
    // jamás contraseñas en texto plano, ni siquiera en fixtures).
    const usuario = await prisma.users.create({
      data: {
        organization_id: organizacion.id,
        role: 'teacher',
        username: USERNAME_FIJO,
        email: CORREO_FIJO,
        password_hash: await hash('ContrasenaFixture123!'),
        first_name: 'Fija',
        last_name: 'Prueba',
      },
      select: { id: true },
    });
    idsCreados.push(usuario.id);
  });

  afterAll(async () => {
    for (const id of [...idsCreados].reverse()) {
      await prisma.users.delete({ where: { id } });
    }
    await prisma.organizations.delete({ where: { id: idOrganizacion } });
    await prisma.$disconnect();
  });

  it('rechaza un INSERT con el correo duplicado exacto (P2002 → 409 en la API)', async () => {
    await expect(
      prisma.users.create({
        data: {
          organization_id: idOrganizacion,
          role: 'student',
          username: `est.duplicado.${sufijo}`,
          email: CORREO_FIJO,
          password_hash: 'hash-irrelevante-para-la-restriccion',
          first_name: 'Duplicado',
          last_name: 'Prueba',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza el correo duplicado aunque cambien las mayúsculas (CITEXT real)', async () => {
    await expect(
      prisma.users.create({
        data: {
          organization_id: idOrganizacion,
          role: 'student',
          username: `est.mayusculas.${sufijo}`,
          email: `PROF.BD.${sufijo.toUpperCase()}@EDUCOINS.TEST`,
          password_hash: 'hash-irrelevante-para-la-restriccion',
          first_name: 'Duplicado',
          last_name: 'Prueba',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza el username duplicado aunque cambien las mayúsculas (CITEXT real)', async () => {
    await expect(
      prisma.users.create({
        data: {
          organization_id: idOrganizacion,
          role: 'student',
          username: `PROF.BD.${sufijo.toUpperCase()}`,
          email: `est.username.${sufijo}@educoins.test`,
          password_hash: 'hash-irrelevante-para-la-restriccion',
          first_name: 'Duplicado',
          last_name: 'Prueba',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza un student sin organización (CHECK ck_users_org)', async () => {
    // La regla "teacher/student siempre con organización" vive en la
    // BD: el backend la valida antes para dar un error amigable, pero
    // esta prueba demuestra que la restricción existe de verdad.
    await expect(
      prisma.users.create({
        data: {
          organization_id: null,
          role: 'student',
          username: `est.sinorg.${sufijo}`,
          email: `est.sinorg.${sufijo}@educoins.test`,
          password_hash: 'hash-irrelevante-para-la-restriccion',
          first_name: 'Sin Org',
          last_name: 'Prueba',
        },
      }),
    ).rejects.toThrow(/ck_users_org/i);
  });
});
