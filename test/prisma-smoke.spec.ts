import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (smoke)', () => {
  it('connects and queries the database', async () => {
    const prisma = new PrismaService();
    const [userCount, orgCount] = await Promise.all([
      prisma.users.count(),
      prisma.organizations.count(),
    ]);
    expect(userCount).toBeGreaterThanOrEqual(0);
    expect(orgCount).toBeGreaterThanOrEqual(0);
    console.log(`DB OK: ${userCount} users, ${orgCount} organizations`);
    await prisma.$disconnect();
  });
});
