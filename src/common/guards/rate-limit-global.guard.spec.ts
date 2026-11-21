import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { MENSAJE_ACCESO_DENEGADO } from '../../modules/auth/guards/auth-throttler.guard';
import {
  LIMITE_GLOBAL,
  RateLimitGlobalGuard,
  THROTTLER_GLOBAL,
  VENTANA_GLOBAL_MS,
} from './rate-limit-global.guard';

describe('RateLimitGlobalGuard', () => {
  // Mismo patrón de construcción que AuthThrottlerGuard: la inyección de la
  // base recibe (opciones raíz, storage, reflector) y el guard filtra en
  // onModuleInit.
  const crearGuard = () =>
    new RateLimitGlobalGuard(
      [] as ThrottlerModuleOptions,
      {} as ThrottlerStorage,
      new Reflector(),
    );

  it('solo aplica el throttler global `default` (300/min)', async () => {
    const guard = crearGuard();
    await guard.onModuleInit();

    const throttlers = (
      guard as unknown as {
        throttlers: { name: string; limit: number; ttl: number }[];
      }
    ).throttlers;

    expect(throttlers).toHaveLength(1);
    expect(throttlers[0]).toEqual(
      expect.objectContaining({
        name: THROTTLER_GLOBAL,
        limit: LIMITE_GLOBAL,
        ttl: VENTANA_GLOBAL_MS,
      }),
    );
  });

  it('descarta los throttlers de auth de las opciones raíz', async () => {
    const guard = new RateLimitGlobalGuard(
      [
        { name: 'login', limit: 5, ttl: 60_000 },
        { name: 'refresh', limit: 5, ttl: 60_000 },
      ],
      {} as ThrottlerStorage,
      new Reflector(),
    );
    await guard.onModuleInit();

    const nombres = (
      guard as unknown as { throttlers: { name: string }[] }
    ).throttlers.map((t) => t.name);
    expect(nombres).toEqual([THROTTLER_GLOBAL]);
  });

  it('lanza 429 con el mensaje de seguridad en español', async () => {
    const guard = crearGuard();
    const lanzar = (
      guard as unknown as { throwThrottlingException: () => Promise<void> }
    ).throwThrottlingException;

    expect.assertions(3);
    try {
      await lanzar();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const excepcion = error as HttpException;
      expect(excepcion.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(excepcion.getResponse()).toEqual({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: MENSAJE_ACCESO_DENEGADO,
        error: 'Too Many Requests',
      });
    }
  });

  it('hereda de ThrottlerGuard (comportamiento de la librería)', () => {
    expect(crearGuard()).toBeInstanceOf(ThrottlerGuard);
  });
});
