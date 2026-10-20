import type { user_role } from '../../../generated/prisma/client';

/**
 * Datos del usuario que SALEN hacia el cliente (AGENTS.md §8: nunca se
 * devuelven entidades Prisma crudas). El id viaja como string porque
 * BigInt no se serializa a JSON (AGENTS.md §7). password_hash y
 * last_login jamás salen: el select de Prisma ni siquiera los lee
 * (mínima exposición). El mapeo explícito fija el contrato y evita que
 * columnas futuras se filtren solas.
 */
export class UsuarioRespuestaDto {
  id!: string;
  usuario!: string;
  correo!: string;
  rol!: user_role;
  nombre!: string;
  apellido!: string;
  especialidad!: string | null;
  organizacionId!: string | null;
  debeCambiarContrasena!: boolean;
  activo!: boolean;
  creadoEn!: string;
}

/**
 * Respuesta de POST /api/v1/users: confirma la creación con la
 * contraseña inicial generada por el servidor (decisión del equipo) y
 * el usuario creado (patrón de OrganizacionCreadaRespuestaDto).
 *
 * contrasenaInicial viaja UNA sola vez aquí para que el admin la
 * comparta con la persona; no se vuelve a mostrar en ningún otro
 * endpoint y jamás se guarda en texto plano: en la BD solo queda el
 * hash argon2 (AGENTS.md §9.3).
 */
export class UsuarioCreadoRespuestaDto {
  mensaje!: string;
  contrasenaInicial!: string;
  usuario!: UsuarioRespuestaDto;
}

/**
 * Meta de la paginación estándar de listados (AGENTS.md §8). Misma
 * forma que la de organizaciones: { total, page, limit }.
 */
export class ListadoUsuariosMetaDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoUsuariosDto {
  data!: UsuarioRespuestaDto[];
  meta!: ListadoUsuariosMetaDto;
}
