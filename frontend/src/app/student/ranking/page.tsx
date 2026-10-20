"use client";

/**
 * Ranking del estudiante (`/student/ranking`) — T5.10.1 / PRO-403 (H5.10).
 *
 * Muestra el ranking **global** de la organización (`GET /rankings`) y el
 * **de mi clase** (`GET /rankings/classes/:id`), tal como los sirve la API
 * de H4.3: orden por monedas ganadas (canjear no baja de puesto) y
 * posición calculada en la vista de BD (se repite en empates). La UI solo
 * pinta; no recalcula posiciones ni monedas (AGENTS.md §6).
 *
 * La clase de la pestaña "Mi clase" se descubre con
 * `listarInscripciones()` (inscripciones `active`); si hay varias se
 * elige con un `<select>`, y si no hay ninguna se ve el estado vacío.
 *
 * Estados cubiertos (kit H5.2): carga, error con reintento y vacío
 * (`meta.total === 0` o sin inscripciones).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import {
  listarInscripciones,
  type Inscripcion,
} from "@/features/estudiante/api/inscripciones";
import {
  LIMITE_RANKING,
  obtenerRankingGlobal,
  obtenerRankingPorClase,
  type RankingPaginado,
} from "@/features/rankings/api/rankings";
import { ApiError } from "@/lib/api-client";

/** Pestañas de la vista. */
type Pestana = "global" | "clase";

/** Título del estado vacío cuando no hay posiciones que mostrar. */
const TITULO_VACIO = "Aún no hay posiciones";

/** Descripción del estado vacío del ranking global. */
const DESCRIPCION_VACIO =
  "El ranking se ordena por monedas ganadas y aparecerá cuando alguien gane monedas.";

/** Título cuando el estudiante no tiene inscripciones activas. */
const TITULO_SIN_CLASES = "No estás inscrito en ninguna clase";

/** Descripción del estado sin inscripciones (pestaña "Mi clase"). */
const DESCRIPCION_SIN_CLASES =
  "Únete a una clase con su código para ver el ranking de tus compañeros.";

/** Clase activa por defecto de la pestaña "Mi clase". */
const ETIQUETA_CLASE = "Clase";

/**
 * Vista de rankings global y por clase del estudiante.
 *
 * @returns Contenido del ranking dentro del shell del panel estudiante.
 */
