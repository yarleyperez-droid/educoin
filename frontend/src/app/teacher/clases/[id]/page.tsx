/**
 * Detalle de clase y listado de sus actividades
 * (`/teacher/clases/[id]`) — T5.6.3 (PRO-387).
 *
 * Muestra la cabecera de la clase (nombre + estado), su **código de
 * unión copiable** (vuelve a estar disponible aquí aunque ya no se esté
 * en la tarjeta de éxito de creación) y su lista de
 * actividades con badge, las acciones de edición **solo en `draft`**
 * ("Editar" y "Publicar") y el enlace **"Ver entregas"** en `published`
 * (T5.9.1: entrada a la cola de calificación). No se ofrece la reversión
 * a borrador (CA 3 de H5.6).
 *
 * Contrato con el backend (H3.1/H3.3, T5.6.4):
 * - Clase: `obtenerClase` → `GET /classes/:id` (async; `404` → `null`).
 * - Actividades: `listarActividades`/`publicarActividad` →
 *   `GET /classes/:id/activities` y `POST /activities/:id/publicar`.
 *   El listado real **no trae `preguntas`** (solo el detalle), así que la
 *   fila muestra monedas y fecha de publicación, nunca el conteo.
 * - Errores → `ApiError.message` en `role="alert"`.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  listarActividades,
  publicarActividad,
} from "@/features/teacher/api/actividades";
import { obtenerClase } from "@/features/teacher/api/clases";
import { BadgeEstado } from "@/features/teacher/componentes/badge-estado";
import { CodigoUnion } from "@/features/teacher/componentes/codigo-union";
import type { Actividad, Clase } from "@/features/teacher/tipos";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la clase no existe (o no pertenece al profesor). */
const MENSAJE_CLASE_NO_ENCONTRADA = "No se encontró la clase solicitada.";

/** Mensaje cuando falla una acción sobre una actividad. */
const MENSAJE_ERROR_ACCION =
  "No se pudo completar la operación. Intenta de nuevo.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Detalle de clase con su listado de actividades.
 *
 * Componente cliente: carga la clase y sus actividades al montar
 * (`useEffect` con `id` de la ruta) y gestiona las acciones de publicar.
 *
 * Estados cubiertos (AGENTS.md §8): **carga** (`cargando`), **vacío**
 * (sin actividades) y **error** (`role="alert"`, tanto de carga como de
 * acciones).
 *
 * @returns Cabecera de clase y tabla de actividades.
 */
export default function DetalleClasePage() {
  const parametros = useParams<{ id: string }>();
  const claseId = parametros.id;

  const [cargando, setCargando] = useState(true);
  const [clase, setClase] = useState<Clase | null>(null);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [publicandoId, setPublicandoId] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [claseEncontrada, lista] = await Promise.all([
          obtenerClase(claseId),
          listarActividades(claseId),
        ]);

        if (!vigente) {
          return;
        }

        if (claseEncontrada === null) {
          setClase(null);
          setActividades([]);
          setError(MENSAJE_CLASE_NO_ENCONTRADA);
          return;
        }

        setClase(claseEncontrada);
        setActividades(lista);
        setError(null);
      } catch (e) {
        if (vigente) {
          setClase(null);
          setActividades([]);
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
  }, [claseId]);

  /**
   * Publica una actividad de la lista (`draft → published`).
   *
   * @param actividadId Identificador de la actividad a publicar.
   */
  async function manejarPublicar(actividadId: string): Promise<void> {
    setErrorAccion(null);
    setPublicandoId(actividadId);

    try {
      const publicada = await publicarActividad(actividadId);
      setActividades((previas) =>
        previas.map((actividad) =>
          actividad.id === publicada.id ? publicada : actividad,
        ),
      );
    } catch (e) {
      setErrorAccion(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_ACCION,
      );
    } finally {
      setPublicandoId(null);
    }
  }

  if (cargando) {
    return (
      <p className="text-sm text-slate-500" role="status">
        Cargando…
      </p>
    );
  }

  if (clase === null) {
    return (
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <Link
          href="/teacher/clases"
          className="mt-4 inline-block text-sm font-medium text-indigo-600 underline hover:text-indigo-700"
        >
          Volver a mis clases
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-900">
            {clase.nombre}
          </h2>
          <BadgeEstado estado={clase.estado} />
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/teacher/clases/${clase.id}/actividades/nueva`}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Nueva actividad
          </Link>
          <Link
            href="/teacher/clases"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Mis clases
          </Link>
        </div>
      </div>

      {/* El código de unión lo trae `obtenerClase` (GET /classes/:id) y
          aquí se vuelve a mostrar/copiar: al salir del diálogo de éxito
          de creación el código ya no estaba disponible en ninguna vista. */}
      <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
        <p className="text-xs font-medium text-slate-600">
          Comparte este código con tus estudiantes para que se unan a la
          clase.
        </p>
        <div className="mt-3">
          <CodigoUnion codigo={clase.codigo} />
        </div>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-800">
        Actividades
      </h3>

      {errorAccion !== null && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {errorAccion}
        </p>
      )}

      {error !== null && errorAccion === null && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {actividades.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Esta clase aún no tiene actividades.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {actividades.map((actividad) => (
            <li
              key={actividad.id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">
                    {actividad.titulo}
                  </span>
                  <BadgeEstado estado={actividad.estado} />
                </div>

                {actividad.estado === "draft" && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/teacher/clases/${clase.id}/actividades/${actividad.id}/editar`}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Editar
                    </Link>
                    <button
                      type="button"
                      onClick={() => manejarPublicar(actividad.id)}
                      disabled={publicandoId === actividad.id}
                      aria-busy={publicandoId === actividad.id}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {publicandoId === actividad.id
                        ? "Publicando…"
                        : "Publicar"}
                    </button>
                  </div>
                )}

                {actividad.estado === "published" && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/teacher/clases/${clase.id}/actividades/${actividad.id}/entregas`}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Ver entregas
                    </Link>
                  </div>
                )}
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {actividad.recompensaMonedas} monedas
                {actividad.estado === "published" && actividad.publicadaEn
                  ? ` · Publicada el ${new Date(actividad.publicadaEn).toLocaleDateString("es-CO")}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
