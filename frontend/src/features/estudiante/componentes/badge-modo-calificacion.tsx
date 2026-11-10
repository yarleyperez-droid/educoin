/**
 * Badge del modo de calificación de una actividad (corrección
 * puntaje↔monedas: la recompensa es un MÁXIMO que se paga proporcional
 * al puntaje).
 *
 * Componente presentacional (sin estado) que centraliza **una sola fuente
 * de verdad** para las etiquetas en español y los colores del campo
 * `modoCalificacion` de los DTOs de H3.3 (mismo criterio que
 * `features/teacher/componentes/badge-estado-entrega.tsx`, AGENTS.md §8):
 * la lista de actividades y el detalle del estudiante comparten la misma
 * presentación y la misma línea de explicación.
 *
 * Modos cubiertos (`ModoCalificacion`, espejo de
 * `src/modules/activities/dto/preguntas.schema.ts`):
 * - `automatica` → "Calificación automática": la entrega se califica sola
 *   con ≥ 80% del puntaje total; por debajo del umbral cae en revisión
 *   del profesor;
 * - `manual` → "Revisión del profesor": la actividad incluye preguntas
 *   que el profesor revisa y califica.
 *
 * La UI **nunca** calcula monedas ni puntajes: solo presenta el modo que
 * devuelve la API (AGENTS.md §6: el trigger de la BD es la única fuente).
 */

import type { ModoCalificacion } from "../contrato/cuestionario";

/** Etiqueta en español y clases Tailwind de cada modo de calificación. */
const PRESENTACION: Readonly<
  Record<ModoCalificacion, { etiqueta: string; clases: string }>
> = {
  automatica: {
    etiqueta: "Calificación automática",
    clases: "bg-emerald-100 text-emerald-700",
  },
  manual: {
    etiqueta: "Revisión del profesor",
    clases: "bg-amber-100 text-amber-700",
  },
};

/** Línea corta que explica cada modo en las vistas del estudiante. */
const EXPLICACIONES: Readonly<Record<ModoCalificacion, string>> = {
  automatica:
    "Se califica sola con ≥80% del puntaje; si no, revisa el profesor.",
  manual: "El profesor revisa y califica.",
};

/**
 * Explicación corta del modo de calificación (una línea).
 *
 * @param modo Camino normal de calificación de la actividad.
 * @returns Texto visible en español.
 */
export function explicacionModoCalificacion(modo: ModoCalificacion): string {
  return EXPLICACIONES[modo];
}

/** Props del badge del modo de calificación. */
export interface BadgeModoCalificacionProps {
  /** Camino normal de calificación de la actividad. */
  modo: ModoCalificacion;
}

/**
 * Badge compacto con el modo de calificación y su color.
 *
 * @param props Modo a representar.
 * @returns Elemento `span` con la etiqueta en español.
 */
export function BadgeModoCalificacion({ modo }: BadgeModoCalificacionProps) {
  const presentacion = PRESENTACION[modo];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${presentacion.clases}`}
    >
      {presentacion.etiqueta}
    </span>
  );
}
