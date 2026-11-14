import type { movement_type } from '../../../generated/prisma/client';

/**
 * Saldo agregado del estudiante en TODAS sus inscripciones (H4.2 / PRO-280).
 * Se lee de la vista `student_coins`; la aplicación no recalcula nada.
 */
export class SaldoBilleteraDto {
  monedasGanadas!: number;
  monedasGastadas!: number;
  monedasDisponibles!: number;
}

/** Un movimiento del libro mayor (`coin_movements`), solo lectura. */
export class MovimientoBilleteraDto {
  id!: string;
  tipo!: movement_type;
  /** Firmada: `spending` negativa; `earning`/`reversal`/`adjustment` positivas. */
  cantidad!: number;
  descripcion!: string | null;
  claseId!: string;
  /** Contexto: el estudiante puede tener movimientos en varias clases. */
  claseNombre!: string;
  creadoEn!: string;
}

/** Meta de la paginación estándar { data, meta }. */
export class MetaBilleteraDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Historial paginado de movimientos del propio estudiante. */
export class HistorialBilleteraDto {
  data!: MovimientoBilleteraDto[];
  meta!: MetaBilleteraDto;
}
