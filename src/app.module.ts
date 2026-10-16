import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
// RateLimitModule ANTES que AuthModule: su APP_GUARD (throttler global)
// debe registrarse antes del JwtAuthGuard para responder 429 sin verificar
// JWT (H6.1 / PRO-292, orden verificado por e2e).
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClassesModule } from './modules/classes/classes.module';
import { ItemsModule } from './modules/items/items.module';
import { RedemptionsModule } from './modules/redemptions/redemptions.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { validarEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarEnv }),
    PrismaModule,
    RateLimitModule,
    AuthModule,
    ClassesModule,
    RedemptionsModule,
    WalletModule,
    ItemsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
