/**
 * Badge de estado de canjes (H7.3/H7.4, canje revisable).
 *
 * Componente presentacional (sin estado) que centraliza **una sola fuente
 * de verdad** para las etiquetas en español y los colores de
 * `redemption_status` (`db/001_schema.sql`), de modo que "Mis canjes"
 * (H7.3) y la cola del profesor (H7.4) no dupliquen el mapeo (mismo
 * criterio que `badge-estado-entrega.tsx`, AGENTS.md §8).
 *
 * Estados cubiertos (`redemption_status`):
 * - `pending` → "Pendiente de aprobación" (monedas ya reservadas);
 * - `approved` → "Aprobado, pendiente de entrega";
 * - `delivered` → "Entregado" (terminal);
 * - `rejected` → "Rechazado, monedas devueltas" (terminal);
 * - `completed` → "Completado" (flujo instantáneo legado);
 * - `reversed` → "Anulado, monedas devueltas" (legado).
 */

import type { EstadoCanje } from "../contrato/canje";

/** Etiqueta en español y clases Tailwind de cada estado de canje. */
const PRESENTACION: Readonly<
  Record<EstadoCanje, { etiqueta: string; clases: string }>
> = {
  pending: {
    etiqueta: "Pendiente de aprobación",
    clases: "bg-amber-100 text-amber-700",
  },
  approved: {
    etiqueta: "Aprobado, pendiente de entrega",
    clases: "bg-indigo-100 text-indigo-800",
  },
  delivered: {
    etiqueta: "Entregado",
    clases: "bg-emerald-100 text-emerald-700",
  },
  rejected: {
    etiqueta: "Rechazado, monedas devueltas",
    clases: "bg-red-100 text-red-800",
  },
  completed: {
    etiqueta: "Completado",
    clases: "bg-emerald-100 text-emerald-700",
  },
  reversed: {
    etiqueta: "Anulado, monedas devueltas",
    clases: "bg-slate-200 text-slate-700",
  },
};

/**
 * Devuelve la etiqueta en español de un estado de canje.
 *
 * @param estado Estado real del canje (`redemption_status`).
 * @returns Texto visible (p. ej. `"Pendiente de aprobación"`).
 */
export function etiquetaEstadoCanje(estado: EstadoCanje): string {
  return PRESENTACION[estado].etiqueta;
}

/**
 * Texto del costo de un canje según su estado (CA 2 y 3 de H7.3).
 *
 * Hace explícito el efecto del estado sobre las monedas, para que el
 * estudiante no confunda monedas **reservadas** (aún no disponibles) con
 * monedas **devueltas** (reversión ya acreditada) ni con el gasto
 * definitivo de un canje entregado:
 * - `pending` / `approved` → reservadas (descontadas del saldo, sin
 *   decisión final);
 * - `rejected` / `reversed` → devueltas (el trigger `fn_reverse_redemption`
 *   ya acreditó el movimiento `reversal`);
 * - `delivered` / `completed` → gasto definitivo.
 *
 * @param estado Estado real del canje (`redemption_status`).
 * @param costo Costo congelado en monedas (`cost_coins`).
 * @returns Texto visible, p. ej. `"30 monedas reservadas"`.
 */
export function textoCostoCanje(estado: EstadoCanje, costo: number): string {
  switch (estado) {
    case "pending":
    case "approved":
      return `${costo} monedas reservadas`;
    case "rejected":
    case "reversed":
      return `${costo} monedas devueltas`;
    default:
      return `${costo} monedas`;
  }
}

/** Props del badge de estado de un canje. */
export interface BadgeEstadoCanjeProps {
  /** Estado real del canje (`redemption_status`). */
  estado: EstadoCanje;
}

/**
 * Badge compacto con el estado del canje y su color.
 *
 * @param props Estado a representar.
 * @returns Elemento `span` con la etiqueta en español.
 */
export function BadgeEstadoCanje({ estado }: BadgeEstadoCanjeProps) {
  const presentacion = PRESENTACION[estado];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${presentacion.clases}`}
    >
      {presentacion.etiqueta}
    </span>
  );
}
