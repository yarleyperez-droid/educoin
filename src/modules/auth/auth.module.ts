import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PertenenciaGuard } from '../../common/guards/pertenencia.guard';
import { AutorizacionModule } from '../autorizacion/autorizacion.module';
import { expiracionASegundos } from './cookies';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AuthThrottlerGuard,
  LIMITE_INTENTOS,
  THROTTLER_LOGIN,
  THROTTLER_REFRESH,
  VENTANA_RATE_LIMIT_MS,
} from './guards/auth-throttler.guard';
import { LocalStrategy } from './strategies/local.strategy';

/**
 * Módulo de autenticación y autorización. Registra el JwtModule con el
 * secreto de ACCESS (los refresh firman con su secreto propio dentro de
 * AuthService) y exporta los guards para que el resto de módulos puedan
 * proteger sus endpoints con @UseGuards(JwtAuthGuard, RolesGuard).
 *
 * Rate limiting (anti-automatización): ThrottlerModule con dos throttlers
 * nombrados por IP — 'login' y 'refresh' — de 5 intentos por minuto cada
 * uno, con contadores independientes y almacenamiento en memoria.
 */
@Module({
  imports: [
    AutorizacionModule,
    ThrottlerModule.forRoot([
      {
        name: THROTTLER_LOGIN,
        limit: LIMITE_INTENTOS,
        ttl: VENTANA_RATE_LIMIT_MS,
      },
      {
        name: THROTTLER_REFRESH,
        limit: LIMITE_INTENTOS,
        ttl: VENTANA_RATE_LIMIT_MS,
      },
    ]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: expiracionASegundos(
            configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtAuthGuard,
    RolesGuard,
    PertenenciaGuard,
    AuthThrottlerGuard,
    // Guards GLOBALES: toda la API exige un access token válido (incluida
    // su caducidad), respeta @Roles(...) por defecto y verifica la
    // pertenencia de los recursos declarados con @PerteneceA(...). Las
    // únicas rutas exentas son las marcadas con @Publico() (login, refresh,
    // logout y el healthcheck de la raíz). El orden es determinante:
    // 1º JwtAuthGuard autentica y adjunta request.user; 2º RolesGuard
    // compara el rol contra @Roles(...); 3º PertenenciaGuard delega en
    // AutorizacionService la pertenencia del recurso de la ruta.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PertenenciaGuard },
  ],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
