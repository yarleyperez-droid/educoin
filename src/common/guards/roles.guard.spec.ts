import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard, MENSAJE_SIN_ROL } from './roles.guard';

class ControladorDePrueba {
  @Roles('admin')
  soloAdmin(this: void): void {}

  sinRoles(this: void): void {}
}

interface ContextoMock {
  user?: { role: string };
}

function crearContexto(
  usuario: ContextoMock['user'],
  handler: () => void,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControladorDePrueba,
    switchToHttp: () => ({ getRequest: () => ({ user: usuario }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('permite el acceso cuando el endpoint no declara roles', () => {
    expect(
      guard.canActivate(
        crearContexto(undefined, ControladorDePrueba.prototype.sinRoles),
      ),
    ).toBe(true);
  });

  it('permite el acceso cuando el rol del token está en @Roles(...)', () => {
    const contexto = crearContexto(
      { role: 'admin' },
      ControladorDePrueba.prototype.soloAdmin,
    );
    expect(guard.canActivate(contexto)).toBe(true);
  });

  it('bloquea con 403 cuando el rol no coincide', () => {
    const contexto = crearContexto(
      { role: 'student' },
      ControladorDePrueba.prototype.soloAdmin,
    );
    expect(() => guard.canActivate(contexto)).toThrow(
      new ForbiddenException(MENSAJE_SIN_ROL),
    );
  });

  it('bloquea con 401 si hay roles requeridos pero no hay usuario autenticado', () => {
    const contexto = crearContexto(
      undefined,
      ControladorDePrueba.prototype.soloAdmin,
    );
    expect(() => guard.canActivate(contexto)).toThrow(UnauthorizedException);
  });
});
