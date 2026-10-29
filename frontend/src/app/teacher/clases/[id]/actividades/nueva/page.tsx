/**
 * Página de creación de actividad (`/teacher/clases/[id]/actividades/nueva`)
 * — T5.6.2 (PRO-386).
 *
 * Formulario cliente con editor de preguntas que valida el JSONB contra el
 * contrato zod de `features/teacher/contrato/actividades.ts` (CA 2 y 3 de
 * H5.6):
 * - La actividad nace en **`draft`** y desde la tarjeta de éxito se puede
 *   **publicar** (`published`).
 * - Si el JSONB (o el título/recompensa) es inválido, se muestra el error
 *   en un resumen `role="alert"` y **no se pierde nada de lo escrito**:
 *   la única fuente de verdad es el estado de esta página y la fachada
 *   solo recibe datos (nunca modifica el formulario).
 *
 * Contrato con el backend:
 * - La vista **no** conoce endpoints: todo pasa por
 *   `features/teacher/api/actividades.ts` (hoy mock de H3.3, pendiente en
 *   Backlog; T5.6.4 definirá la integración real).
 * - Los errores se muestran como `error.message` de `ApiError` (mensajes
 *   en español del contrato zod), nunca `detalles` ni códigos HTTP.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { EditorPreguntas } from "@/features/teacher/componentes/editor-preguntas";
import {
  crearActividad,
  publicarActividad,
} from "@/features/teacher/api/actividades";
import type { Actividad } from "@/features/teacher/tipos";
import { normalizarPosiciones, type Pregunta } from "@/features/teacher/contrato/actividades";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la recompensa viene vacía (evita que "" valga como 0). */
const MENSAJE_RECOMPENSA_VACIA =
  "recompensaMonedas: Ingresa las monedas que otorgará la actividad.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/** Etiqueta del estado `draft` para la UI. */
const ETIQUETA_BORRADOR = "Borrador";

/** Etiqueta del estado `published` para la UI. */
const ETIQUETA_PUBLICADA = "Publicada";

/**
 * Vista de creación de actividad con editor de preguntas.
 *
 * Componente cliente (App Router) con estado controlado a mano (sin
 * `react-hook-form`, decisión vigente del proyecto). El `claseId` sale de
 * la ruta dinámica (`useParams`).
 *
 * Estados cubiertos (AGENTS.md §8):
 * - **Vacío / validación:** la fachada rechaza con `ApiError` 422 y el
 *   mensaje llega al resumen sin limpiar el formulario.
 * - **Carga:** `cargando` deshabilita el botón ("Guardando…").
 * - **Éxito:** `actividad` cambia el formulario por la tarjeta con el
 *   estado y la acción "Publicar".
 *
 * @returns Formulario de actividad dentro del shell del panel docente.
 */
