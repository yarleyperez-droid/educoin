/**
 * "Mis canjes" del estudiante (`/student/canjes`) — H7.3 (canje revisable).
 *
 * Historial de los canjes del estudiante (`GET /redemptions/mine`, T7.2.5,
 * ordenados por `solicitadoEn` descendente) con el **estado real** de cada
 * uno (`redemption_status` ampliado: pending/approved/delivered/rejected +
 * legados completed/reversed) mediante el badge compartido
 * `BadgeEstadoCanje` (una sola fuente de etiquetas, AGENTS.md §8).
 *
 * Estados de UI cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **vacío** ("Aún no tienes canjes") y **error** con reintento. La
 * paginación usa la meta del backend (mismo patrón que
 * `/student/billetera`).
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import { listarMisCanjes } from "@/features/billetera/api/canje";
import {
  BadgeEstadoCanje,
  textoCostoCanje,
} from "@/features/billetera/componentes/badge-estado-canje";
import type {
  CanjeListado,
  Meta,
} from "@/features/billetera/contrato/canje";
import { ApiError } from "@/lib/api-client";

/** Tamaño de página fijo del historial (el backend acepta 1–100). */
const LIMITE_CANJES = 20;

/** Título del estado vacío. */
const TITULO_VACIO = "Aún no tienes canjes";

/** Descripción del estado vacío. */
const DESCRIPCION_VACIO =
  "Cuando canjes una recompensa, tus solicitudes aparecerán aquí con su estado.";

/**
 * Formatea la fecha de solicitud en formato local legible.
 *
 * @param iso Fecha ISO del backend.
 * @returns Fecha local, p. ej. "18/10/2026, 12:30".
 */
function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Historial de canjes del estudiante: tabla con badges por estado y
 * paginación.
 *
 * @returns Contenido del historial dentro del shell del panel estudiante.
 */
export default function MisCanjesPage() {
  const router = useRouter();
  const [canjes, setCanjes] = useState<CanjeListado[]>([]);
  const [meta, setMeta] = useState<Meta>({
    total: 0,
    page: 1,
    limit: LIMITE_CANJES,
  });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const listado = await listarMisCanjes(pagina, LIMITE_CANJES);

        if (vigente) {
          setCanjes(listado.data);
          setMeta(listado.meta);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setCanjes([]);
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

  /**
   * Cambia la página del historial (Anterior/Siguiente).
   *
   * @param nueva Página destino (1-indexada).
   */
  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  /** Reintenta la carga tras un error (H5.2). */
  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const hayAnterior = meta.page > 1;
  const haySiguiente = meta.page * meta.limit < meta.total;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
            Mis canjes
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Historial de tus solicitudes de recompensas y su estado de
            aprobación/entrega.
          </p>
        </div>
        <Link
          href="/student/canje"
          className="self-start rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Ir a la tienda
        </Link>
      </div>

      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Las monedas de un canje pendiente ya quedan <strong>reservadas</strong>:
        se descuentan de tu saldo disponible y solo se devuelven si el profesor
        rechaza la solicitud.
      </p>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {cargando && <EstadoCarga mensaje="Cargando tus canjes…" />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={reintentar} />
        )}

        {error === null && !cargando && canjes.length === 0 && (
          <EstadoVacio
            titulo={TITULO_VACIO}
            descripcion={DESCRIPCION_VACIO}
            accion={{
              texto: "Ir a la tienda",
              alHacerClic: () => router.push("/student/canje"),
            }}
          />
        )}

        {error === null && !cargando && canjes.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recompensa
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Costo
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Solicitado
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {canjes.map((canje) => (
                    <tr key={canje.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">
                          {canje.nombreItem}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {textoCostoCanje(canje.estado, canje.costoMonedas)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatearFecha(canje.solicitadoEn)}
                      </td>
                      <td className="px-4 py-3">
                        <BadgeEstadoCanje estado={canje.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav
              className="mt-4 flex items-center justify-between text-sm"
              aria-label="Paginación de tus canjes"
            >
              <button
                type="button"
                onClick={() => cambiarPagina(pagina - 1)}
                disabled={!hayAnterior}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-xs text-slate-500">
                Página {meta.page} de{" "}
                {Math.max(1, Math.ceil(meta.total / meta.limit))}
              </span>
              <button
                type="button"
                onClick={() => cambiarPagina(pagina + 1)}
                disabled={!haySiguiente}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Siguiente
              </button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
