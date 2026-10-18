/**
 * Contrato de canje del estudiante (H4.1/H4.4 → T5.7.2 / PRO-391).
 *
 * Espejo de los DTOs reales del backend, verificados antes de escribir
 * estos tipos (AGENTS.md §10.2):
 * - `ItemDto` de `src/modules/items/dto/item.dto.ts` (catálogo, ahora
 *   también legible por el estudiante inscrito).
 * - `PrevisualizacionCanjeDto` y `CanjeRespuestaDto` de
 *   `src/modules/redemptions/dto/canje-respuesta.dto.ts`.
 */

/** Tipo de ítem canjeable (`item_type` de la BD). */
export type TipoItem = "grade_bonus" | "fun_activity";

/** Ítem canjeable visible para el estudiante (solo `active`). */
export interface ItemCanje {
  id: string;
  claseId: string;
  name: string;
  description: string | null;
  type: TipoItem;
  costCoins: number;
  /** Solo `grade_bonus`; `null` en el resto. */
  gradePoints: number | null;
  /** `null` = stock ilimitado. */
  stock: number | null;
}

/** ItemPrevisualizadoDto de la previsualización (H4.4). */
export interface ItemPrevisualizado {
  id: string;
  nombre: string;
  tipo: TipoItem;
  costoMonedas: number;
  stock: number | null;
  /** Texto (el backend no expone el Decimal crudo). */
  puntosNota: string | null;
  disponible: boolean;
}

/** Previsualización del canje: costo, saldo y bloqueos ANTES de confirmar. */
export interface PrevisualizacionCanje {
  item: ItemPrevisualizado;
  saldo: { monedasDisponibles: number };
  puedeCanjear: boolean;
  /** Motivo del bloqueo en español, o `null` si puede canjear. */
  motivo: string | null;
}

/** Canje confirmado (`estado` queda `completed` hasta una eventual anulación). */
export interface Canje {
  id: string;
  itemId: string;
  nombreItem: string;
  costoMonedas: number;
  puntosNota: string | null;
  estado: "completed" | "reversed";
  canjeadoEn: string;
  reversadoEn: string | null;
}
