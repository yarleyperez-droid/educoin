/**
 * Badge de estado de entregas (T5.9.2, PRO-400).
 *
 * Componente presentacional (sin estado) que centraliza **una sola fuente
 * de verdad** para las etiquetas en español y los colores de
 * `submission_status` (`db/001_schema.sql`), de modo que la cola (T5.9.1)
 * y la vista de revisión/calificación (T5.9.2) no dupliquen el mapeo
 * (mismo criterio que `badge-estado.tsx` con clases/actividades,
 * AGENTS.md §8).
 *
 * Estados cubiertos (`submission_status`):
 * - `in_progress` → "Borrador" (la entrega aún no se envía);
 * - `submitted` → "Enviada" (pendiente del profesor);
 * - `graded` → "Calificada" (monedas acreditadas por el trigger);
 * - `rejected` → "Rechazada".
 */

import type { EstadoEntrega } from "../contrato/entregas";

/** Etiqueta en español y clases Tailwind de cada estado de entrega. */
const PRESENTACION: Readonly<
  Record<EstadoEntrega, { etiqueta: string; clases: string }>
> = {
  in_progress: {
    etiqueta: "Borrador",
    clases: "bg-amber-100 text-amber-800",
  },
  submitted: {
    etiqueta: "Enviada",
    clases: "bg-blue-100 text-blue-800",
  },
  graded: {
    etiqueta: "Calificada",
    clases: "bg-green-100 text-green-800",
  },
  rejected: {
    etiqueta: "Rechazada",
    clases: "bg-red-100 text-red-800",
  },
};

/**
 * Devuelve la etiqueta en español de un estado de entrega.
 *
 * @param estado Estado real de la entrega (`submission_status`).
 * @returns Texto visible (p. ej. `"Calificada"`).
 */
export function etiquetaEstadoEntrega(estado: EstadoEntrega): string {
  return PRESENTACION[estado].etiqueta;
}

/** Props del badge de estado de una entrega. */
export interface BadgeEstadoEntregaProps {
  /** Estado real de la entrega (`submission_status`). */
  estado: EstadoEntrega;
}

/**
 * Badge compacto con el estado de la entrega y su color.
 *
 * @param props Estado a representar.
 * @returns Elemento `span` con la etiqueta en español.
 */
export function BadgeEstadoEntrega({ estado }: BadgeEstadoEntregaProps) {
  const presentacion = PRESENTACION[estado];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${presentacion.clases}`}
    >
      {presentacion.etiqueta}
    </span>
  );
}
