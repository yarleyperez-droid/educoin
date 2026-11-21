
import { SetMetadata } from '@nestjs/common';

export const PERMITIR_CAMBIO_CONTRASENA_KEY =
  'permitirCambioContrasena';

export const PermitirCambioContrasena = (): MethodDecorator =>
  SetMetadata(PERMITIR_CAMBIO_CONTRASENA_KEY, true);
