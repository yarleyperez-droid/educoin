import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO_KEY = 'esPublico';

/**
 * Marca una ruta (o un controlador completo) como exenta de los guards
 * globales de JWT y roles. Úsalo solo en los endpoints que por definición
 * no pueden exigir un access token: login, refresh (se autentica por la
 * cookie), logout (debe funcionar con el token vencido) y el healthcheck
 * público de la raíz.
 */
export const Publico = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ES_PUBLICO_KEY, true);
