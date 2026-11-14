/**
 * Cola de entregas del profesor por actividad
 * (`/teacher/clases/[id]/actividades/[actividadId]/entregas`) — T5.9.1
 * (PRO-399), con el enlace a la revisión de T5.9.2 (PRO-400).
 *
 * Lista las entregas de UNA actividad publicada (CA 1 de H5.9) con
 * estudiante, estado (badge), fecha de envío, puntaje y monedas
 * otorgadas; filtra por estado y pagina con la meta del backend. Cada
 * fila enlaza a la vista de revisión y calificación
 * (`…/entregas/[entregaId]`, T5.9.2).
 *
 * Contrato con el backend (H3.5, T5.9.1):
 * - `listarCola` → `GET /activities/:id/submissions/queue?page&limit&estado`
 *   (`{ data, meta }`, `limit = 20`). El filtro `estado` solo viaja cuando
 *   es distinto de "Todas"; al cambiarlo la paginación vuelve a la
 *   página 1 (CA 2).
 * - Errores → `ApiError.message` en español dentro del `EstadoError` de
 *   H5.2 (404 anti-enumeración de actividad ajena incluido, CA 5).
 *
 * Estados cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **vacío** ("Aún no hay entregas en esta actividad") y **error** con
 * reintento (`role="alert"`).
 *
 * El badge de estado vive en `features/teacher/componentes/`
 * (`badge-estado-entrega`, T5.9.2): una sola fuente para las etiquetas y
 * colores de `submission_status`, compartida con la vista de revisión.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import { listarCola } from "@/features/teacher/api/entregas";
import { BadgeEstadoEntrega } from "@/features/teacher/componentes/badge-estado-entrega";
import type {
  ColaEntregas,
  FilaCola,
  FiltroEstado,
} from "@/features/teacher/contrato/entregas";
import { ApiError } from "@/lib/api-client";

/** Tamaño de página fijo de la cola (el backend acepta 1–50). */
const LIMITE_COLA = 20;

/** Título del estado vacío (spec CA "Cola vacía"). */
const TITULO_VACIO = "Aún no hay entregas en esta actividad";

/** Descripción del estado vacío. */
const DESCRIPCION_VACIO =
  "Cuando los estudiantes envíen su trabajo, sus entregas aparecerán aquí.";

/**
 * Opciones del filtro por estado (orden de la spec §Alcance).
 *
 * El valor `"todas"` es el único que no viaja en la query del backend.
 */
const OPCIONES_FILTRO: ReadonlyArray<{ valor: FiltroEstado; etiqueta: string }> =
  [
    { valor: "todas", etiqueta: "Todas" },
    { valor: "submitted", etiqueta: "Enviadas" },
    { valor: "graded", etiqueta: "Calificadas" },
    { valor: "rejected", etiqueta: "Rechazadas" },
    { valor: "in_progress", etiqueta: "Borradores" },
  ];

/**
 * Formatea la fecha de envío en formato local legible.
 *
 * @param iso Fecha ISO del backend; `null` en los borradores.
 * @returns Fecha local, p. ej. "18/10/2026, 12:30", o "—" si no hay envío.
 */
function formatearFecha(iso: string | null): string {
  if (iso === null) {
    return "—";
  }

  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Cola de entregas de una actividad: tabla, filtro por estado y
 * paginación.
 *
 * Componente cliente: carga la cola al montar y al cambiar de página o de
 * filtro (recarga también desde el botón "Reintentar").
 *
 * @returns Contenido de la cola dentro del shell del panel docente.
 */
export default function ColaEntregasPage() {
  const parametros = useParams<{ id: string; actividadId: string }>();
  const claseId = parametros.id;
  const actividadId = parametros.actividadId;

  const [filas, setFilas] = useState<FilaCola[]>([]);
  const [meta, setMeta] = useState<ColaEntregas["meta"]>({
    total: 0,
    page: 1,
    limit: LIMITE_COLA,
  });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState<FiltroEstado>("todas");
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const cola = await listarCola(actividadId, {
          page: pagina,
          limit: LIMITE_COLA,
          estado: filtro,
        });

        if (vigente) {
          setFilas(cola.data);
          setMeta(cola.meta);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setFilas([]);
          setError(
            e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
          );
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
  }, [actividadId, pagina, filtro, recarga]);

  /**
   * Cambia la página de la cola (Anterior/Siguiente).
   *
   * @param nueva Página destino (1-indexada).
   */
  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  /**
   * Cambia el filtro por estado y reinicia la paginación en la página 1
   * (CA 2 de la spec).
   *
   * @param nuevo Estado por el que filtrar (`"todas"` sin filtro).
   */
  const cambiarFiltro = (nuevo: FiltroEstado): void => {
    setCargando(true);
    setFiltro(nuevo);
    setPagina(1);
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
            Cola de entregas
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Entregas de la actividad, con su estado y calificación.
          </p>
        </div>
        <Link
          href={`/teacher/clases/${claseId}`}
          className="self-start rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volver
        </Link>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-2">
          <label
            htmlFor="filtro-estado"
            className="text-sm font-medium text-slate-700"
          >
            Estado
          </label>
          <select
            id="filtro-estado"
            value={filtro}
            onChange={(evento) =>
              cambiarFiltro(evento.target.value as FiltroEstado)
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {OPCIONES_FILTRO.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </select>
        </div>

        {cargando && <EstadoCarga mensaje="Cargando entregas…" />}

        {error !== null && !cargando && (
          <div className="mt-4">
            <EstadoError mensaje={error} alReintentar={reintentar} />
          </div>
        )}

        {error === null && !cargando && filas.length === 0 && (
          <div className="mt-4">
            <EstadoVacio
              titulo={TITULO_VACIO}
              descripcion={DESCRIPCION_VACIO}
            />
          </div>
        )}

        {error === null && !cargando && filas.length > 0 && (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Estudiante
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Fecha de envío
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Puntaje
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Monedas
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((fila) => (
                    <tr
                      key={fila.id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-3 pr-3">
                        <Link
                          href={`/teacher/clases/${claseId}/actividades/${actividadId}/entregas/${fila.id}`}
                          className="group rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <p className="font-medium text-slate-900 group-hover:underline">
                            {fila.estudiante.nombre} {fila.estudiante.apellido}
                          </p>
                          <p className="text-xs text-slate-500 group-hover:underline">
                            {fila.estudiante.usuario}
                          </p>
                        </Link>
                      </td>
                      <td className="py-3 pr-3">
                        <BadgeEstadoEntrega estado={fila.estado} />
                      </td>
                      <td className="py-3 pr-3 text-slate-700">
                        {formatearFecha(fila.entregadoEn)}
                      </td>
                      <td className="py-3 pr-3 text-slate-900">
                        {fila.puntaje === null ? "—" : fila.puntaje}
                      </td>
                      <td className="py-3 text-slate-900">
                        {fila.monedasOtorgadas}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav
              className="mt-4 flex items-center justify-between text-sm"
              aria-label="Paginación de la cola"
            >
              <button
                type="button"
                onClick={() => cambiarPagina(pagina - 1)}
                disabled={!hayAnterior}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-slate-500" role="status">
                Página {meta.page} de{" "}
                {Math.max(1, Math.ceil(meta.total / meta.limit))}
              </span>
              <button
                type="button"
                onClick={() => cambiarPagina(pagina + 1)}
                disabled={!haySiguiente}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
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
