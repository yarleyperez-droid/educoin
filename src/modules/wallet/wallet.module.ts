import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Módulo de la billetera del estudiante (H4.2 / PRO-280). Igual que
 * `classes`/`redemptions`: guards globales (AuthModule) y PrismaModule
 * global, así que solo declara controller y service.
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
