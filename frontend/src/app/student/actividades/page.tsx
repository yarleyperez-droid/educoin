/**
 * Listado de actividades para el estudiante (`/student/actividades`)
 * — T5.8.1 (PRO-394) → T5.8.4 (PRO-397).
 *
 * Ahora consume la API real:
 *
 * 1. `GET /api/v1/enrollments` para obtener las clases en las que el
 *    estudiante está inscrito y activo.
 * 2. `GET /api/v1/enrollments/:inscripcionId/activities` para listar las
 *    actividades publicadas de cada clase.
 *
 * El resultado se agrupa por clase, cumpliendo también el requisito de
 * "mostrar las clases" en las que está registrado.
 *
 * Estados cubiertos (AGENTS.md §8): carga, vacío (sin clases / sin
 * actividades) y error con reintento.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from '@/components/ui';
import { listarPublicadas } from '@/features/estudiante/api/actividades-estudiante';
import {
  listarInscripciones,
  type Inscripcion,
} from '@/features/estudiante/api/inscripciones';
import type { ActividadResumen } from '@/features/estudiante/contrato/cuestionario';
import { ApiError } from '@/lib/api-client';

interface ClaseConActividades {
  inscripcion: Inscripcion;
  actividades: ActividadResumen[];
}

/** Agrupa actividades con la clase correspondiente. */
function agrupar(
  inscripciones: Inscripcion[],
  listas: { data: ActividadResumen[] }[],
): ClaseConActividades[] {
  return inscripciones.map((inscripcion, indice) => ({
    inscripcion,
    actividades: listas[indice]?.data ?? [],
  }));
}

function formatearFecha(fecha: string | null): string {
  if (fecha === null) return '';

  return new Date(fecha).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Listado de actividades publicadas del estudiante, agrupadas por clase.
 *
 * @returns Panel de actividades dentro del shell del panel estudiante.
 */
export default function ActividadesEstudiantePage() {
  const router = useRouter();
  const [clases, setClases] = useState<ClaseConActividades[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const { data: inscripciones } = await listarInscripciones();

        if (inscripciones.length === 0) {
          if (vigente) setClases([]);
          return;
        }

        const listas = await Promise.all(
          inscripciones.map((inscripcion) =>
            listarPublicadas(inscripcion.id, 1, 50),
          ),
        );

        if (vigente) setClases(agrupar(inscripciones, listas));
      } catch (e) {
        if (vigente) {
          setError(e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO);
        }
      } finally {
        if (vigente) setCargando(false);
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, [recarga]);

  function reintentar(): void {
    setRecarga((anterior) => anterior + 1);
    setCargando(true);
    setError(null);
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">
        Mis actividades
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Actividades publicadas de las clases en las que estás inscrito.
      </p>

      {cargando && <EstadoCarga mensaje="Cargando tus actividades…" />}

      {!cargando && error !== null && (
        <div className="mt-6">
          <EstadoError mensaje={error} alReintentar={reintentar} />
        </div>
      )}

      {!cargando && error === null && clases.length === 0 && (
        <div className="mt-6">
          <EstadoVacio
            titulo="Aún no estás en ninguna clase"
            descripcion="Pide el código a tu profesor y únete desde el panel."
            accion={{
              texto: 'Unirme a una clase',
              alHacerClic: () => router.push('/student'),
            }}
          />
        </div>
      )}

      {!cargando &&
        error === null &&
        clases.map(({ inscripcion, actividades }) => (
          <section key={inscripcion.id} className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">
              {inscripcion.clase.nombre}
            </h3>
            {actividades.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                Aún no hay actividades publicadas en esta clase.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
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
                      {actividad.cierraEn !== null
                        ? `Cierra el ${formatearFecha(actividad.cierraEn)}`
                        : `Publicada el ${formatearFecha(actividad.publicadaEn)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}
