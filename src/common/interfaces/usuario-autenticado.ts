import type { user_role } from '../../generated/prisma/client';

/**
 * Usuario autenticado tal como vive en el payload del JWT de acceso y en
 * `request.user` después de pasar por JwtAuthGuard. Los IDs viajan como
 * string porque BigInt no se serializa a JSON.
 */
export interface UsuarioAutenticado {
  id: string;
  username: string;
  role: user_role;
  organizacionId: string | null;
  debeCambiarContrasena: boolean;
}
