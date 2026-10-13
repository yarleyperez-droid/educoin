import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Mensaje requerido cuando el rate limit bloquea la conexión. */
export const MENSAJE_ACCESO_DENEGADO =
  'Se ha denegado el acceso por seguridad.';

/** Nombres de los throttlers nombrados registrados en ThrottlerModule (auth.module.ts). */
export const THROTTLER_LOGIN = 'login';
export const THROTTLER_REFRESH = 'refresh';

/** Cuota de intentos por IP dentro de la ventana (fijo en código, decisión aprobada). */
export const LIMITE_INTENTOS = 5;
export const VENTANA_RATE_LIMIT_MS = 60_000;

/**
 * ThrottlerGuard de /api/v1/auth con mensaje de bloqueo en español.
 * Contadores en memoria por IP (Almacenamiento por defecto de @nestjs/throttler):
 * - 'login'   → POST /auth/login (5 intentos por minuto por IP);
 * - 'refresh' → POST /auth/refresh (idem, contador independiente).
 * Cada ruta salta el contador del otro endpoint con @SkipThrottle.
 * Al superar la cuota se responde 429 con "Se ha denegado el acceso por
 * seguridad." en lugar de la excepción por defecto de la librería.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
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
