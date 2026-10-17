import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

/**
 * Módulo del catálogo de ítems canjeables (H4.1 / PRO-279). Igual que
 * `classes`/`redemptions`/`wallet`: guards globales (AuthModule) y
 * PrismaModule global, así que solo declara controller y service.
 * AutorizacionService (reglas de pertenencia) se inyecta porque
 * AutorizacionModule es `@Global()` y lo exporta.
 */
@Module({
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
