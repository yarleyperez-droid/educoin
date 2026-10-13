import type { user_role } from '../../../generated/prisma/client';

/**
 * Datos del usuario que SALEN hacia el cliente. Nunca incluye
 * password_hash ni last_login (AGENTS.md §8).
 */
export class UsuarioRespuestaDto {
  id!: string;
  username!: string;
  email!: string;
  role!: user_role;
  nombre!: string;
  apellido!: string;
  organizacionId!: string | null;
  debeCambiarContrasena!: boolean;
}

/**
 * Respuesta del login y del refresh. El refresh token NUNCA va en el cuerpo:
 * viaja en una cookie httpOnly que gestiona el controller.
 */
export class SesionRespuestaDto {
  accessToken!: string;
  tipoToken!: 'Bearer';
  expiraEn!: string;
  usuario!: UsuarioRespuestaDto;
}
