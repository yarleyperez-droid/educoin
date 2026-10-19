/**
 * Billetera del estudiante (`/student/billetera`) — T5.7.1 / PRO-390.
 *
 * Muestra el **saldo** (leído de la vista `student_coins` vía H4.2, nunca
 * recalculado en el front) y el **historial de movimientos** con la clase de
 * cada uno. Es el CA 1 de H5.7 (PRO-288).
 *
 * Contrato con el backend: `features/billetera/api/billetera.ts` (API real
 * de H4.2). Estados cubiertos con el kit H5.2: carga, vacío y error con
 * reintento (`role="alert"`).
 */

"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import {
  obtenerHistorial,
  obtenerSaldo,
} from "@/features/billetera/api/billetera";
import type {
  SaldoBilletera,
  TipoMovimiento,
} from "@/features/billetera/contrato/billetera";
import { ApiError } from "@/lib/api-client";

/** Tamaño de página fijo del historial (el backend acepta 1–100). */
const LIMITE_HISTORIAL = 20;

/** Título del estado vacío del historial (H5.2). */
const TITULO_VACIO = "Aún no hay movimientos";

/** Descripción del estado vacío del historial. */
const DESCRIPCION_VACIO =
  "Cuando resuelvas actividades o canjes, tus movimientos de monedas aparecerán aquí.";

/** Etiquetas en español de cada tipo de movimiento (`movement_type`). */
const ETIQUETAS_TIPO: Readonly<Record<TipoMovimiento, string>> = {
  earning: "Ganancia",
  spending: "Canje",
  reversal: "Anulación",
  adjustment: "Ajuste",
};

/**
 * Formatea una cantidad firmada con signo y unidad.
 *
 * @param cantidad Valor firmado (negativo en `spending`).
 * @returns Texto listo para mostrar, p. ej. "+120 monedas".
 */
function formatearCantidad(cantidad: number): string {
  const signo = cantidad > 0 ? "+" : "";
  return `${signo}${cantidad} monedas`;
}

/**
 * Formatea la fecha ISO de un movimiento en formato local legible.
 *
 * @param iso Fecha ISO del backend.
 * @returns Fecha local, p. ej. "18/10/2026, 12:00".
 */
function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Vista de billetera: saldo agregado e historial paginado.
 *
 * @returns Contenido de la billetera dentro del shell del panel estudiante.
 */
export default function BilleteraPage() {
  const [saldo, setSaldo] = useState<SaldoBilletera | null>(null);
  const [movimientos, setMovimientos] = useState<
    Awaited<ReturnType<typeof obtenerHistorial>>["data"]
  >([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: LIMITE_HISTORIAL });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [saldoNuevo, historial] = await Promise.all([
          obtenerSaldo(),
          obtenerHistorial(pagina, LIMITE_HISTORIAL),
        ]);
        if (vigente) {
          setSaldo(saldoNuevo);
          setMovimientos(historial.data);
          setMeta(historial.meta);
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

    void cargar();

    return () => {
      vigente = false;
    };
  }, [pagina, recarga]);

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const hayAnterior = meta.page > 1;
  const haySiguiente = meta.page * meta.limit < meta.total;

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">Mi billetera</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Tu saldo de monedas y el historial de movimientos.
      </p>

      {cargando && <EstadoCarga mensaje="Cargando tu billetera…" />}

      {error !== null && !cargando && (
        <EstadoError
          mensaje={error}
          alReintentar={reintentar}
        />
      )}

      {error === null && !cargando && saldo !== null && (
        <>
          <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-amber-800">
                Disponibles
              </dt>
              <dd
                className="mt-1 text-2xl font-semibold text-amber-900"
                data-testid="saldo-disponibles"
              >
                {saldo.monedasDisponibles}
              </dd>
            </div>
            <div className="rounded-md border border-neutral-200 p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Ganadas
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-neutral-900">
                {saldo.monedasGanadas}
              </dd>
            </div>
            <div className="rounded-md border border-neutral-200 p-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Gastadas
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-neutral-900">
                {saldo.monedasGastadas}
              </dd>
            </div>
          </dl>

          <h3 className="mt-8 text-base font-semibold text-neutral-900">
            Historial de movimientos
          </h3>

          {movimientos.length === 0 ? (
            <EstadoVacio
              titulo={TITULO_VACIO}
              descripcion={DESCRIPCION_VACIO}
            />
          ) : (
            <>
              <ul className="mt-4 space-y-2">
                {movimientos.map((movimiento) => {
                  const esGasto = movimiento.cantidad < 0;
                  return (
                    <li
                      key={movimiento.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-neutral-900">
                          {ETIQUETAS_TIPO[movimiento.tipo]}
                          <span className="ml-2 text-xs text-neutral-500">
                            {movimiento.claseNombre}
                          </span>
                        </p>
                        {movimiento.descripcion !== null && (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            {movimiento.descripcion}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {formatearFecha(movimiento.creadoEn)}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${
                          esGasto ? "text-red-700" : "text-green-700"
                        }`}
                      >
                        {formatearCantidad(movimiento.cantidad)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <nav
                className="mt-4 flex items-center justify-between text-sm"
                aria-label="Paginación del historial"
              >
                <button
                  type="button"
                  onClick={() => cambiarPagina(pagina - 1)}
                  disabled={!hayAnterior}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-neutral-500" role="status">
                  Página {meta.page} de {Math.max(1, Math.ceil(meta.total / meta.limit))}
                </span>
                <button
                  type="button"
                  onClick={() => cambiarPagina(pagina + 1)}
                  disabled={!haySiguiente}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
