/**
 * Diálogo modal accesible del kit UI (H5.2 / rediseño panel docente).
 *
 * Overlay oscuro + tarjeta centrada, sin dependencias nuevas:
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` al título.
 * - Cierra con la ✕, con `Escape` y con clic en el overlay (los tres
 *   caminos llaman a `alCerrar`; el disparador nunca cierra por su cuenta,
 *   la página dueña del estado decide).
 * - Al abrir mueve el foco al diálogo (`tabIndex={-1}`) y lo devuelve al
 *   desmontarse no es necesario: el foco vuelve al body al quitar el nodo.
 * - `pointer-events` del overlay evita clicks fantasma detrás del modal.
 *
 * Componente cliente con estado mínimo (necesita `useEffect` para la
 * tecla Escape); las páginas le pasan `abierto` controlado.
 */

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { IconX } from "./iconos";

/**
 * Propiedades del diálogo modal.
 */
export interface PropsModal {
  /** Si el diálogo está visible (estado controlado por la página). */
  abierto: boolean;

  /** Título accesible y visible del diálogo. */
  titulo: string;

  /** Se invoca al pedir cerrar (✕, Escape u overlay). */
  alCerrar: () => void;

  /** Contenido del cuerpo del diálogo. */
  children: ReactNode;

  /** Fila de acciones (botones/enlaces) al pie del diálogo. */
  acciones?: ReactNode;
}

/**
 * Diálogo modal accesible.
 *
 * @param props Estado, título, cierre y contenido del diálogo.
 * @returns Overlay con la tarjeta del modal, o `null` si está cerrado.
 */
export function Modal({ abierto, titulo, alCerrar, children, acciones }: PropsModal) {
  const idTitulo = useId();
  const refDialogo = useRef<HTMLDivElement>(null);

  // Al abrir: foco dentro del diálogo + Escape para cerrar.
  useEffect(() => {
    if (!abierto) {
      return;
    }

    refDialogo.current?.focus();

    function manejarTecla(evento: KeyboardEvent): void {
      if (evento.key === "Escape") {
        alCerrar();
      }
    }

    document.addEventListener("keydown", manejarTecla);
    return () => document.removeEventListener("keydown", manejarTecla);
  }, [abierto, alCerrar]);

  if (!abierto) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay: clic para cerrar (el foco del teclado vive en el diálogo). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={alCerrar}
        className="absolute inset-0 cursor-default bg-slate-900/50 backdrop-blur-sm"
      />

      <div
        ref={refDialogo}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={idTitulo} className="text-lg font-semibold text-slate-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={alCerrar}
            aria-label="Cerrar"
            className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">{children}</div>

        {acciones !== undefined && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {acciones}
          </div>
        )}
      </div>
    </div>
  );
}
