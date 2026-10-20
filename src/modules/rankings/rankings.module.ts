import { Module } from '@nestjs/common';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

/**
 * Módulo de rankings (H4.3 / PRO-281). Igual que `wallet`/`classes`:
 * guards globales (AuthModule) y PrismaModule global, así que solo
 * declara controller y service. AutorizacionService es global
 * (AutorizacionModule) y lo consume el service para el acceso por clase.
 */
@Module({
  controllers: [RankingsController],
  providers: [RankingsService],
})
export class RankingsModule {}
