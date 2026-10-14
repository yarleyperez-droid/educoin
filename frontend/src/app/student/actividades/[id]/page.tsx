/**
 * Cuestionario del estudiante (`/student/actividades/[id]`)
 * — T5.8.1 (PRO-394).
 *
 * Abre una actividad **publicada** y renderiza sus preguntas con KaTeX
 * saneado (CA 1 de H5.8). Esta tarea **no envía respuestas**: el formulario
 * operativo y el bloqueo de doble envío llegan con T5.8.2 (PRO-395).
 *
 * Contrato con el backend:
 * - Los datos llegan por `features/estudiante/api/actividades-estudiante.ts`
 *   (proyección **sin** `is_correct`/`expected_answer`; mock hoy, H3.3
 *   después).
 * - Si la actividad no existe o no está publicada → aviso + enlace al
 *   listado (nada de estados intermedios).
 *
 * Importa el CSS de KaTeX aquí porque es donde se usan las fórmulas
 * (App Router permite CSS global en cualquier componente).
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import "katex/dist/katex.min.css";

import { obtenerParaEstudiante } from "@/features/estudiante/api/actividades-estudiante";
import { PreguntaCuestionario } from "@/features/estudiante/componentes/pregunta-cuestionario";
import type { ActividadEstudiante } from "@/features/estudiante/contrato/cuestionario";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la actividad no existe o no está publicada. */
const MENSAJE_NO_ENCONTRADA =
  "No encontramos esta actividad o todavía no está publicada.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Vista del cuestionario de una actividad publicada.
 *
 * Componente cliente: carga la actividad por `id` de la ruta al montar
 * y pinta sus preguntas con {@link PreguntaCuestionario}.
 *
 * Estados cubiertos (AGENTS.md §8): carga, error y el caso "no existe /
 * no publicada".
 *
 * @returns Cabecera de la actividad y lista de preguntas.
 */
export default function CuestionarioPage() {
  const parametros = useParams<{ id: string }>();
  const actividadId = parametros.id;

  const [cargando, setCargando] = useState(true);
  const [actividad, setActividad] = useState<ActividadEstudiante | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const encontrada = await obtenerParaEstudiante(actividadId);

        if (vigente) {
          if (encontrada) {
            setActividad(encontrada);
            setError(null);
          } else {
            setActividad(null);
            setError(MENSAJE_NO_ENCONTRADA);
          }
        }
      } catch (e) {
        if (vigente) {
          setActividad(null);
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
  }, [actividadId]);

  if (cargando) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Cargando…
      </p>
    );
  }

  if (actividad === null) {
    return (
      <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <Link
          href="/student/actividades"
          className="mt-4 inline-block text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
        >
          Volver a mis actividades
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {actividad.titulo}
          </h2>
          {actividad.descripcion !== null && (
            <p className="mt-1 text-sm text-neutral-600">
              {actividad.descripcion}
            </p>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            {actividad.recompensaMonedas} monedas al completar ·{" "}
            {actividad.preguntas.length} pregunta
            {actividad.preguntas.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/student/actividades"
          className="text-sm text-neutral-600 hover:text-neutral-900"
        >
          Mis actividades
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {actividad.preguntas.map((pregunta) => (
          <PreguntaCuestionario
            key={pregunta.position}
            pregunta={pregunta}
          />
        ))}
      </div>

      <p className="mt-6 rounded-md border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
        El envío de respuestas estará disponible próximamente (T5.8.2).
      </p>
    </div>
  );
}