export default function RankingPage() {
  const [pestana, setPestana] = useState<Pestana>("global");
  const [pagina, setPagina] = useState(1);
  const [ranking, setRanking] = useState<RankingPaginado | null>(null);
  const [inscripciones, setInscripciones] = useState<Inscripcion[] | null>(
    null,
  );
  const [claseId, setClaseId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Contador para forzar una recarga desde un evento (reintento). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        if (pestana === "clase" && claseId === null) {
          // Solo resolver la clase elegida; el ranking se pide en la
          // siguiente pasada del efecto (cuando claseId cambie).
          const inscripcionesRespuesta = await listarInscripciones();
          if (!vigente) {
            return;
          }
          const activas = inscripcionesRespuesta.data.filter(
            (inscripcion) => inscripcion.estado === "active",
          );
          setInscripciones(activas);
          setClaseId(activas[0]?.clase.id ?? null);
          setRanking(null);
          setError(null);
          setCargando(false);
          return;
        }

        const resultado =
          pestana === "clase" && claseId !== null
            ? await obtenerRankingPorClase(claseId, pagina, LIMITE_RANKING)
            : await obtenerRankingGlobal(pagina, LIMITE_RANKING);

        if (vigente) {
          setRanking(resultado);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setRanking(null);
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
  }, [pestana, pagina, claseId, recarga]);

  const cambiarPestana = (nueva: Pestana): void => {
    setCargando(true);
    setPestana(nueva);
    setPagina(1);
  };

  const cambiarClase = (nuevaClase: string): void => {
    setCargando(true);
    setClaseId(nuevaClase);
    setPagina(1);
  };

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const hayAnterior = (ranking?.meta.page ?? 1) > 1;
  const haySiguiente =
    ranking !== null &&
    ranking.meta.page * ranking.meta.limit < ranking.meta.total;

  const sinInscripciones =
    pestana === "clase" && !cargando && (inscripciones?.length ?? 0) === 0;
  const rankingVacio =
    !cargando && error === null && ranking !== null && ranking.meta.total === 0;

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">Ranking</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Posiciones por monedas ganadas: canjear no baja del puesto.
      </p>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Tipo de ranking">
        <button
          type="button"
          data-testid="pestana-ranking-global"
          aria-pressed={pestana === "global"}
          onClick={() => cambiarPestana("global")}
          className={
            pestana === "global"
              ? "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              : "rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          }
        >
          Global
        </button>
        <button
          type="button"
          data-testid="pestana-ranking-clase"
          aria-pressed={pestana === "clase"}
          onClick={() => cambiarPestana("clase")}
          className={
            pestana === "clase"
              ? "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              : "rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          }
        >
          Mi clase
        </button>
      </div>

      {pestana === "clase" &&
        inscripciones !== null &&
        inscripciones.length > 1 && (
        <div className="mt-4 flex flex-col gap-1">
          <label
            htmlFor="clase-ranking"
            className="text-sm font-medium text-neutral-700"
          >
            {ETIQUETA_CLASE}
          </label>
          <select
            id="clase-ranking"
            aria-label={ETIQUETA_CLASE}
            value={claseId ?? ""}
            onChange={(evento) => cambiarClase(evento.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {inscripciones.map((inscripcion) => (
              <option key={inscripcion.id} value={inscripcion.clase.id}>
                {inscripcion.clase.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {cargando && <EstadoCarga mensaje="Cargando el ranking…" />}

      {error !== null && !cargando && (
        <EstadoError mensaje={error} alReintentar={reintentar} />
      )}

      {sinInscripciones && (
        <EstadoVacio
          titulo={TITULO_SIN_CLASES}
          descripcion={DESCRIPCION_SIN_CLASES}
        />
      )}

      {rankingVacio && !sinInscripciones && (
        <EstadoVacio
          titulo={TITULO_VACIO}
          descripcion={DESCRIPCION_VACIO}
        />
      )}

      {error === null && !cargando && ranking !== null && ranking.meta.total > 0 && (
        <>
          <table
            className="mt-6 w-full text-sm"
            data-testid="tabla-ranking"
            aria-label="Ranking por monedas ganadas"
          >
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th scope="col" className="py-2 font-medium">
                  Posición
                </th>
                <th scope="col" className="py-2 font-medium">
                  Estudiante
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Monedas ganadas
                </th>
              </tr>
            </thead>
            <tbody>
              {ranking.data.map((fila) => (
                <tr
                  key={fila.estudianteId}
                  data-testid="fila-ranking"
                  className="border-b border-neutral-100"
                >
                  <td className="py-2 font-medium text-neutral-900">
                    {fila.posicion}°
                  </td>
                  <td className="py-2 text-neutral-700">{fila.nombres}</td>
                  <td className="py-2 text-right text-neutral-900">
                    {fila.monedasGanadas}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            className="mt-4 flex items-center justify-between"
            aria-label="Paginación del ranking"
          >
            <button
              type="button"
              onClick={() => cambiarPagina(ranking.meta.page - 1)}
              disabled={!hayAnterior}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-neutral-500">
              Página {ranking.meta.page} de{" "}
              {Math.max(1, Math.ceil(ranking.meta.total / ranking.meta.limit))}
            </span>
            <button
              type="button"
              onClick={() => cambiarPagina(ranking.meta.page + 1)}
              disabled={!haySiguiente}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </>
      )}

      <p className="mt-6 text-sm">
        <Link
          href="/student"
          className="font-medium text-neutral-700 underline-offset-2 hover:underline"
        >
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
