import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PerteneceA } from '../decorators/pertenece-a.decorator';
import {
  MENSAJE_RECURSO_NO_ENCONTRADO,
  type AutorizacionService,
} from '../../modules/autorizacion/autorizacion.service';
import { PertenenciaGuard } from './pertenencia.guard';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';

const USUARIO: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: true,
};

class ControladorDePrueba {
  @PerteneceA('clase', 'id')
  rutaConPertenencia(this: void): void {}

  rutaSinPertenencia(this: void): void {}
}

interface PeticionMock {
  user?: UsuarioAutenticado;
  params: Record<string, string>;
}

function crearContexto(
  peticion: PeticionMock,
  handler: () => void = ControladorDePrueba.prototype.rutaSinPertenencia,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ControladorDePrueba,
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
}

describe('PertenenciaGuard', () => {
  let guard: PertenenciaGuard;
  let autorizacionService: { verificarPertenencia: ReturnType<typeof jest.fn> };

  beforeEach(() => {
    autorizacionService = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    guard = new PertenenciaGuard(
      new Reflector(),
      autorizacionService as unknown as AutorizacionService,
    );
  });

  it('deja pasar sin costo las rutas sin @PerteneceA', async () => {
    await expect(
      guard.canActivate(crearContexto({ user: USUARIO, params: {} })),
    ).resolves.toBe(true);
    expect(autorizacionService.verificarPertenencia).not.toHaveBeenCalled();
  });

  it('delega en AutorizacionService con el tipo, el id del parámetro y el usuario', async () => {
    await expect(
      guard.canActivate(
        crearContexto(
          { user: USUARIO, params: { id: '5' } },
          ControladorDePrueba.prototype.rutaConPertenencia,
        ),
      ),
    ).resolves.toBe(true);
    expect(autorizacionService.verificarPertenencia).toHaveBeenCalledWith(
      'clase',
      '5',
      USUARIO,
    );
  });

  it('propaga el 404 del service cuando el recurso no pertenece al usuario', async () => {
    autorizacionService.verificarPertenencia.mockImplementation(async () => {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    });

    await expect(
      guard.canActivate(
        crearContexto(
          { user: USUARIO, params: { id: '5' } },
          ControladorDePrueba.prototype.rutaConPertenencia,
        ),
      ),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
  });

  it('rechaza con 401 si no hay usuario autenticado (guard JWT no corrió)', async () => {
    await expect(
      guard.canActivate(
        crearContexto(
          { params: { id: '5' } },
          ControladorDePrueba.prototype.rutaConPertenencia,
        ),
      ),
    ).rejects.toThrow(
      new UnauthorizedException('No autenticado o sesión expirada.'),
    );
  });

  it('responde 404 si el parámetro declarado no llega en la URL', async () => {
    await expect(
      guard.canActivate(
        crearContexto(
          { user: USUARIO, params: {} },
          ControladorDePrueba.prototype.rutaConPertenencia,
        ),
      ),
    ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
  });
});
