/**
 * Bloque de código de unión de una clase (T5.6.1 / PRO-385, reutilizado
 * en el detalle T5.6.3 para que el código no desaparezca tras crear la
 * clase).
 *
 * Muestra el código en un campo de solo lectura (seleccionable como
 * fallback) y un botón "Copiar código" con feedback "¡Copiado!". Si el
 * navegador bloquea la API de portapapeles, se muestra un aviso sin
 * romper el flujo (el código queda seleccionable a mano).
 *
 * Componente cliente con estado propio (copiado + errorCopia): las
 * páginas que lo usan solo pasan el `codigo` ya cargado.
 */

"use client";

import { useEffect, useState } from "react";

import { copiarAlPortapapeles } from "@/features/teacher/util/portapapeles";

/** Texto del fallback cuando el navegador no permite copiar al portapapeles. */
const MENSAJE_COPIADO_FALLBACK =
  "No se pudo copiar automáticamente. Selecciona el código y cópialo a mano.";

/** Duración del feedback "¡Copiado!" (ms). */
const DURACION_COPIADO_MS = 2000;

/**
 * Propiedades del bloque de código de unión.
 */
interface Props {
  /** Código de unión de la clase (8 caracteres, generado por la BD). */
  codigo: string;
}

/**
 * Código de unión copiable de una clase.
 *
 * @param props `codigo` de la clase a mostrar y copiar.
 * @returns Campo de solo lectura + botón de copiar con feedback.
 */
export function CodigoUnion({ codigo }: Props) {
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState<string | null>(null);

  // Limpia el timeout de feedback si el componente se desmonta antes de
  // que venza (evita setState sobre componente desmontado).
  useEffect(() => {
    if (!copiado) {
      return;
    }

    const timeout = setTimeout(() => setCopiado(false), DURACION_COPIADO_MS);
    return () => clearTimeout(timeout);
  }, [copiado]);

  /**
   * Copia el código al portapapeles y muestra el feedback.
   *
   * Si el navegador bloquea la API, se muestra el fallback (el código
   * queda seleccionable en el campo de solo lectura) sin romper el flujo.
   */
  async function manejarCopia(): Promise<void> {
    const exito = await copiarAlPortapapeles(codigo);

    if (exito) {
      setCopiado(true);
      setErrorCopia(null);
    } else {
      setCopiado(false);
      setErrorCopia(MENSAJE_COPIADO_FALLBACK);
    }
  }

  return (
    <div>
      <label
        htmlFor="codigo-union"
        className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        Código de unión
      </label>
      <input
        id="codigo-union"
        type="text"
        readOnly
        value={codigo}
        onFocus={(e) => e.target.select()}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-center font-mono text-xl font-semibold tracking-[0.3em] text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />

      <button
        type="button"
        onClick={manejarCopia}
        className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        {copiado ? "¡Copiado!" : "Copiar código"}
      </button>

      {errorCopia !== null && (
        <p role="alert" className="mt-2 text-xs text-amber-700">
          {errorCopia}
        </p>
      )}
    </div>
  );
}
