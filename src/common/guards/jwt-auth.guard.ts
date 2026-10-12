import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';

export const MENSAJE_NO_AUTENTICADO = 'No autenticado o sesión expirada.';

type PeticionConUsuario = Request & { user?: UsuarioAutenticado };

/**
 * Guard de JWT de acceso. Verifica el token "Bearer" del encabezado
 * Authorization con el secreto configurado en AuthModule y adjunta el
 * payload decodificado en `request.user` para RolesGuard y los endpoints.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(contexto: ExecutionContext): boolean {
    const request = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    const token = this.extraerToken(request.headers.authorization);

    if (token === null) {
      throw new UnauthorizedException(MENSAJE_NO_AUTENTICADO);
    }

    try {
      request.user = this.jwtService.verify<UsuarioAutenticado>(token);
      return true;
    } catch {
      throw new UnauthorizedException(MENSAJE_NO_AUTENTICADO);
    }
  }

  private extraerToken(
    encabezadoAuthorization: string | undefined,
  ): string | null {
    if (typeof encabezadoAuthorization !== 'string') {
      return null;
    }
    if (!encabezadoAuthorization.startsWith('Bearer ')) {
      return null;
    }
    const token = encabezadoAuthorization.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }
}