export default function NuevaActividadPage() {
  const parametros = useParams<{ id: string }>();
  const claseId = parametros.id;

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [recompensa, setRecompensa] = useState("");
  const [preguntas, setPreguntas] = useState<Pregunta[]>([
    {
      type: "test",
      position: 1,
      prompt: "",
      score: 1,
      options: [
        { text: "", is_correct: true },
        { text: "", is_correct: false },
      ],
    },
  ]);

  const [cargando, setCargando] = useState(false);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [errorPublicacion, setErrorPublicacion] = useState<string | null>(null);
  const [actividad, setActividad] = useState<Actividad | null>(null);

  /**
   * Procesa el envío del formulario.
   *
   * La validación (título, recompensa, JSONB con posiciones normalizadas)
   * la hace la fachada con los esquemas zod; aquí solo se traduce el
   * resultado a la UI.
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErrorResumen(null);

    if (recompensa.trim() === "") {
      setErrorResumen(MENSAJE_RECOMPENSA_VACIA);
      return;
    }

    setCargando(true);

    try {
      const creada = await crearActividad({
        claseId,
        titulo,
        descripcion,
        recompensaMonedas: Number(recompensa),
        preguntas: normalizarPosiciones(preguntas),
      });

      setActividad(creada);
      setErrorPublicacion(null);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorResumen(e.message);
      } else {
        setErrorResumen(MENSAJE_ERROR_GENERICO);
      }
    } finally {
      setCargando(false);
    }
  }

  /** Publica la actividad recién creada (`draft → published`). */
  async function manejarPublicar(): Promise<void> {
    if (!actividad) {
      return;
    }

    setErrorPublicacion(null);
    setCargando(true);

    try {
      const publicada = await publicarActividad(actividad.id);
      setActividad(publicada);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorPublicacion(e.message);
      } else {
        setErrorPublicacion(MENSAJE_ERROR_GENERICO);
      }
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header (mismo patrón que el listado "Mis Clases"). */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
          Nueva actividad
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Crea las preguntas de la actividad. Se guardará como{" "}
          <strong>borrador</strong> y podrás publicarla después.
        </p>
      </div>

      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {actividad === null ? (
          <form onSubmit={manejarEnvio} noValidate className="space-y-5">
            <div>
              <label
                htmlFor="titulo-actividad"
                className="block text-sm font-medium text-slate-700"
              >
                Título
              </label>
              <input
                id="titulo-actividad"
                name="titulo"
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={cargando}
                placeholder="p. ej. Repaso de la unidad 1"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="descripcion-actividad"
                className="block text-sm font-medium text-slate-700"
              >
                Descripción <span className="text-slate-400">(opcional)</span>
              </label>
              <textarea
                id="descripcion-actividad"
                name="descripcion"
                rows={2}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                disabled={cargando}
                placeholder="Indicaciones para tus estudiantes"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div className="max-w-[14rem]">
              <label
                htmlFor="recompensa-actividad"
                className="block text-sm font-medium text-slate-700"
              >
                Recompensa (monedas)
              </label>
              <input
                id="recompensa-actividad"
                type="number"
                min={0}
                step={1}
                value={recompensa}
                onChange={(e) => setRecompensa(e.target.value)}
                disabled={cargando}
                placeholder="120"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <EditorPreguntas
              preguntas={preguntas}
              cambiarPreguntas={setPreguntas}
              deshabilitado={cargando}
            />

            {errorResumen !== null && (
              <p
                id="error-resumen"
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {errorResumen}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={cargando}
                aria-busy={cargando}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cargando ? "Guardando…" : "Guardar borrador"}
              </button>
              <Link
                href="/teacher"
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Volver al panel
              </Link>
            </div>
          </form>
        ) : (
          <section aria-live="polite" className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">
                  {actividad.titulo}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    actividad.estado === "published"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {actividad.estado === "published"
                    ? ETIQUETA_PUBLICADA
                    : ETIQUETA_BORRADOR}
                </span>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {actividad.preguntas.length} pregunta
                {actividad.preguntas.length === 1 ? "" : "s"} ·{" "}
                {actividad.recompensaMonedas} monedas
              </p>

              {actividad.estado === "draft" && (
                <button
                  type="button"
                  onClick={manejarPublicar}
                  disabled={cargando}
                  aria-busy={cargando}
                  className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cargando ? "Publicando…" : "Publicar"}
                </button>
              )}

              {errorPublicacion !== null && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {errorPublicacion}
                </p>
              )}
            </div>

            <p className="text-sm text-slate-500">
              {actividad.estado === "published"
                ? "La actividad ya está publicada y visible para tus estudiantes."
                : "Puedes publicarla cuando estés lista (una vez publicada no vuelve a borrador)."}
            </p>

            <div className="flex items-center gap-3">
              <Link
                href="/teacher"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Volver al panel
              </Link>
              <button
                type="button"
                onClick={() => {
                  setActividad(null);
                  setTitulo("");
                  setDescripcion("");
                  setRecompensa("");
                  setErrorResumen(null);
                  setErrorPublicacion(null);
                }}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Crear otra actividad
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
