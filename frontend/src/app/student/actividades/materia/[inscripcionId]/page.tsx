'use client';

/**
 * Vista completa de UNA materia del estudiante
 * (`/student/actividades/materia/[inscripcionId]`).
 *
 * Muestra todas las actividades publicadas de la clase (hasta el tope de
 * la API) y permite filtrar por pendientes/realizadas reutilizando las
 * piezas de "Mis Actividades".
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
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

/** Tope de la API para el listado de actividades de una clase. */
const LIMITE_ACTIVIDADES = 50;

export default function MateriaEstudiantePage() {
  const params = useParams<{ inscripcionId: string }>();
  const inscripcionId = params.inscripcionId;

  const [inscripcion, setInscripcion] = useState<Inscripcion | null>(null);
  const [actividades, setActividades] = useState<ActividadResumen[]>([]);
  const [estados, setEstados] = useState<EstadosEntregas>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [filtroEstado, setFiltroEstado] =
    useState<FiltroEstadoActividad>('todas');

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [{ data: inscripciones }, lista, estadosClase] = await Promise.all([
          listarInscripciones(),
          listarPublicadas(inscripcionId, 1, LIMITE_ACTIVIDADES),
          listarEstadosEntregas(inscripcionId),
        ]);

        const propia =
          inscripciones.find((item) => item.id === inscripcionId) ?? null;

        if (vigente) {
          setInscripcion(propia);
          setActividades(lista.data);
          setEstados(estadosClase);
          setError(null);
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
  }, [inscripcionId, recarga]);

  function reintentar(): void {
    setRecarga((anterior) => anterior + 1);
    setCargando(true);
    setError(null);
  }

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando la materia…' />
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

  if (inscripcion === null) {
    return (
      <EstadoVacio
        titulo='No encontramos esta materia'
        descripcion='Puede que ya no estés inscrito en la clase.'
      />
    );
  }

  const filtradas = filtrarActividades(actividades, estados, filtroEstado);

  return (
    <div className='space-y-6'>
      <div>
        <Link
          href='/student/actividades'
          className='inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
        >
          <IconArrowRight className='h-3 w-3 rotate-180' />
          Mis actividades
        </Link>
        <div className='mt-2 flex flex-wrap items-center gap-2'>
          <span className='rounded-lg bg-indigo-100 p-1.5 text-indigo-600'>
            <IconBookOpen className='h-4 w-4' />
          </span>
          <h1 className='text-2xl font-bold text-slate-900 lg:text-3xl'>
            {inscripcion.clase.nombre}
          </h1>
          <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'>
            {actividades.length} activid{actividades.length === 1 ? 'ad' : 'ades'}
          </span>
        </div>
      </div>

      <FiltrosActividades
        estado={filtroEstado}
        alCambiarEstado={setFiltroEstado}
      />

      {filtradas.length === 0 ? (
        <EstadoVacio
          titulo='Sin actividades para este filtro'
          descripcion='Prueba con otro estado.'
        />
      ) : (
        <ul className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          {filtradas.map((actividad) => (
            <TarjetaActividad
              key={actividad.id}
              actividad={actividad}
              claseNombre={inscripcion.clase.nombre}
              estado={estados[actividad.id]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
