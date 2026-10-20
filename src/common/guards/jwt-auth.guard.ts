import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ES_PUBLICO_KEY } from '../decorators/publico.decorator';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado';
import { SesionesActivasService } from '../../modules/auth/sesiones-activas.service';

export const MENSAJE_NO_AUTENTICADO = 'No autenticado o sesión expirada.';

/**
 * 401 para un token firmado con una sesión que ya no existe en el
 * registro (revocada por cambio de credenciales, refresh ya usado o
 * reinicio del servidor). Diferencia el "vuelve a iniciar sesión" del
 * token malformado/vencido (MENSAJE_NO_AUTENTICADO).
 */
export const MENSAJE_SESION_CERRADA =
  'Sesión cerrada por seguridad: inicia sesión de nuevo.';

type PeticionConUsuario = Request & { user?: UsuarioAutenticado };

/**
 * Guard de JWT de acceso, registrado GLOBALMENTE en AuthModule (APP_GUARD).
 * Se aplica a todas las rutas salvo las marcadas con @Publico(). Verifica
 * el token "Bearer" del encabezado Authorization con el secreto configurado
 * en AuthModule — un token vencido (exp) o de firma inválida da 401 — y
 * adjunta el payload decodificado en `request.user` para RolesGuard y los
 * endpoints.
 *
 * Además de la firma, exige que la SESIÓN siga viva en el registro en
 * memoria (SesionesActivasService): el token debe traer su jti y estar
 * registrado. Así, cambiar credenciales (PATCH /users/me), usar dos
 * veces la misma cookie de refresh o reiniciar el servidor matan la
 * sesión al instante con el mismo 401 (fail-closed, AGENTS.md §9).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly sesiones: SesionesActivasService,
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

    try {
      request.user = this.jwtService.verify<UsuarioAutenticado>(token);
    } catch {
      throw new UnauthorizedException(MENSAJE_NO_AUTENTICADO);
    }

    // Falla cerrada: sin jti (token previo a este registro) o con una
    // sesión ya revocada, la petición NO pasa aunque la firma sea válida.
    if (
      typeof request.user.jti !== 'string' ||
      !this.sesiones.esValida(request.user.id, request.user.jti)
    ) {
      throw new UnauthorizedException(MENSAJE_SESION_CERRADA);
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
