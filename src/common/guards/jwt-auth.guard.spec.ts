import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Publico } from '../decorators/publico.decorator';
import { PermitirCambioContrasena } from '../decorators/permitir-cambio-contrasena.decorator';
import { JwtAuthGuard, MENSAJE_NO_AUTENTICADO } from './jwt-auth.guard';

const SECRETO_PRUEBA = 'secreto-de-pruebas-de-jwt-1234567890';

interface PeticionMock {
  headers: { authorization?: string };
  user?: object;
}

class ControladorDePrueba {
  @Publico()
  rutaPublica(this: void): void {}

  rutaProtegida(this: void): void {}

  @PermitirCambioContrasena()
  cambiarContrasena(this: void): void {}
}

function crearContexto(
  peticion: PeticionMock,
  handler: () => void = ControladorDePrueba.prototype.rutaProtegida,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControladorDePrueba,
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let jwtService: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwtService = new JwtService({ secret: SECRETO_PRUEBA });
    guard = new JwtAuthGuard(jwtService, new Reflector());
  });

  it('deja pasar sin token las rutas marcadas con @Publico()', () => {
    const peticion: PeticionMock = { headers: {} };
    expect(
      guard.canActivate(
        crearContexto(peticion, ControladorDePrueba.prototype.rutaPublica),
      ),
    ).toBe(true);
    expect(peticion.user).toBeUndefined();
  });

  it('rechaza con 401 si falta el encabezado Authorization', () => {
    const peticion: PeticionMock = { headers: {} };
    expect(() => guard.canActivate(crearContexto(peticion))).toThrow(
      new UnauthorizedException(MENSAJE_NO_AUTENTICADO),
    );
  });

  it('rechaza con 401 un encabezado que no es Bearer', () => {
    const peticion: PeticionMock = {
      headers: { authorization: 'Basic abc123' },
    };
    expect(() => guard.canActivate(crearContexto(peticion))).toThrow(
      new UnauthorizedException(MENSAJE_NO_AUTENTICADO),
    );
  });

  it('rechaza con 401 un token firmado con otro secreto o corrupto', () => {
    const tokenAjeno = new JwtService({
      secret: 'otro-secreto-totalmente-distinto',
    }).sign({
      id: '1',
    });
    const peticion: PeticionMock = {
      headers: { authorization: `Bearer ${tokenAjeno}` },
    };
    expect(() => guard.canActivate(crearContexto(peticion))).toThrow(
      new UnauthorizedException(MENSAJE_NO_AUTENTICADO),
    );
  });

  it('acepta un token válido y adjunta el payload en request.user', () => {
    const token = jwtService.sign({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: false,
    });
    const peticion: PeticionMock = {
      headers: { authorization: `Bearer ${token}` },
    };

    expect(guard.canActivate(crearContexto(peticion))).toBe(true);
    expect(peticion.user).toEqual({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: false,
      iat: expect.any(Number),
    });
  });
    it('bloquea las rutas protegidas si debe cambiar la contraseña', () => {
    const token = jwtService.sign({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: true,
    });

    const peticion: PeticionMock = {
      headers: { authorization: `Bearer ${token}` },
    };

    expect(() => guard.canActivate(crearContexto(peticion))).toThrow(
      new UnauthorizedException(
        'Debes cambiar tu contraseña inicial antes de continuar.',
      ),
    );
  });

  it('permite cambiar la contraseña si el cambio es obligatorio', () => {
    const token = jwtService.sign({
      id: '1',
      username: 'admin',
      role: 'admin',
      organizacionId: null,
      debeCambiarContrasena: true,
    });

    const peticion: PeticionMock = {
      headers: { authorization: `Bearer ${token}` },
    };

    expect(
      guard.canActivate(
        crearContexto(
          peticion,
          ControladorDePrueba.prototype.cambiarContrasena,
        ),
      ),
    ).toBe(true);
  });
});
