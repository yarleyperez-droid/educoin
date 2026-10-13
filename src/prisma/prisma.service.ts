import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        // Prisma + driver adapter no normaliza la zona horaria de la
        // sesión: si el servidor usa una TZ local (p. ej. America/Bogota),
        // escribe y lee TIMESTAMPTZ con desfases de la zona y cualquier
        // fecha escrita por triggers de la BD (updated_at, etc.) llega
        // desplazada. La sesión en UTC es requisito del adapter.
        options: '-c timezone=UTC',
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
