/**
 * `EstadoCarga` — estado de carga accesible del kit UI (H5.2 / PRO-283,
 * T5.2.1 / PRO-369).
 *
 * Se muestra mientras hay una petición en curso. Anuncia el estado a los
 * lectores de pantalla con `role="status"` + `aria-live="polite"` (CA 1) y
 * mantiene el spinner oculto para lectores (`aria-hidden`), de modo que el
 * único anuncio sea el texto.
 *
 * Patrón de uso (plan §2):
 * ```tsx
 * if (cargando) return <EstadoCarga mensaje="Cargando tus clases…" />;
 * ```
 *
 * @packageDocumentation
 */

import type { ReactElement } from "react";

/** Props de `EstadoCarga`. */
export interface PropsEstadoCarga {
  /** Texto anunciado; por defecto "Cargando…". */
  mensaje?: string;
}

/**
 * Spinner animado oculto para lectores de pantalla.
 *
 * @returns SVG de 28 px que rota con `animate-spin`.
 */
function Spin(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="size-7 animate-spin"
      style={{ color: "var(--muted)" }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Estado de carga accesible (petición en curso).
 *
 * @param props `mensaje` opcional para personalizar el texto anunciado.
 * @returns Bloque centrado con spinner `aria-hidden` y región `role="status"`.
 */
export function EstadoCarga({ mensaje = "Cargando…" }: PropsEstadoCarga): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
    >
      <Spin />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {mensaje}
      </p>
    </div>
  );
}
