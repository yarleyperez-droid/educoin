/**
 * Contrato zod de los rankings del estudiante (T5.10.1 / PRO-403, H5.10).
 *
 * Espejo del DTO real de H4.3 (`src/modules/rankings/dto/ranking.dto.ts`,
 * verificado contra `rankings.controller.ts` y `rankings.service.ts`):
 *
 * - `GET /api/v1/rankings` (global) y `GET /api/v1/rankings/classes/:id`
 *   devuelven la envoltura `{ data, meta }` con `RankingDto`.
 * - Cada fila (`FilaRankingDto`) trae `posicion` (RANK de la vista; se
 *   repite en empates), `estudianteId` (string: BigInt no serializa),
 *   `nombres` (concatenación `first_name last_name` hecha en el backend),
 *   `monedasGanadas` (criterio de orden: canjear no lo modifica) y
 *   `monedasDisponibles`.
 * - `meta` es `{ total, page, limit }` (page 1-indexada; defaults del
 *   backend `page=1`, `limit=20`).
 *
 * La UI **jamás** recalcula posiciones ni monedas: pinta lo que manda la
 * API (AGENTS.md §6). La posición del usuario actual no es campo del
 * contrato (decisión del spec 034; fuera de alcance de H5.10).
 */

import { z } from "zod";

/** Fila del ranking tal como la emite el backend. */
export const FilaRankingSchema = z.object({
  posicion: z.number().int().min(1),
  estudianteId: z.string().min(1),
  nombres: z.string().min(1),
  monedasGanadas: z.number().int().min(0),
  monedasDisponibles: z.number().int().min(0),
});

/** Meta de paginación del envoltorio estándar de listados. */
export const MetaRankingSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

/** Página de ranking: `{ data, meta }`. */
export const RankingPaginadoSchema = z.object({
  data: z.array(FilaRankingSchema),
  meta: MetaRankingSchema,
});

/** Fila de dominio del ranking. */
export type FilaRanking = z.infer<typeof FilaRankingSchema>;

/** Meta de paginación de dominio. */
export type MetaRanking = z.infer<typeof MetaRankingSchema>;

/** Página de ranking de dominio. */
export type RankingPaginado = z.infer<typeof RankingPaginadoSchema>;

/**
 * Traduce los issues de zod a un mensaje único en español.
 *
 * Réplica local del helper homónimo de `features/teacher/contrato/
 * actividades.ts` (allí el default es específico de actividades): se
 * duplica a propósito para no acoplar la feature de rankings a la de
 * docente (cada contrato lleva su vocabulario).
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
    return "Revisa los datos del ranking.";
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

  return `El campo "${campo}" del ranking no tiene un formato válido: ${primero.message}`;
}
