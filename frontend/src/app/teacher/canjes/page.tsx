/**
 * Canjes del profesor (`/teacher/canjes`) — H10.2: la tienda del profesor.
 *
 * La ventana pasa de ser solo la cola de solicitudes (H7.4) a la
 * **tienda por clase**: pestañas accesibles (`role="tablist"`) con
 *
 * - **Tienda** (`TiendaClase`, T10.2.1–T10.2.3): selector de las clases
 *   del profesor, artículos de la clase elegida con su estado, alta,
 *   edición y archivado.
 * - **Solicitudes** (`ColaCanjes`): la cola de canjes pendientes de H7.4,
 *   **sin cambios de lógica** (CA 4).
 *
 * Ambas pestañas viven en `features/teacher/componentes/`; la página solo
 * compone el shell, el encabezado y las pestañas (con los roles ARIA
 * `tablist`/`tab`/`tabpanel` y la tecla de flechas para el foco).
 */

"use client";

import { useRef, useState } from "react";

import { ColaCanjes } from "@/features/teacher/componentes/cola-canjes";
import { TiendaClase } from "@/features/teacher/componentes/tienda-clase";

/** Pestañas de la ventana (id ↔ panel asociado, CA 4/5). */
const PESTANAS = [
  { id: "tienda", etiqueta: "Tienda" },
  { id: "solicitudes", etiqueta: "Solicitudes" },
] as const;

/** Identificadores de pestaña. */
type Pestana = (typeof PESTANAS)[number]["id"];

/**
 * Ventana de canjes del panel docente: tienda + cola de solicitudes.
 *
 * @returns Contenido dentro del shell del panel docente.
 */
export default function CanjesPage() {
  const [pestana, setPestana] = useState<Pestana>("tienda");
  const referenciasPestanas = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

  /**
   * Navega las pestañas con las flechas (patrón ARIA tabs): ←/← mueve el
   * foco y activa la pestaña vecina.
   *
   * @param evento Evento de teclado del tablist.
   */
  function navegarConFlechas(evento: React.KeyboardEvent<HTMLButtonElement>) {
    const indice = PESTANAS.findIndex((p) => p.id === pestana);
    let siguiente: Pestana | null = null;

    if (evento.key === "ArrowRight") {
      siguiente = PESTANAS[(indice + 1) % PESTANAS.length].id;
    } else if (evento.key === "ArrowLeft") {
      siguiente = PESTANAS[(indice - 1 + PESTANAS.length) % PESTANAS.length].id;
    }

    if (siguiente !== null) {
      evento.preventDefault();
      setPestana(siguiente);
      referenciasPestanas.current[siguiente]?.focus();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
          Canjes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Publica y administra los artículos de cada una de tus clases, y
          resuelve las solicitudes de canje de tus estudiantes.
        </p>
      </div>

      {/* Pestañas accesibles: Tienda / Solicitudes. */}
      <div
        role="tablist"
        aria-label="Secciones de canjes"
        className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-fit"
      >
        {PESTANAS.map((item) => {
          const activa = pestana === item.id;

          return (
            <button
              key={item.id}
              ref={(nodo) => {
                referenciasPestanas.current[item.id] = nodo;
              }}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={activa}
              aria-controls={`panel-${item.id}`}
              tabIndex={activa ? 0 : -1}
              onClick={() => setPestana(item.id)}
              onKeyDown={navegarConFlechas}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                activa
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.etiqueta}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${pestana}`}
        aria-labelledby={`tab-${pestana}`}
      >
        {pestana === "tienda" ? <TiendaClase /> : <ColaCanjes />}
      </div>
    </div>
  );
}
