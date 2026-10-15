/**
 * `EstadoVacio` — estado vacío del kit UI (H5.2 / PRO-283, T5.2.1 / PRO-369).
 *
 * Se pinta cuando la API responde `{ data: [], meta }` sin filas (CA 2):
 * muestra un título, una descripción y — si se pasa — una **acción sugerida**
 * para que el usuario sepa qué hacer a continuación (p. ej. "Crear clase").
 *
 * Patrón de uso (plan §2):
 * ```tsx
 * if (lista.length === 0)
 *   return <EstadoVacio titulo="Aún no hay clases" accion={{ texto: "Crear clase", alHacerClic: abrir }} />;
 * ```
 *
 * @packageDocumentation
 */

import type { ReactElement } from "react";

/** Acción sugerida del estado vacío. */
export interface AccionSugerida {
  /** Texto del botón. */
  texto: string;
  /** Handler del botón. */
  alHacerClic: () => void;
}

/** Props de `EstadoVacio`. */
export interface PropsEstadoVacio {
  /** Título del estado (obligatorio). */
  titulo: string;
  /** Descripción opcional con más contexto. */
  descripcion?: string;
  /** Acción sugerida opcional (CA 2). */
  accion?: AccionSugerida;
}

/**
 * Estado vacío con acción sugerida.
 *
 * @param props Título, descripción y acción opcional.
 * @returns Tarjeta con borde discontinuo, centrada.
 */
export function EstadoVacio({
  titulo,
  descripcion,
  accion,
}: PropsEstadoVacio): ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-semibold text-neutral-900">{titulo}</p>
      {descripcion !== undefined && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {descripcion}
        </p>
      )}
      {accion !== undefined && (
        <button
          type="button"
          onClick={accion.alHacerClic}
          className="mt-3 rounded-md border border-neutral-500 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700 focus-visible:ring-offset-2"
        >
          {accion.texto}
        </button>
      )}
    </div>
  );
}
