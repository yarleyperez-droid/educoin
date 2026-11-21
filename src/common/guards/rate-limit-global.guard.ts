import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { MENSAJE_ACCESO_DENEGADO } from '../../modules/auth/guards/auth-throttler.guard';

/** Nombre del throttler global: el único que hace cumplir este guard. */
export const THROTTLER_GLOBAL = 'default';

/** Peticiones máximas por IP dentro de la ventana (decisión fija en código). */
export const LIMITE_GLOBAL = 300;

/** Ventana del rate limit global (1 minuto). */
export const VENTANA_GLOBAL_MS = 60_000;

/**
 * Rate limiting global (H6.1 / PRO-292, T6.1.3 · CA 4).
 *
 * ThrottlerGuard que solo aplica el throttler `'default'` (300 peticiones
 * por minuto por IP). Ignora las opciones raíz (`'login'`/`'refresh'`,
 * reservadas a `AuthThrottlerGuard`) para que ningún contador se incremente
 * dos veces, y responde 429 con el mismo mensaje en español que el rate
 * limit de auth.
 *
 * Se registra como `APP_GUARD` en `RateLimitModule` — importado antes que
 * `AuthModule` — para que las peticiones bloqueadas respondan 429 **antes**
 * de verificar JWT o tocar la BD.
 *
 * Nota de DI: **sin constructor propio**. Un constructor explícito haría que
 * Nest resolviera los argumentos con los tokens `self:paramtypes` de la
 * clase base (`class X extends Y` encadena el prototipo del constructor) e
 * inyectara el storage donde va el `Reflector`. La base recibe la
 * inyección correcta (opciones raíz + storage + reflector) y este guard
 * sustituye `this.options` en `onModuleInit` **antes** de que la base
 * popular `this.throttlers`.
 */
@Injectable()
export class RateLimitGlobalGuard extends ThrottlerGuard {
  async onModuleInit(): Promise<void> {
    (this as unknown as { options: ThrottlerModuleOptions }).options = {
      throttlers: [
        {
          name: THROTTLER_GLOBAL,
          limit: LIMITE_GLOBAL,
          ttl: VENTANA_GLOBAL_MS,
        },
      ],
    };
    await super.onModuleInit();
  }

  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: MENSAJE_ACCESO_DENEGADO,
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
