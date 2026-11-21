/**
 * Contrato zod de las organizaciones del panel admin (T5.5.1 / PRO-380,
 * H5.5).
 *
 * Espejo de los DTOs reales de H2.4 (`src/modules/organizations/dto/`):
 *
 * - `GET /api/v1/organizations?page&limit` → `{ data, meta }` con
 *   `OrganizacionRespuestaDto` (envoltura estándar de listados).
 * - `POST /api/v1/organizations` → 201 `{ mensaje, organizacion }`
 *   (objeto plano, NO envuelto).
 * - Fila: `id` (string, BigInt serializado), `nombre`, `tipo`
 *   (`school|university|other`, enum `organization_type` de la BD),
 *   `ciudad: string|null`, `activa`, `creadoEn`, `actualizadoEn`.
 * - El DTO de creación acepta `nombre` (3–200), `tipo` y `ciudad`
 *   opcional (≤100); `activa` nace en TRUE por DEFAULT de la BD.
 */

import { z } from "zod";

/** Tipos de organización (enum `organization_type` de la BD). */
export const TipoOrganizacionSchema = z.enum([
  "school",
  "university",
  "other",
]);

/** Tipo de organización de dominio. */
export type TipoOrganizacion = z.infer<typeof TipoOrganizacionSchema>;

/** Meta de paginación del envoltorio estándar de listados. */
export const MetaPaginacionSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

/** Organización tal como la responde el backend. */
export const OrganizacionSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  tipo: TipoOrganizacionSchema,
  ciudad: z.string().nullable(),
  activa: z.boolean(),
  creadoEn: z.string(),
  actualizadoEn: z.string(),
});

/** Página de organizaciones: `{ data, meta }`. */
export const ListadoOrganizacionesSchema = z.object({
  data: z.array(OrganizacionSchema),
  meta: MetaPaginacionSchema,
});

/** Respuesta del alta (`OrganizacionCreadaRespuestaDto`). */
export const OrganizacionCreadaSchema = z.object({
  mensaje: z.string(),
  organizacion: OrganizacionSchema,
});

/** Organización de dominio. */
export type Organizacion = z.infer<typeof OrganizacionSchema>;

/** Página de organizaciones de dominio (`{ data, meta }`). */
export type ListadoOrganizaciones = z.infer<
  typeof ListadoOrganizacionesSchema
>;

/** Meta de paginación de dominio. */
export type MetaPaginacion = z.infer<typeof MetaPaginacionSchema>;

/** Respuesta del alta de dominio. */
export type OrganizacionCreada = z.infer<typeof OrganizacionCreadaSchema>;

/** Datos del formulario de alta (ciudad opcional). */
export interface CrearOrganizacionInput {
  nombre: string;
  tipo: TipoOrganizacion;
  ciudad?: string;
}

/** Filtros del listado (`q`, `tipo`, `activa` del backend). */
export interface FiltrosOrganizaciones {
  page?: number;
  limit?: number;
  /** Búsqueda por nombre (contains insensible). */
  q?: string;
  /** Filtro exacto de tipo. */
  tipo?: TipoOrganizacion;
  /** true → solo activas; false → solo desactivadas. */
  activa?: boolean;
}

/**
 * Traduce los issues de zod a un mensaje único en español.
 *
 * Réplica local del helper homónimo de otras features: se duplica a
 * propósito para no acoplar `features/admin` al vocabulario de docente o
 * estudiante.
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
    return "Revisa los datos de la organización.";
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
