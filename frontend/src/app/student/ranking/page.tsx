"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  IconTrophy,
  IconCoin,
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

type Pestana = "global" | "clase";

const TITULO_VACIO = "Aún no hay posiciones";
const DESCRIPCION_VACIO =
  "El ranking se ordena por monedas ganadas y aparecerá cuando alguien gane monedas.";
const TITULO_SIN_CLASES = "No estás inscrito en ninguna clase";
const DESCRIPCION_SIN_CLASES =
  "Únete a una clase con su código para ver el ranking de tus compañeros.";

function colorPodio(posicion: number): string {
  switch (posicion) {
    case 1:
      return "bg-amber-100 text-amber-700 ring-amber-200";
    case 2:
      return "bg-slate-200 text-slate-700 ring-slate-300";
    case 3:
      return "bg-orange-100 text-orange-700 ring-orange-200";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export default function RankingPage() {
  const [pestana, setPestana] = useState<Pestana>("global");
  const [pagina, setPagina] = useState(1);
  const [ranking, setRanking] = useState<RankingPaginado | null>(null);
  const [inscripciones, setInscripciones] = useState<Inscripcion[] | null>(null);
  const [claseId, setClaseId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        if (pestana === "clase" && claseId === null) {
          const inscripcionesRespuesta = await listarInscripciones();
          if (!vigente) return;

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

  const podio = ranking?.data.slice(0, 3) ?? [];

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando el ranking…' />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoError mensaje={error} alReintentar={reintentar} />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div>
        <h1 className='text-2xl font-bold text-slate-900 lg:text-3xl'>
          Tabla de Posiciones
        </h1>
        <p className='mt-1 max-w-2xl text-sm text-slate-500'>
          El ranking se calcula por monedas ganadas históricamente. Canjear monedas no hace que bajes de puesto.
        </p>
      </div>

      {/* Tabs y selector */}
      <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap gap-2' role='group' aria-label='Tipo de ranking'>
          <button
            type='button'
            aria-pressed={pestana === "global"}
            onClick={() => cambiarPestana("global")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              pestana === "global"
                ? "bg-indigo-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            General Institución
          </button>
          <button
            type='button'
            aria-pressed={pestana === "clase"}
            onClick={() => cambiarPestana("clase")}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              pestana === "clase"
                ? "bg-indigo-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Por Clase Específica
          </button>
        </div>

        {pestana === "clase" && inscripciones !== null && inscripciones.length > 1 && (
          <div className='flex items-center gap-2'>
            <label htmlFor='clase-ranking' className='text-sm font-medium text-slate-700'>
              Clase
            </label>
            <select
              id='clase-ranking'
              value={claseId ?? ""}
              onChange={(evento) => cambiarClase(evento.target.value)}
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              {inscripciones.map((inscripcion) => (
                <option key={inscripcion.id} value={inscripcion.clase.id}>
                  {inscripcion.clase.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {sinInscripciones && (
        <EstadoVacio titulo={TITULO_SIN_CLASES} descripcion={DESCRIPCION_SIN_CLASES} />
      )}

      {rankingVacio && !sinInscripciones && (
        <EstadoVacio titulo={TITULO_VACIO} descripcion={DESCRIPCION_VACIO} />
      )}

      {ranking !== null && ranking.meta.total > 0 && (
        <>
          {/* Podio */}
          {podio.length > 0 && (
            <div className='flex items-end justify-center gap-3 sm:gap-6'>
              {podio[1] && (
                <div className='flex w-28 flex-col items-center text-center sm:w-36'>
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-full ring-2 sm:h-20 sm:w-20 ${colorPodio(2)}`}
                  >
                    <span className='text-2xl font-bold'>2</span>
                  </div>
                  <p className='mt-3 text-sm font-semibold text-slate-900'>
                    {podio[1].nombres}
                  </p>
                  <p className='text-xs text-slate-500'>Medallista de Plata</p>
                  <p className='mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'>
                    <IconCoin className='h-3 w-3' />
                    {podio[1].monedasGanadas} Ganadas
                  </p>
                </div>
              )}

              {podio[0] && (
                <div className='flex w-32 flex-col items-center text-center sm:w-44'>
                  <div className='mb-2 text-amber-500'>
                    <IconTrophy className='h-6 w-6' />
                  </div>
                  <div
                    className={`flex h-20 w-20 items-center justify-center rounded-full ring-2 sm:h-24 sm:w-24 ${colorPodio(1)}`}
                  >
                    <span className='text-3xl font-bold'>1</span>
                  </div>
                  <p className='mt-3 text-base font-semibold text-slate-900'>
                    {podio[0].nombres}
                  </p>
                  <p className='text-xs text-slate-500'>Líder Absoluto</p>
                  <p className='mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-700'>
                    <IconCoin className='h-3 w-3' />
                    {podio[0].monedasGanadas} EduCoins
                  </p>
                </div>
              )}

              {podio[2] && (
                <div className='flex w-28 flex-col items-center text-center sm:w-36'>
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-full ring-2 sm:h-20 sm:w-20 ${colorPodio(3)}`}
                  >
                    <span className='text-2xl font-bold'>3</span>
                  </div>
                  <p className='mt-3 text-sm font-semibold text-slate-900'>
                    {podio[2].nombres}
                  </p>
                  <p className='text-xs text-slate-500'>Medallista de Bronce</p>
                  <p className='mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'>
                    <IconCoin className='h-3 w-3' />
                    {podio[2].monedasGanadas} Ganadas
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Tabla */}
          <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-lg font-semibold text-slate-900'>
                Clasificación General
              </h2>
            </div>

            <div className='overflow-x-auto rounded-xl border border-slate-200'>
              <table className='w-full min-w-[36rem] text-sm'>
                <thead>
                  <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
                    <th className='px-4 py-3 font-medium'>Posición</th>
                    <th className='px-4 py-3 font-medium'>Estudiante</th>
                    <th className='px-4 py-3 font-medium'>Monedas ganadas</th>
                    <th className='px-4 py-3 font-medium'>Saldo disponible</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-slate-100'>
                  {ranking.data.map((fila) => (
                    <tr key={fila.estudianteId} className='hover:bg-slate-50/50'>
                      <td className='px-4 py-3'>
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            fila.posicion <= 3
                              ? colorPodio(fila.posicion)
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {fila.posicion}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-3'>
                          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700'>
                            {fila.nombres
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </div>
                          <div>
                            <p className='font-medium text-slate-900'>{fila.nombres}</p>
                            {fila.posicion <= 3 && (
                              <p className='text-[10px] text-slate-500'>
                                {fila.posicion === 1 && "Medallista de Oro"}
                                {fila.posicion === 2 && "Medallista de Plata"}
                                {fila.posicion === 3 && "Medallista de Bronce"}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className='px-4 py-3'>
                        <span className='inline-flex items-center gap-1 font-semibold text-slate-900'>
                          <IconCoin className='h-3.5 w-3.5 text-amber-500' />
                          {fila.monedasGanadas}
                        </span>
                      </td>
                      <td className='px-4 py-3 text-slate-600'>
                        {fila.monedasDisponibles}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className='mt-4 flex items-center justify-between'>
              <span className='text-xs text-slate-500'>
                Mostrando {(ranking.meta.page - 1) * ranking.meta.limit + 1}-
                {Math.min(
                  ranking.meta.page * ranking.meta.limit,
                  ranking.meta.total,
                )}{" "}
                de {ranking.meta.total} estudiantes clasificados
              </span>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => cambiarPagina(ranking.meta.page - 1)}
                  disabled={!hayAnterior}
                  className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
                >
                  Anterior
                </button>
                <span className='rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white'>
                  {ranking.meta.page}
                </span>
                <button
                  type='button'
                  onClick={() => cambiarPagina(ranking.meta.page + 1)}
                  disabled={!haySiguiente}
                  className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
                >
                  Siguiente
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
