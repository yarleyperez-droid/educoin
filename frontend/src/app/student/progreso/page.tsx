"use client";

/**
 * Progreso del estudiante (`/student/progreso`) — T5.10.2 / PRO-404
 * (H5.10).
 *
 * Snapshot motivacional de monedas: **ganadas**, **gastadas** y
 * **disponibles**, leídos de la misma API de billetera H4.2 que usa
 * `/student/billetera` (`GET /wallet` en plano → vista `student_coins`).
 * Los valores coinciden con la billetera por construcción: misma fachada,
 * cero recálculos en el front (AGENTS.md §6).
 *
 * Estados cubiertos (kit H5.2): carga y error con reintento. No hay
 * estado vacío: si la API responde, siempre hay saldo (aunque sea0).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { obtenerSaldo } from "@/features/billetera/api/billetera";
import type { SaldoBilletera } from "@/features/billetera/contrato/billetera";
import {
  EstadoCarga,
  EstadoError,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import { ApiError } from "@/lib/api-client";

/**
 * Vista de progreso del estudiante.
 *
 * @returns Contenido del progreso dentro del shell del panel estudiante.
 */
export default function ProgresoPage() {
  const [saldo, setSaldo] = useState<SaldoBilletera | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const saldoNuevo = await obtenerSaldo();
        if (vigente) {
          setSaldo(saldoNuevo);
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
  }, [recarga]);

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">Mi progreso</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Monedas ganadas y gastadas en tus clases.
      </p>

      {cargando && <EstadoCarga mensaje="Cargando tu progreso…" />}

      {error !== null && !cargando && (
        <EstadoError mensaje={error} alReintentar={reintentar} />
      )}

      {error === null && !cargando && saldo !== null && (
        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-amber-800">
              Ganadas
            </dt>
            <dd
              className="mt-1 text-2xl font-semibold text-amber-900"
              data-testid="progreso-ganadas"
            >
              {saldo.monedasGanadas}
            </dd>
          </div>
          <div className="rounded-md border border-neutral-200 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Gastadas
            </dt>
            <dd
              className="mt-1 text-2xl font-semibold text-neutral-900"
              data-testid="progreso-gastadas"
            >
              {saldo.monedasGastadas}
            </dd>
          </div>
          <div className="rounded-md border border-neutral-200 p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Disponibles
            </dt>
            <dd
              className="mt-1 text-2xl font-semibold text-neutral-900"
              data-testid="progreso-disponibles"
            >
              {saldo.monedasDisponibles}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link
          href="/student"
          className="font-medium text-neutral-700 underline-offset-2 hover:underline"
        >
          Volver al panel
        </Link>
        <Link
          href="/student/billetera"
          className="font-medium text-neutral-700 underline-offset-2 hover:underline"
        >
          Ver historial en mi billetera
        </Link>
      </p>
    </div>
  );
}
