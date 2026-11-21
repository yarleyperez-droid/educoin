/**
 * `PanelLateral` — tarjeta lateral de las vistas de formulario (2 columnas).
 *
 * Compartido por los paneles de creación/edición (clase, actividad) y por
 * las vistas de entrega/revisión, para que el espacio a la derecha en
 * pantallas grandes deje de quedar vacío: el contenido principal ocupa
 * `lg:col-span-2` y esta tarjeta `lg:col-span-1`. En móvil/apilado el
 * panel queda debajo del formulario.
 *
 * El contenido es siempre **estático o ya disponible en la página** (no
 * consulta la API): consejos, reglas o resúmenes que la vista ya conoce.
 *
 * @packageDocumentation
 */

import type { ReactElement, ReactNode } from "react";

/** Props de `PanelLateral`. */
export interface PropsPanelLateral {
  /** Título visible de la tarjeta (renderizado como `h2`). */
  titulo: string;

  /** Cuerpo de la tarjeta (párrafos, listas, datos). */
  children: ReactNode;
}

/**
 * Tarjeta lateral de apoyo para las vistas de formulario.
 *
 * @param props Título y contenido de la tarjeta.
 * @returns `aside` con borde redondeado slate, ancho de una columna en
 * desktop y ancho completo apilado en móvil.
 */
export function PanelLateral({
  titulo,
  children,
}: PropsPanelLateral): ReactElement {
  return (
    <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
      <div className="mt-3 space-y-3 text-sm text-slate-600">{children}</div>
    </aside>
  );
}
