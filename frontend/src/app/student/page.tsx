/**
 * Dashboard del estudiante (`/student`) — H5.7 / T5.7.3 (PRO-392).
 *
 * Punto de entrada del panel: tarjeta de **monedas ganadas** (H4.2, leídas
 * de la vista `student_coins`) y formulario de **unión a clase por código**
 * (`POST /classes/join` de H3.2, cuyo endpoint aún no existe: el contrato
 * futuro está declarado en `features/billetera/api/unirse.ts` y el 404 se
 * traduce a un mensaje amable). Además, los enlaces del hub del panel:
 * Actividades, Billetera y Canjear.
 *
 * Estados cubiertos (kit H5.2): carga y error con reintento en la tarjeta
 * de monedas; el formulario usa toast para éxito/error (H5.1).
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  MENSAJE_ERROR_GENERICO,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import { obtenerSaldo } from "@/features/billetera/api/billetera";
import { unirseAClase } from "@/features/billetera/api/unirse";
import { ApiError } from "@/lib/api-client";

/** Mensaje de éxito al enviar el código (aunque H3.2 aún no exista). */
const MENSAJE_ENVIADO =
  "Código enviado. Te avisaremos cuando la unión a clases esté disponible.";

/** Etiqueta accesible del campo de código. */
const ETIQUETA_CODIGO = "Código de la clase";

/**
 * Dashboard del estudiante: monedas ganadas, unión por código y accesos.
 *
 * @returns Panel del estudiante dentro de su shell.
 */
export default function StudentPage() {
  const { mostrar } = useToast();
  const [monedasGanadas, setMonedasGanadas] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargarMonedas(): Promise<void> {
      try {
        const saldo = await obtenerSaldo();
        if (vigente) {
          setMonedasGanadas(saldo.monedasGanadas);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setError(e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO);
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargarMonedas();

    return () => {
      vigente = false;
    };
  }, [recarga]);

  /** Reintenta cargar las monedas tras un error (evento de usuario). */
  function reintentarMonedas(): void {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  }

  /**
   * Envía el código de unión al backend (contrato supuesto de H3.2).
   *
   * @param evento Submit del formulario.
   */
  async function enviarUnion(
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    evento.preventDefault();
    const limpio = codigo.trim();
    if (limpio === "") {
      mostrar("Escribe el código de la clase.", "error");
      return;
    }
    setEnviando(true);
    try {
      await unirseAClase(limpio);
      mostrar(MENSAJE_ENVIADO, "exito");
      setCodigo("");
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-medium text-neutral-700">
          Panel Estudiante
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Resuelve actividades, gana monedas y canjéalas.
        </p>

        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          {cargando && <EstadoCarga mensaje="Cargando tus monedas…" />}

          {error !== null && !cargando && (
            <EstadoError
              mensaje={error}
              alReintentar={reintentarMonedas}
            />
          )}

          {error === null && !cargando && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
                Monedas ganadas
              </p>
              <p
                className="mt-1 text-3xl font-semibold text-amber-900"
                data-testid="monedas-ganadas"
              >
                {monedasGanadas ?? 0}
              </p>
            </>
          )}
        </div>

        <nav className="mt-6 flex flex-wrap gap-3" aria-label="Secciones">
          <Link
            href="/student/actividades"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
          >
            Mis actividades
          </Link>
          <Link
            href="/student/billetera"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
          >
            Mi billetera
          </Link>
          <Link
            href="/student/canje"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
          >
            Canjear monedas
          </Link>
        </nav>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-base font-semibold text-neutral-900">
          Unirse a una clase
        </h3>
        <p className="mt-1 text-sm text-neutral-500">
          Escribe el código que te dio tu profesor para inscribirte.
        </p>

        <form
          onSubmit={(evento) => void enviarUnion(evento)}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col">
            <label
              htmlFor="codigo-union"
              className="text-sm font-medium text-neutral-700"
            >
              {ETIQUETA_CODIGO}
            </label>
            <input
              id="codigo-union"
              type="text"
              value={codigo}
              onChange={(evento) => setCodigo(evento.target.value)}
              autoComplete="off"
              className="mt-1 w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
              placeholder="p. ej. AB12CD"
            />
          </div>
          <button
            type="submit"
            disabled={enviando}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-neutral-700 disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Unirme"}
          </button>
        </form>
      </div>
    </div>
  );
}
