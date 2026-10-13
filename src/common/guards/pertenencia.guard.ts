import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  PERTENECE_A_KEY,
  type ReglaPertenencia,
} from '../decorators/pertenece-a.decorator';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../../modules/autorizacion/autorizacion.service';

type PeticionConUsuario = Request & { user?: UsuarioAutenticado };

/**
 * Guard global de pertenencia de recursos (tercer APP_GUARD, después de
 * JwtAuthGuard y RolesGuard). Actúa solo en las rutas declaradas con
 * @PerteneceA(tipo, parametro): extrae el id del recurso del parámetro de
 * ruta y delega la verificación a AutorizacionService (único dueño de
 * Prisma y de las reglas). Si el recurso no existe o pertenece a otro
 * usuario → 404 con el mensaje estándar; el rol admin pasa siempre.
 */
@Injectable()
export class PertenenciaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly autorizacionService: AutorizacionService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const regla = this.reflector.getAllAndOverride<
      ReglaPertenencia | undefined
    >(PERTENECE_A_KEY, [contexto.getHandler(), contexto.getClass()]);

    // Rutas sin @PerteneceA: el guard no tiene trabajo (costo cero).
    if (regla === undefined) {
      return true;
    }

    const request = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    if (!request.user) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    const recursoId = request.params?.[regla.parametroId];
    if (typeof recursoId !== 'string' || recursoId === '') {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    await this.autorizacionService.verificarPertenencia(
      regla.tipo,
      recursoId,
      request.user,
    );
    return true;
  }
}
