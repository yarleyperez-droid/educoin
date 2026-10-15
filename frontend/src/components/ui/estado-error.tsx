/**
 * `EstadoError` — estado de error del kit UI (H5.2 / PRO-283, T5.2.1 / PRO-369).
 *
 * Muestra el **mensaje legible** que ya prepara el cliente HTTP de H5.1
 * (`ApiError.message`, en español) dentro de una región `role="alert"`, con
 * una acción de reintento opcional. Nunca pinta `error.detalles` ni ramifica
 * por código HTTP (mismo criterio que las vistas de login/cambio).
 *
 * Patrón de uso (plan §2):
 * ```tsx
 * if (error) return <EstadoError mensaje={error.message} alReintentar={recargar} />;
 * ```
 *
 * @packageDocumentation
 */

import type { ReactElement } from "react";

/** Props de `EstadoError`. */
export interface PropsEstadoError {
  /** Mensaje legible para la persona usuaria (p. ej. `ApiError.message`). */
  mensaje: string;
  /** Si se pasa, se muestra un botón "Reintentar" que lo invoca. */
  alReintentar?: () => void;
}

/**
 * Estado de error con mensaje accesible y reintento opcional.
 *
 * @param props Mensaje y callback opcional de reintento.
 * @returns Bloque `role="alert"` con fondo de peligro y botón opcional.
 */
export function EstadoError({
  mensaje,
  alReintentar,
}: PropsEstadoError): ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border px-4 py-3"
      style={{
        borderColor: "var(--danger)",
        backgroundColor: "var(--danger-bg)",
      }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>
        {mensaje}
      </p>
      {alReintentar !== undefined && (
        <button
          type="button"
          onClick={alReintentar}
          className="rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700 focus-visible:ring-offset-2"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
