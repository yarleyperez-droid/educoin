/**
 * Contrato de la billetera del estudiante (H4.2 → T5.7.1 / PRO-390).
 *
 * Espejo de los DTOs reales de `src/modules/wallet/dto/saldo-billetera.dto.ts`,
 * verificados contra el código del backend antes de escribir estos tipos
 * (AGENTS.md §10.2). Los IDs viajan como `string` y las fechas en ISO.
 */

/** Tipo de un movimiento del libro mayor (`movement_type` de la BD). */
export type TipoMovimiento =
  | "earning"
  | "spending"
  | "reversal"
  | "adjustment";

/** Saldo agregado del estudiante (vista `student_coins`, solo lectura). */
export interface SaldoBilletera {
  /** Monedas ganadas (total_earned); no baja al canjear. */
  monedasGanadas: number;
  /** Monedas gastadas (total_spent). */
  monedasGastadas: number;
  /** Monedas disponibles (total_available). */
  monedasDisponibles: number;
}

/** Un movimiento del historial con el contexto de su clase. */
export interface MovimientoBilletera {
  id: string;
  tipo: TipoMovimiento;
  /** Firmada: `spending` negativa; el resto positivas. */
  cantidad: number;
  descripcion: string | null;
  claseId: string;
  claseNombre: string;
  /** Fecha ISO del movimiento. */
  creadoEn: string;
}

/** Historial paginado con la envoltura estándar `{ data, meta }`. */
export interface HistorialBilletera {
  data: MovimientoBilletera[];
  meta: { total: number; page: number; limit: number };
}
