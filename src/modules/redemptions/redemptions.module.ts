import { Module } from '@nestjs/common';
import { RedemptionsController } from './redemptions.controller';
import { RedemptionsService } from './redemptions.service';

/**
 * Módulo de canje instantáneo (H4.4 / PRO-282). Igual que `classes`: no
 * importa guards ni PrismaModule porque los guards de JWT/roles son
 * globales (AuthModule) y PrismaModule es global.
 */
@Module({
  controllers: [RedemptionsController],
  providers: [RedemptionsService],
})
export class RedemptionsModule {}
