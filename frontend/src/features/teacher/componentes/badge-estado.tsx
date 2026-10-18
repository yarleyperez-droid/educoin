/**
 * Badge de estado para clases y actividades (T5.6.3, PRO-387).
 *
 * Componente presentacional (sin estado) que centraliza **una sola fuente
 * de verdad** para las etiquetas en español y los estilos de color de los
 * estados, de modo que el listado de clases y el detalle de actividades no
 * dupliquen el mapeo (convención AGENTS.md §8).
 *
 * Estados cubiertos:
 * - Clase (`class_status`): `active`, `archived`.
 * - Actividad (`activity_status`): `draft`, `published`, `deleted` (esta
 *   última no aparece en listados, pero se tipa por completitud).
 */

import type { EstadoActividad, EstadoClase } from "../tipos";

/** Unión de todos los estados del panel docente. */
export type EstadoPanel = EstadoClase | EstadoActividad;

/** Etiqueta en español y clases Tailwind de cada estado. */
const PRESENTACION: Readonly<
  Record<EstadoPanel, { etiqueta: string; clases: string }>
> = {
  active: {
    etiqueta: "Activa",
    clases: "bg-green-100 text-green-800",
  },
  archived: {
    etiqueta: "Archivada",
    clases: "bg-neutral-200 text-neutral-700",
  },
  draft: {
    etiqueta: "Borrador",
    clases: "bg-amber-100 text-amber-800",
  },
  published: {
    etiqueta: "Publicada",
    clases: "bg-green-100 text-green-800",
  },
  deleted: {
    etiqueta: "Eliminada",
    clases: "bg-red-100 text-red-800",
  },
};

/**
 * Devuelve la etiqueta en español de un estado.
 *
 * @param estado Estado de clase o actividad.
 * @returns Texto visible (p. ej. `"Borrador"`).
 */
export function etiquetaEstado(estado: EstadoPanel): string {
  return PRESENTACION[estado].etiqueta;
}

/** Props del badge de estado. */
interface BadgeEstadoProps {
  /** Estado de la clase o actividad. */
  estado: EstadoPanel;
}

/**
 * Badge compacto con el estado y su color.
 *
 * @param props Estado a representar.
 * @returns Elemento `span` con la etiqueta en español.
 */
export function BadgeEstado({ estado }: BadgeEstadoProps) {
  const presentacion = PRESENTACION[estado];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${presentacion.clases}`}
    >
      {presentacion.etiqueta}
    </span>
  );
}
