import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { user_role } from '../../generated/prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';

export const MENSAJE_SIN_ROL =
  'No tienes permisos para acceder a este recurso.';

type PeticionConUsuario = { user?: UsuarioAutenticado };

/**
 * Comprueba el rol del usuario autenticado contra la metadata @Roles(...).
 * Debe colocarse DESPUÉS de JwtAuthGuard en @UseGuards. Si un endpoint no
 * declara roles, solo exige estar autenticado (JwtAuthGuard ya validó el token).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const rolesRequeridos = this.reflector.getAllAndOverride<
      user_role[] | undefined
    >(ROLES_KEY, [contexto.getHandler(), contexto.getClass()]);

    if (rolesRequeridos === undefined || rolesRequeridos.length === 0) {
      return true;
    }

    const request = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    if (!request.user) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }
    if (!rolesRequeridos.includes(request.user.role)) {
      throw new ForbiddenException(MENSAJE_SIN_ROL);
    }
    return true;
  }
}
