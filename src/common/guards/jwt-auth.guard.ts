import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PERMITIR_CAMBIO_CONTRASENA_KEY } from '../decorators/permitir-cambio-contrasena.decorator';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ES_PUBLICO_KEY } from '../decorators/publico.decorator';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';

export const MENSAJE_NO_AUTENTICADO = 'No autenticado o sesión expirada.';

type PeticionConUsuario = Request & { user?: UsuarioAutenticado };

/**
 * Guard de JWT de acceso, registrado GLOBALMENTE en AuthModule (APP_GUARD).
 * Se aplica a todas las rutas salvo las marcadas con @Publico(). Verifica
 * el token "Bearer" del encabezado Authorization con el secreto configurado
 * en AuthModule — un token vencido (exp) o de firma inválida da 401 — y
 * adjunta el payload decodificado en `request.user` para RolesGuard y los
 * endpoints.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(contexto: ExecutionContext): boolean {
    const esPublica = this.reflector.getAllAndOverride<boolean>(
      ES_PUBLICO_KEY,
      [contexto.getHandler(), contexto.getClass()],
    );

    if (esPublica === true) {
      return true;
    }

    const request = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    const token = this.extraerToken(request.headers.authorization);

    if (token === null) {
      throw new UnauthorizedException(MENSAJE_NO_AUTENTICADO);
    }

   let usuario: UsuarioAutenticado;

    try {
      usuario = this.jwtService.verify<UsuarioAutenticado>(token);
    } catch {
      throw new UnauthorizedException(MENSAJE_NO_AUTENTICADO);
    }

    request.user = usuario;

    const puedeCambiarContrasena =
      this.reflector.getAllAndOverride<boolean>(
        PERMITIR_CAMBIO_CONTRASENA_KEY,
        [contexto.getHandler(), contexto.getClass()],
      );

    if (
      usuario.debeCambiarContrasena &&
      puedeCambiarContrasena !== true
    ) {
      throw new UnauthorizedException(
        'Debes cambiar tu contraseña inicial antes de continuar.',
      );
    }
    return true;
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
