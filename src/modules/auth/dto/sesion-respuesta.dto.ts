import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { user_role } from '../../../generated/prisma/client';

/**
 * Datos del usuario que SALEN hacia el cliente. Nunca incluye
 * password_hash ni last_login (AGENTS.md §8).
 *
 * @ApiSchema lo renombra en el spec: existe otro UsuarioRespuestaDto en
 * el módulo users (con más campos) y Swagger nombra los esquemas por
 * clase — sin este alias habría colisión.
 */
@ApiSchema({ name: 'SesionUsuarioDto' })
export class UsuarioRespuestaDto {
  id!: string;
  username!: string;
  email!: string;

  /** El plugin CLI no infiere los enums-objeto de Prisma: explícito. */
  @ApiProperty({
    enum: user_role,
    description: 'Rol de la cuenta: admin, teacher o student.',
  })
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

  /** Literal fijo de la API: siempre 'Bearer'. */
  @ApiProperty({
    enum: ['Bearer'],
    description:
      'Tipo del access token (fijo): enviarlo como "Authorization: Bearer <token>".',
    example: 'Bearer',
  })
  tipoToken!: 'Bearer';

  @ApiProperty({
    example: '2026-10-20T12:00:00.000Z',
    description: 'Momento ISO 8601 en que el access token expira.',
  })
  expiraEn!: string;

  usuario!: UsuarioRespuestaDto;
}
