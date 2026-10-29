/**
 * Edición de actividad (`/teacher/clases/[id]/actividades/[actividadId]/editar`)
 * — T5.6.3 (PRO-387).
 *
 * Reutiliza el formulario y el {@link EditorPreguntas} de T5.6.2
 * precargados con los datos de la actividad. Reglas de estado (CA 2 y 3 de
 * H5.6):
 * - **`draft`:** se puede editar y publicar desde aquí.
 * - **`published`:** la ruta pasa a **solo lectura** (resumen + aviso); no
 *   se ofrece ningún control de edición ni la reversión a borrador.
 *
 * Contrato con el backend (H3.3, T5.6.4): los datos pasan por
 * `features/teacher/api/actividades.ts` (`GET /activities/:id` para la
 * carga, `PATCH` y `POST …/publicar` para las acciones). Errores →
 * `ApiError.message` en `role="alert"` **sin limpiar lo escrito**.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { PanelLateral } from '@/components/features/panel-lateral';
import { EstadoCarga, EstadoError } from '@/components/ui';
import {
  actualizarActividad,
  obtenerActividad,
  publicarActividad,
} from "@/features/teacher/api/actividades";
import { EditorPreguntas } from "@/features/teacher/componentes/editor-preguntas";
import { BadgeEstado } from "@/features/teacher/componentes/badge-estado";
import type { Actividad } from "@/features/teacher/tipos";
import { normalizarPosiciones, type Pregunta } from "@/features/teacher/contrato/actividades";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la actividad no existe (o no es visible para el docente). */
const MENSAJE_NO_ENCONTRADA =
  "No se encontró la actividad solicitada.";

/** Mensaje cuando la recompensa viene vacía (evita que "" valga como 0). */
const MENSAJE_RECOMPENSA_VACIA =
  "recompensaMonedas: Ingresa las monedas que otorgará la actividad.";

/** Mensaje de éxito tras guardar cambios. */
const MENSAJE_GUARDADO = "Cambios guardados.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Vista de edición de una actividad.
 *
 * Componente cliente con carga inicial por `useEffect` (id de la ruta) y
 * estado controlado a mano; en `published` renderiza la variante de solo
 * lectura.
 *
 * @returns Formulario de edición o resumen de solo lectura.
 */
