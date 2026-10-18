/**
 * Listado de actividades para el estudiante (`/student/actividades`)
 * — T5.8.1 (PRO-394) → T5.8.4 (PRO-397).
 *
 * Punto de acceso al cuestionario: muestra las actividades **publicadas**
 * (sin este listado la vista de T5.8.1 no sería alcanzable, spec §Alcance).
 *
 * Contrato con el backend: los datos pasan por
 * `features/estudiante/api/actividades-estudiante.ts` (API real de H3.3
 * desde T5.8.4). Los borradores jamás aparecen.
 *
 * **Limitación (T5.8.4):** el único listado del estudiante en H3.3 es
 * `GET /enrollments/:inscripcionId/activities` y el frontend no tiene el
 * `inscripcionId` (no hay endpoint que lo devuelva). Hasta que exista esa
 * vía, `listarPublicadas` devuelve `[]` y esta vista pinta su estado
 * vacío con un mensaje que explica cómo llegar a una actividad (por el
 * enlace del profesor o clase). El detalle por URL
 * (`/student/actividades/[id]`) sí funciona.
 *
 * Estados cubiertos (AGENTS.md §8): carga, vacío y error
 * (`role="alert"`).
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { listarPublicadas } from "@/features/estudiante/api/actividades-estudiante";
import type { ActividadEstudiante } from "@/features/estudiante/contrato/cuestionario";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando el listado no tiene actividades (ver limitación de T5.8.4). */
const MENSAJE_VACIO =
  "Aún no hay actividades que mostrar en este listado. Mientras tanto, abre la actividad que te comparta tu profesor con su enlace directo.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Listado de actividades publicadas del estudiante.
 *
 * @returns Tarjetas de actividades dentro del shell del panel estudiante.
 */
export default function ActividadesEstudiantePage() {
  const [actividades, setActividades] = useState<ActividadEstudiante[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const lista = await listarPublicadas();

        if (vigente) {
          setActividades(lista);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
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
  }, []);

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">
        Mis actividades
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Resuelve las actividades publicadas por tus profesores.
      </p>

      {cargando && (
        <p className="mt-6 text-sm text-neutral-500" role="status">
          Cargando…
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      )}

      {!cargando && error === null && actividades.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          {MENSAJE_VACIO}
        </p>
      )}

      {actividades.length > 0 && (
        <ul className="mt-6 space-y-3">
          {actividades.map((actividad) => (
            <li
              key={actividad.id}
              className="rounded-md border border-neutral-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/student/actividades/${actividad.id}`}
                  className="text-sm font-medium text-neutral-900 underline-offset-2 hover:underline"
                >
                  {actividad.titulo}
                </Link>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {actividad.recompensaMonedas} monedas
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {actividad.preguntas.length} pregunta
                {actividad.preguntas.length === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
