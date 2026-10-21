'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  IconBookOpen,
  IconClock,
  IconCalendar,
  IconCoin,
  IconArrowRight,
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

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando tus actividades…' />
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

  const totalActividades = clases.reduce(
    (suma, item) => suma + item.actividades.length,
    0,
  );

  return (
    <div className='space-y-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Panel de Actividades
          </p>
          <h1 className='mt-1 text-2xl font-bold text-slate-900 lg:text-3xl'>
            Mis Actividades
          </h1>
          <p className='mt-1 max-w-2xl text-sm text-slate-500'>
            Actividades publicadas de las clases en las que estás inscrito. Resuélvelas antes del cierre para ganar EduCoins.
          </p>
        </div>
        <span className='inline-flex items-center gap-1.5 self-start rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700'>
          <IconBookOpen className='h-4 w-4' />
          {totalActividades} publicadas
        </span>
      </div>

      {clases.length === 0 && (
        <EstadoVacio
          titulo='Aún no estás en ninguna clase'
          descripcion='Pide el código a tu profesor y únete desde el panel.'
          accion={{
            texto: 'Unirme a una clase',
            alHacerClic: () => router.push('/student'),
          }}
        />
      )}

      {clases.map(({ inscripcion, actividades }) => (
        <section
          key={inscripcion.id}
          className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
        >
          <div className='mb-4 flex items-center gap-2'>
            <span className='rounded-lg bg-indigo-100 p-1.5 text-indigo-600'>
              <IconBookOpen className='h-4 w-4' />
            </span>
            <h2 className='text-base font-semibold text-slate-900'>
              {inscripcion.clase.nombre}
            </h2>
            <span className='ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'>
              {actividades.length} activid{actividades.length === 1 ? 'ad' : 'ades'}
            </span>
          </div>

          {actividades.length === 0 ? (
            <p className='rounded-xl bg-slate-50 p-4 text-sm text-slate-500'>
              Aún no hay actividades publicadas en esta clase.
            </p>
          ) : (
            <ul className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              {actividades.map((actividad) => (
                <li
                  key={actividad.id}
                  className='group flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50'
                >
                  <div>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700'>
                        {inscripcion.clase.nombre}
                      </span>
                      <span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'>
                        <IconCoin className='h-3 w-3' />
                        {actividad.recompensaMonedas} monedas
                      </span>
                    </div>
                    <h3 className='mt-2 text-sm font-semibold text-slate-900'>
                      {actividad.titulo}
                    </h3>
                    <p className='mt-1 inline-flex items-center gap-1 text-xs text-slate-500'>
                      {actividad.cierraEn !== null ? (
                        <>
                          <IconClock className='h-3 w-3 text-red-500' />
                          Cierra el {formatearFecha(actividad.cierraEn)}
                        </>
                      ) : (
                        <>
                          <IconCalendar className='h-3 w-3' />
                          Publicada el {formatearFecha(actividad.publicadaEn)}
                        </>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/student/actividades/${actividad.id}`}
                    className='mt-4 inline-flex items-center gap-1 self-start rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700'
                  >
                    Ver actividad
                    <IconArrowRight className='h-3 w-3' />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
