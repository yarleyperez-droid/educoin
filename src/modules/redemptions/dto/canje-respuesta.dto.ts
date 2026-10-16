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
 * Canje confirmado o anulado. `costoMonedas` es la copia CONGELADA que
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
}
