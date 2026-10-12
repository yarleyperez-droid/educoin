import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  AuthThrottlerGuard,
  LIMITE_INTENTOS,
  MENSAJE_ACCESO_DENEGADO,
  THROTTLER_LOGIN,
  VENTANA_RATE_LIMIT_MS,
} from './auth-throttler.guard';

describe('AuthThrottlerGuard', () => {
  it('expone el mensaje de bloqueo en español', () => {
    expect(MENSAJE_ACCESO_DENEGADO).toBe(
      'Se ha denegado el acceso por seguridad.',
    );
  });

  it('lanza 429 con el mensaje y la forma estándar de error del proyecto', async () => {
    const opciones: ThrottlerModuleOptions = [
      {
        name: THROTTLER_LOGIN,
        limit: LIMITE_INTENTOS,
        ttl: VENTANA_RATE_LIMIT_MS,
      },
    ];
    const guard = new AuthThrottlerGuard(
      opciones,
      {} as ThrottlerStorage,
      new Reflector(),
    );
    const lanzar = (
      guard as unknown as {
        throwThrottlingException: () => Promise<void>;
      }
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
    const guard = new AuthThrottlerGuard(
      [],
      {} as ThrottlerStorage,
      new Reflector(),
    );
    expect(guard).toBeInstanceOf(ThrottlerGuard);
  });
});
