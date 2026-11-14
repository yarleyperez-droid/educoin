import type { item_type, redemption_status } from '../../../generated/prisma/client';

/**
 * Ítem resumido para la previsualización del canje (H4.4 / T4.4.1).
 */
export class ItemPrevisualizadoDto {
  id!: string;
  nombre!: string;
  tipo!: item_type;
  costoMonedas!: number;
  /** `null` = stock ilimitado. */
  stock!: number | null;
  /** Solo `grade_bonus`; como texto para no exponer el Decimal. */
  puntosNota!: string | null;
  disponible!: boolean;
}

/** Saldo del estudiante en la clase del ítem. */
export class SaldoPrevisualizadoDto {
  monedasDisponibles!: number;
}

/**
 * Previsualización de un canje: lo que la persona ve ANTES de confirmar
 * (T4.4.1). La confirmación posterior congela el costo mostrado (T4.4.2).
 */
export class PrevisualizacionCanjeDto {
  item!: ItemPrevisualizadoDto;
  saldo!: SaldoPrevisualizadoDto;
  puedeCanjear!: boolean;
  /** Motivo del bloqueo en español, o `null` si puede canjear. */
  motivo!: string | null;
}

/**
 * Canje confirmado o en curso. `costoMonedas` es la copia CONGELADA que
 * escriben los triggers al momento del canje (no el precio vigente del
 * ítem, que puede cambiar después).
 */
export class CanjeRespuestaDto {
  id!: string;
  itemId!: string;
  nombreItem!: string;
  costoMonedas!: number;
  puntosNota!: string | null;
  estado!: redemption_status;
  canjeadoEn!: string;
  /** ISO; `null` mientras el canje siga `completed`. */
  reversadoEn!: string | null;
  /** ISO; `null` mientras no lo resuelva el profesor (o el sistema). */
  resueltoEn!: string | null;
  /**
   * `true` si el canje se aprobó automáticamente por la política del ítem.
   * Aproximación documentada en `docs/propuesta_canje_revisable.md` §2.6:
   * se lee `redeemable_items.auto_approve` del ítem (no hay columna por
   * canje), por lo que refleja la política VIGENTE del ítem.
   */
  aprobacionAutomatica!: boolean;
}

/**
 * Resultado de una resolución del profesor (aprobar/rechazar/entregar,
 * H7.2 / T7.2.3). Contrato §3.3 de la propuesta: ids como `string`.
 */
export class ResolucionCanjeDto {
  id!: string;
  estado!: redemption_status;
  /** ISO del `resolved_at` de la resolución. */
  resueltoEn!: string;
}

/**
 * Fila de los listados paginados de canjes (cola del profesor e historial
 * del estudiante; H7.2 / T7.2.4-T7.2.5).
 */
export class CanjeListadoDto {
  id!: string;
  nombreEstudiante!: string;
  nombreItem!: string;
  costoMonedas!: number;
  estado!: redemption_status;
  /** ISO del `redeemed_at` (instante de la solicitud). */
  solicitadoEn!: string;
}

/** Meta de la paginación estándar `{ data, meta }`. */
export class MetaCanjeDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Listado paginado de canjes (envoltura estándar del repo). */
export class ListadoCanjesDto {
  data!: CanjeListadoDto[];
  meta!: MetaCanjeDto;
}