export default function EditarActividadPage() {
  const parametros = useParams<{ id: string; actividadId: string }>();
  const claseId = parametros.id;
  const actividadId = parametros.actividadId;

  const [cargando, setCargando] = useState(true);
  const [actividad, setActividad] = useState<Actividad | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [recompensa, setRecompensa] = useState("");
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const encontrada = await obtenerActividad(actividadId);

        if (!vigente) {
          return;
        }

        if (encontrada === null) {
          setActividad(null);
          setErrorCarga(MENSAJE_NO_ENCONTRADA);
          return;
        }

        setActividad(encontrada);
        setTitulo(encontrada.titulo);
        setDescripcion(encontrada.descripcion ?? "");
        setRecompensa(String(encontrada.recompensaMonedas));
        setPreguntas(encontrada.preguntas);
        setErrorCarga(null);
      } catch (e) {
        if (vigente) {
          setActividad(null);
          setErrorCarga(
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
  }, [actividadId]);

  /**
   * Guarda los cambios del formulario (solo en `draft`).
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarGuardar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErrorResumen(null);
    setMensajeExito(null);

    if (recompensa.trim() === "") {
      setErrorResumen(MENSAJE_RECOMPENSA_VACIA);
      return;
    }

    setGuardando(true);

    try {
      const actualizada = await actualizarActividad(actividadId, {
        titulo,
        descripcion,
        recompensaMonedas: Number(recompensa),
        preguntas: normalizarPosiciones(preguntas),
      });

      setActividad(actualizada);
      setMensajeExito(MENSAJE_GUARDADO);
    } catch (e) {
      setErrorResumen(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
      );
    } finally {
      setGuardando(false);
    }
  }

  /** Publica la actividad editada (`draft → published`). */
  async function manejarPublicar(): Promise<void> {
    setErrorResumen(null);
    setMensajeExito(null);
    setGuardando(true);

    try {
      const publicada = await publicarActividad(actividadId);
      setActividad(publicada);
    } catch (e) {
      setErrorResumen(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
      );
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return <EstadoCarga mensaje='Cargando actividad…' />;
  }

  if (actividad === null) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <EstadoError mensaje={errorCarga ?? MENSAJE_ERROR_GENERICO} />
        <Link
          href={`/teacher/clases/${claseId}`}
          className="mt-4 inline-block text-sm font-medium text-indigo-600 underline hover:text-indigo-700"
        >
          Volver al detalle de la clase
        </Link>
      </div>
    );
  }

  const esSoloLectura = actividad.estado !== "draft";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
              {esSoloLectura ? 'Actividad' : 'Editar actividad'}
            </h1>
            <BadgeEstado estado={actividad.estado} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {esSoloLectura
              ? 'La actividad está publicada: esta vista es de solo lectura.'
              : 'Ajusta el título, la recompensa y las preguntas antes de publicar.'}
          </p>
        </div>
        <Link
          href={`/teacher/clases/${claseId}`}
          className="self-start rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volver a la clase
        </Link>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <div className='w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
            {esSoloLectura ? (
              <section className='space-y-4'>
                <p
                  role='alert'
                  className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'
                >
                  Esta actividad ya está publicada y no se puede editar; tampoco
                  puede volver a borrador.
                </p>

                <div className='rounded-xl border border-slate-200 bg-slate-50/60 p-4'>
                  <p className='text-sm font-medium text-slate-900'>
                    {actividad.titulo}
                  </p>
                  {actividad.descripcion !== null && (
                    <p className='mt-1 text-sm text-slate-600'>
                      {actividad.descripcion}
                    </p>
                  )}
                  <p className='mt-2 text-xs text-slate-500'>
                    {actividad.recompensaMonedas} monedas ·{' '}
                    {actividad.preguntas.length} pregunta
                    {actividad.preguntas.length === 1 ? '' : 's'}
                  </p>

                  <ol className='mt-3 space-y-2'>
                    {actividad.preguntas.map((pregunta, indice) => (
                      <li key={indice} className='text-sm text-slate-700'>
                        <span className='font-medium'>
                          {indice + 1}. {pregunta.prompt}
                        </span>{' '}
                        <span className='text-xs text-slate-500'>
                          ({pregunta.score} ptos ·{' '}
                          {pregunta.type === 'test'
                            ? 'opción múltiple'
                            : pregunta.type === 'completion'
                              ? 'completar'
                              : pregunta.type}
                          )
                        </span>
                        {pregunta.type === 'test' && (
                          <ul className='ml-5 mt-1 list-disc text-xs text-slate-600'>
                            {pregunta.options.map((opcion, opcionIndice) => (
                              <li key={opcionIndice}>
                                {opcion.is_correct ? '✓ ' : ''}
                                {opcion.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            ) : (
              <form
                onSubmit={manejarGuardar}
                noValidate
                className='space-y-5'
              >
                <div>
                  <label
                    htmlFor='titulo-actividad'
                    className='block text-sm font-medium text-slate-700'
                  >
                    Título
                  </label>
                  <input
                    id='titulo-actividad'
                    type='text'
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    disabled={guardando}
                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
                  />
                </div>

                <div>
                  <label
                    htmlFor='descripcion-actividad'
                    className='block text-sm font-medium text-slate-700'
                  >
                    Descripción{' '}
                    <span className='text-slate-400'>(opcional)</span>
                  </label>
                  <textarea
                    id='descripcion-actividad'
                    rows={2}
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    disabled={guardando}
                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
                  />
                </div>

                <div className='max-w-[14rem]'>
                  <label
                    htmlFor='recompensa-actividad'
                    className='block text-sm font-medium text-slate-700'
                  >
                    Recompensa (monedas)
                  </label>
                  <input
                    id='recompensa-actividad'
                    type='number'
                    min={0}
                    step={1}
                    value={recompensa}
                    onChange={(e) => setRecompensa(e.target.value)}
                    disabled={guardando}
                    className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
                  />
                </div>

                <EditorPreguntas
                  preguntas={preguntas}
                  cambiarPreguntas={setPreguntas}
                  deshabilitado={guardando}
                />

                {errorResumen !== null && (
                  <p
                    role='alert'
                    className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'
                  >
                    {errorResumen}
                  </p>
                )}

                {mensajeExito !== null && (
                  <p
                    role='status'
                    className='rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800'
                  >
                    {mensajeExito}
                  </p>
                )}

                <div className='flex items-center gap-3'>
                  <button
                    type='submit'
                    disabled={guardando}
                    aria-busy={guardando}
                    className='rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                  <button
                    type='button'
                    onClick={manejarPublicar}
                    disabled={guardando}
                    className='rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    Publicar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <PanelLateral titulo='Estado de la actividad'>
          <ul className='list-disc space-y-2 pl-5'>
            <li>Borrador: puedes editarlo y publicarlo desde esta vista.</li>
            <li>
              Publicada: la vista pasa a solo lectura; no se puede editar ni
              volver a borrador.
            </li>
            <li>
              Si necesitas corregir el contenido publicado, crea una actividad
              nueva.
            </li>
          </ul>
        </PanelLateral>
      </div>
    </div>
  );
}
