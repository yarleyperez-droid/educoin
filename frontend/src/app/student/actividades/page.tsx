'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  IconArrowRight,
  IconBookOpen,
} from '@/components/ui';
import { listarPublicadas } from '@/features/estudiante/api/actividades-estudiante';
import { listarEstadosEntregas } from '@/features/estudiante/api/entregas';
import {
  listarInscripciones,
  type Inscripcion,
} from '@/features/estudiante/api/inscripciones';
import {
  FiltrosActividades,
  TarjetaActividad,
  filtrarActividades,
  type EstadosEntregas,
  type FiltroEstadoActividad,
} from '@/features/estudiante/componentes/actividades-filtros';
import type { ActividadResumen } from '@/features/estudiante/contrato/cuestionario';
import { ApiError } from '@/lib/api-client';

/** Actividades visibles por materia antes de ir a la vista completa. */
const ACTIVIDADES_EN_RESUMEN = 3;

interface ClaseConActividades {
  inscripcion: Inscripcion;
  actividades: ActividadResumen[];
  estados: EstadosEntregas;
}

export default function ActividadesEstudiantePage() {
  const router = useRouter();
  const [clases, setClases] = useState<ClaseConActividades[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [filtroEstado, setFiltroEstado] =
    useState<FiltroEstadoActividad>('todas');
  const [filtroMateria, setFiltroMateria] = useState('todas');

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const { data: inscripciones } = await listarInscripciones();

        if (inscripciones.length === 0) {
          if (vigente) setClases([]);
          return;
        }

        const [listas, estados] = await Promise.all([
          Promise.all(
            inscripciones.map((inscripcion) =>
              listarPublicadas(inscripcion.id, 1, 50),
            ),
          ),
          Promise.all(
            inscripciones.map((inscripcion) =>
              listarEstadosEntregas(inscripcion.id),
            ),
          ),
        ]);

        if (vigente) {
          setClases(
            inscripciones.map((inscripcion, indice) => ({
              inscripcion,
              actividades: listas[indice]?.data ?? [],
              estados: estados[indice] ?? {},
            })),
          );
        }
      } catch (e) {
        if (vigente) {
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

  const materias = clases.map(({ inscripcion }) => ({
    id: inscripcion.id,
    nombre: inscripcion.clase.nombre,
  }));

  const visibles = clases
    .filter(
      ({ inscripcion }) =>
        filtroMateria === 'todas' || inscripcion.id === filtroMateria,
    )
    .map((clase) => ({
      ...clase,
      filtradas: filtrarActividades(
        clase.actividades,
        clase.estados,
        filtroEstado,
      ),
    }))
    .filter(
      ({ filtradas }) => filtroEstado === 'todas' || filtradas.length > 0,
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
            Actividades publicadas de las clases en las que estás inscrito. Filtra por
            estado o materia, y entra a una materia para verlas todas.
          </p>
        </div>
        <span className='inline-flex items-center gap-1.5 self-start rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700'>
          <IconBookOpen className='h-4 w-4' />
          {totalActividades} publicadas
        </span>
      </div>

      {clases.length === 0 ? (
        <EstadoVacio
          titulo='Aún no estás en ninguna clase'
          descripcion='Pide el código a tu profesor y únete desde el panel.'
          accion={{
            texto: 'Unirme a una clase',
            alHacerClic: () => router.push('/student'),
          }}
        />
      ) : (
        <>
          <FiltrosActividades
            estado={filtroEstado}
            alCambiarEstado={setFiltroEstado}
            materias={materias}
            materia={filtroMateria}
            alCambiarMateria={setFiltroMateria}
          />

          {visibles.length === 0 && (
            <EstadoVacio
              titulo='Sin actividades para este filtro'
              descripcion='Prueba con otro estado o cambia de materia.'
            />
          )}

          {visibles.map(({ inscripcion, estados, filtradas }) => (
            <section
              key={inscripcion.id}
              className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
            >
              <div className='mb-4 flex flex-wrap items-center gap-2'>
                <span className='rounded-lg bg-indigo-100 p-1.5 text-indigo-600'>
                  <IconBookOpen className='h-4 w-4' />
                </span>
                <h2 className='text-base font-semibold text-slate-900'>
                  {inscripcion.clase.nombre}
                </h2>
                <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'>
                  {filtradas.length} activid{filtradas.length === 1 ? 'ad' : 'ades'}
                </span>
                <Link
                  href={`/student/actividades/materia/${inscripcion.id}`}
                  className='ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
                >
                  Ver materia
                  <IconArrowRight className='h-3 w-3' />
                </Link>
              </div>

              {filtradas.length === 0 ? (
                <p className='rounded-xl bg-slate-50 p-4 text-sm text-slate-500'>
                  Aún no hay actividades publicadas en esta clase.
                </p>
              ) : (
                <ul className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                  {filtradas
                    .slice(0, ACTIVIDADES_EN_RESUMEN)
                    .map((actividad) => (
                      <TarjetaActividad
                        key={actividad.id}
                        actividad={actividad}
                        claseNombre={inscripcion.clase.nombre}
                        estado={estados[actividad.id]}
                      />
                    ))}
                </ul>
              )}

              {filtradas.length > ACTIVIDADES_EN_RESUMEN && (
                <Link
                  href={`/student/actividades/materia/${inscripcion.id}`}
                  className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
                >
                  Ver las {filtradas.length} actividades de esta materia
                  <IconArrowRight className='h-3 w-3' />
                </Link>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
