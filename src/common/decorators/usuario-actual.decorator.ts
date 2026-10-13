import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Devuelve el usuario autenticado adjunto a la petición:
 * - tras el login: el usuario validado por LocalStrategy (UsuarioRespuestaDto);
 * - en rutas protegidas: el payload decodificado del JWT (UsuarioAutenticado).
 * El tipo concreto se anota en cada punto de uso.
 */
export const UsuarioActual = createParamDecorator(
  (_data: unknown, contexto: ExecutionContext): unknown => {
    const request = contexto.switchToHttp().getRequest<{ user?: unknown }>();
    return request.user;
  },
);
