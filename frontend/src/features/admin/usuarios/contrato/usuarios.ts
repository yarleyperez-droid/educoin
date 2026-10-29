/**
 * Contrato zod de los usuarios del panel admin (T5.5.2 / PRO-383, H5.5).
 *
 * Espejo de los DTOs reales de H2.4 (`src/modules/users/dto/`):
 *
 * - `GET /api/v1/users?page&limit&organizacionId&rol&q` → `{ data, meta }`
 *   con `UsuarioRespuestaDto` (orden `created_at desc`).
 * - `POST /api/v1/users` → 201 `{ mensaje, contrasenaInicial, usuario }`:
 *   la **contraseña inicial está en la raíz** de la respuesta (16 chars
 *   base64url, se muestra UNA sola vez) y el usuario nace con
 *   `must_change_password = true`.
 * - El DTO de creación solo acepta `rol: 'teacher' | 'student'` (un
 *   `admin` da 400), `usuario` (3–50, patrón), `correo` (email único),
 *   `nombre`/`apellido`, `organizacionId` obligatorio y `especialidad`
 *   solo para teacher (student con especialidad → 400).
 */

import { z } from "zod";

/** Roles que el listado puede mostrar (el alta solo admite teacher/student). */
export const RolListadoSchema = z.enum(["admin", "teacher", "student"]);

/** Roles que el admin puede crear (`ROLES_CREABLES` del backend). */
export const RolCreableSchema = z.enum(["teacher", "student"]);

/** Rol de listado de dominio. */
export type RolListado = z.infer<typeof RolListadoSchema>;

/** Rol creable de dominio. */
export type RolCreable = z.infer<typeof RolCreableSchema>;

/** Meta de paginación del envoltorio estándar de listados. */
export const MetaPaginacionSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

/** Usuario tal como lo responde el backend (`UsuarioRespuestaDto`). */
export const UsuarioSchema = z.object({
  id: z.string().min(1),
  usuario: z.string().min(1),
  correo: z.string().min(1),
  rol: RolListadoSchema,
  nombre: z.string(),
  apellido: z.string(),
  especialidad: z.string().nullable(),
  organizacionId: z.string().nullable(),
  debeCambiarContrasena: z.boolean(),
  activo: z.boolean(),
  creadoEn: z.string(),
});

/** Página de usuarios: `{ data, meta }`. */
export const ListadoUsuariosSchema = z.object({
  data: z.array(UsuarioSchema),
  meta: MetaPaginacionSchema,
});

/** Respuesta del alta (`contrasenaInicial` en la raíz). */
export const UsuarioCreadoSchema = z.object({
  mensaje: z.string(),
  contrasenaInicial: z.string().min(1),
  usuario: UsuarioSchema,
});

/** Usuario de dominio. */
export type Usuario = z.infer<typeof UsuarioSchema>;

/** Página de usuarios de dominio. */
export type ListadoUsuarios = z.infer<typeof ListadoUsuariosSchema>;

/** Respuesta del alta de dominio. */
export type UsuarioCreado = z.infer<typeof UsuarioCreadoSchema>;

/** Filtros del listado de usuarios. */
export interface FiltrosUsuarios {
  page?: number;
  limit?: number;
  /** Filtro exacto `organizacionId` del backend. */
  organizacionId?: string;
  /** Búsqueda en usuario, correo, nombre y apellido (ILIKE). */
  q?: string;
  /** Filtro exacto de rol (incluye admin en listados). */
  rol?: RolListado;
  /** true → solo activos; false → solo desactivados. */
  activa?: boolean;
}

/** Datos del formulario de alta. */
export interface CrearUsuarioInput {
  rol: RolCreable;
  usuario: string;
  correo: string;
  nombre: string;
  apellido: string;
  organizacionId: string;
  /** Solo para rol teacher; el backend la rechaza en student. */
  especialidad?: string;
}

/**
 * Traduce los issues de zod a un mensaje único en español.
 *
 * Réplica local del helper homónimo de las otras features (cada contrato
 * lleva su vocabulario; no se acoplan `admin/usuarios` a
 * `admin/organizaciones`).
 *
 * @param problemas Issues de un `safeParse` fallido.
 * @returns Mensaje legible para la UI.
 */
export function mensajeDeErroresZod(
  problemas: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>,
): string {
  if (problemas.length === 0) {
    return "Revisa los datos del usuario.";
  }

  const primero = problemas[0];
  const campo =
    primero.path.length > 0
      ? primero.path
          .map((segmento) =>
            typeof segmento === "symbol" ? String(segmento) : segmento,
          )
          .join(".")
      : "respuesta";

  return `El campo "${campo}" no tiene un formato válido: ${primero.message}`;
}
