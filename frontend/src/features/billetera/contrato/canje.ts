/**
 * Contrato de canje del estudiante (H4.1/H4.4 → T5.7.2 / PRO-391, ampliado
 * por el canje revisable de H7.3/H7.4).
 *
 * Espejo de los DTOs reales del backend, verificados antes de escribir
 * estos tipos (AGENTS.md §10.2):
 * - `ItemDto` de `src/modules/items/dto/item.dto.ts` (catálogo, ahora
 *   también legible por el estudiante inscrito).
 * - `PrevisualizacionCanjeDto`, `CanjeRespuestaDto`, `ResolucionCanjeDto`,
 *   `CanjeListadoDto`, `MetaCanjeDto` y `ListadoCanjesDto` de
 *   `src/modules/redemptions/dto/canje-respuesta.dto.ts` (H7.2: los dos
 *   listados paginados y la resolución del profesor).
 *
 * Con el canje revisable (`docs/propuesta_canje_revisable.md`), un canje
 * nace `pending` (o `approved` si el ítem tiene auto-aprobación) y solo
 * queda `delivered`/`rejected` tras la resolución del profesor; los
 * valores `completed`/`reversed` son el flujo instantáneo **legado** del
 * MVP y siguen existiendo en el enum `redemption_status` de la BD.
 */

/** Tipo de ítem canjeable (`item_type` de la BD). */
export type TipoItem = "grade_bonus" | "fun_activity";

/**
 * Estado real de un canje (`redemption_status` de la BD, 6 valores):
 * - `pending`: solicitado, pendiente de aprobación del profesor (las
 *   monedas ya quedaron reservadas por el trigger).
 * - `approved`: aprobado (manual o automáticamente), a la espera de
 *   entrega.
 * - `delivered`: entregado (terminal).
 * - `rejected`: rechazado (terminal; monedas y stock devueltos).
 * - `completed`: flujo instantáneo legado del MVP.
 * - `reversed`: anulación legada (monedas y stock devueltos).
 */
export type EstadoCanje =
  | "pending"
  | "approved"
  | "delivered"
  | "rejected"
  | "completed"
  | "reversed";

/** Ítem canjeable visible para el estudiante (solo `active`). */
export interface ItemCanje {
  id: string;
  claseId: string;
  /** Nombre de la clase del ítem (`className` del DTO, H10.3/T10.3.1). */
  claseNombre: string;
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

/**
 * Canje confirmado (`CanjeRespuestaDto`). `costoMonedas` es la copia
 * CONGELADA por la BD al momento del canje. Con el canje revisable el
 * `estado` nace `pending` (o `approved` con auto-aprobación).
 */
export interface Canje {
  id: string;
  itemId: string;
  nombreItem: string;
  costoMonedas: number;
  puntosNota: string | null;
  estado: EstadoCanje;
  canjeadoEn: string;
  reversadoEn: string | null;
  /** ISO; `null` mientras no lo resuelva el profesor (o el sistema). */
  resueltoEn: string | null;
  /**
   * `true` si el canje se aprobó automáticamente por la política del ítem
   * (`redeemable_items.auto_approve`, según `CanjeRespuestaDto`).
   */
  aprobacionAutomatica: boolean;
}

/**
 * Resultado de una resolución del profesor
 * (`ResolucionCanjeDto`: aprobar/rechazar/entregar, H7.2).
 */
export interface ResolucionCanje {
  id: string;
  estado: EstadoCanje;
  /** ISO del `resolved_at` de la resolución. */
  resueltoEn: string;
}

/**
 * Fila de los listados paginados de canjes (`CanjeListadoDto`): la cola
 * del profesor (`GET /redemptions/pending`) y el historial del estudiante
 * (`GET /redemptions/mine`).
 */
export interface CanjeListado {
  id: string;
  nombreEstudiante: string;
  nombreItem: string;
  /** Costo congelado en monedas. */
  costoMonedas: number;
  estado: EstadoCanje;
  /** ISO del `redeemed_at` (instante de la solicitud). */
  solicitadoEn: string;
}

/** Meta de la paginación estándar (`MetaCanjeDto`). */
export interface Meta {
  total: number;
  page: number;
  limit: number;
}

/** Listado paginado de canjes (`ListadoCanjesDto`, `{ data, meta }`). */
export interface ListadoCanjes {
  data: CanjeListado[];
  meta: Meta;
}
