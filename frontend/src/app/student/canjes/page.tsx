/**
 * Canjes del estudiante (`/student/canjes`) — H10.3: la tienda del
 * estudiante.
 *
 * La ventana pasa de ser solo el historial (H7.3) a la **tienda por
 * materia**: pestañas accesibles (`role="tablist"`, mismo patrón ARIA que
 * `/teacher/canjes`) con
 *
 * - **Materias** (`TiendaEstudiante`, T10.3.1–T10.3.3): las clases con
 *   inscripción `active` y su conteo de artículos; al entrar, los
 *   artículos de la materia con décimas, costo y stock, y el canje del
 *   flujo revisable (H7.3) reutilizando la previsualización.
 * - **Mis canjes** (`MisCanjes`): el historial de H7.3, **sin cambios de
 *   lógica** (CA 4).
 *
 * Ambas pestañas viven en `features/estudiante/componentes/`; la página
 * solo compone el shell, el encabezado y las pestañas (con los roles ARIA
 * `tablist`/`tab`/`tabpanel` y la tecla de flechas para el foco).
 */

"use client";

import { useRef, useState } from "react";

import { MisCanjes } from "@/features/estudiante/componentes/mis-canjes";
import { TiendaEstudiante } from "@/features/estudiante/componentes/tienda-estudiante";

/** Pestañas de la ventana (id ↔ panel asociado, CA 1/4). */
const PESTANAS = [
  { id: "materias", etiqueta: "Materias" },
  { id: "historial", etiqueta: "Mis canjes" },
] as const;

/** Identificadores de pestaña. */
type Pestana = (typeof PESTANAS)[number]["id"];

/**
 * Ventana de canjes del panel estudiante: materias + historial.
 *
 * @returns Contenido dentro del shell del panel estudiante.
 */
export default function CanjesPage() {
  const [pestana, setPestana] = useState<Pestana>("materias");
  const referenciasPestanas = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

  /**
   * Navega las pestañas con las flechas (patrón ARIA tabs): ←/→ mueve el
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
          Elige una de tus materias para canjear los artículos publicados por
          tu profesor, y revisa el estado de tus solicitudes.
        </p>
      </div>

      {/* Pestañas accesibles: Materias / Mis canjes. */}
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
        {pestana === "materias" ? (
          <TiendaEstudiante alVerMisCanjes={() => setPestana("historial")} />
        ) : (
          <MisCanjes alIrATienda={() => setPestana("materias")} />
        )}
      </div>
    </div>
  );
}
