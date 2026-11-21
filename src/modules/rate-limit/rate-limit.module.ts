import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitGlobalGuard } from '../../common/guards/rate-limit-global.guard';
import {
  LIMITE_INTENTOS,
  THROTTLER_LOGIN,
  THROTTLER_REFRESH,
  VENTANA_RATE_LIMIT_MS,
} from '../auth/guards/auth-throttler.guard';

/**
 * Rate limiting transversal (H6.1 / PRO-292).
 *
 * `ThrottlerModule` es `@Global()` y la librería exige **un único**
 * `forRoot` en la raíz: este módulo es su dueño (las opciones de `'login'`
 * y `'refresh'` se movieron desde `auth.module.ts` sin cambiar valores, y
 * `AuthThrottlerGuard` sigue inyectándolas vía `THROTTLER_OPTIONS`).
 *
 * Además registra el `APP_GUARD` del límite global (`'default'`,
 * 300/min por IP). El orden de guards depende del orden de imports en
 * `app.module.ts`: este módulo se importa **antes** que `AuthModule` para
 * que el throttler corra antes de `JwtAuthGuard` (los floods sin token
 * llegan a 429 sin verificar JWT — verificado por e2e).
 */
@Module({
  imports: [
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
  ],
  providers: [
    RateLimitGlobalGuard,
    { provide: APP_GUARD, useClass: RateLimitGlobalGuard },
  ],
})
export class RateLimitModule {}
