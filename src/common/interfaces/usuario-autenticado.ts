import type { user_role } from '../../generated/prisma/client';

/**
 * Usuario autenticado tal como vive en el payload del JWT de acceso y en
 * `request.user` después de pasar por JwtAuthGuard. Los IDs viajan como
 * string porque BigInt no se serializa a JSON.
 *
 * jti e iat los añade jwt al firmar (claims estándar): jti identifica la
 * sesión en SesionesActivasService (revocación/rotación) e iat permite
 * exigir tokens RECIENTES para operaciones sensibles (cambio de
 * credenciales en PATCH /users/me, docs/endpoint_perfil_me.md).
 */
export interface UsuarioAutenticado {
  id: string;
  username: string;
  role: user_role;
  organizacionId: string | null;
  debeCambiarContrasena: boolean;
  /** JWT ID: identificador único de la sesión (registro en memoria). */
  jti?: string;
  /** Issued-at en segundos epoch: cuándo se emitió el token. */
  iat?: number;
}
