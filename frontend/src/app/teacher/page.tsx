'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  EstadoCarga,
  EstadoError,
  MENSAJE_ERROR_GENERICO,
  IconBookOpen,
  IconClasses,
  IconPlus,
  IconArrowRight,
  IconDocumentText,
} from '@/components/ui';
import { leerSesionActual } from '@/features/auth/api/auth';
import { listarActividades } from '@/features/teacher/api/actividades';
import { listarMisClases } from '@/features/teacher/api/clases';
import type { Actividad } from '@/features/teacher/tipos';
import { ApiError } from '@/lib/api-client';

/** Clase del docente con sus actividades visibles (borrador + publicadas). */
interface ClaseConActividades {
  id: string;
  nombre: string;
  estado: 'active' | 'archived';
  actividades: Actividad[];
}

export default function TeacherPage() {
  const [clases, setClases] = useState<ClaseConActividades[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const sesion = leerSesionActual();
  const nombreDocente = sesion
    ? `${sesion.nombre} ${sesion.apellido}`.trim()
    : 'Docente';

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const listado = await listarMisClases(1, 50);

        const clasesConActividades = await Promise.all(
          listado.data.map(async (clase) => {
            let actividades: Actividad[] = [];
            try {
              actividades = await listarActividades(clase.id);
            } catch {
              // Una clase sin permiso o error puntual no debe tumbar el
              // dashboard completo: se muestra sin actividades.
              actividades = [];
            }
            return {
              id: clase.id,
              nombre: clase.nombre,
              estado: clase.estado,
              actividades,
            };
          }),
        );

        if (vigente) {
          setClases(clasesConActividades);
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
  }, [recarga]);

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const clasesActivas = clases.filter((c) => c.estado === 'active');
  const totalActividades = clases.reduce(
    (suma, clase) => suma + clase.actividades.length,
    0,
  );
  const publicadas = clases.reduce(
    (suma, clase) =>
      suma + clase.actividades.filter((a) => a.estado === 'published').length,
    0,
  );
  const borradores = totalActividades - publicadas;

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando tu panel…' />
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
      {/* Hero */}
      <section className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg lg:p-8'>
        <div className='relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
          <div className='lg:max-w-xl'>
            <span className='inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm'>
              Panel Docente
            </span>
            <h1 className='mt-3 text-3xl font-bold lg:text-4xl'>
              Bienvenido, {nombreDocente}
            </h1>
            <p className='mt-2 text-indigo-100'>
              Gestiona tus clases y actividades desde un solo lugar.
            </p>
          </div>

          <div className='flex flex-col gap-2 sm:flex-row'>
            <Link
              href='/teacher/clases/nueva'
              className='inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50'
            >
              <IconPlus className='h-4 w-4' />
              Nueva Clase
            </Link>
            <Link
              href='/teacher/clases'
              className='inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/40 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10'
            >
              <IconClasses className='h-4 w-4' />
              Mis Clases
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Clases activas
            </span>
            <IconClasses className='h-5 w-5 text-indigo-500' />
          </div>
          <p
            className='mt-2 text-2xl font-bold text-slate-900'
            data-testid='clases-activas'
          >
            {clasesActivas.length}
          </p>
          <p className='mt-1 text-xs text-slate-500'>
            {clases.length} clase{clases.length === 1 ? '' : 's'} en total
          </p>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Actividades publicadas
            </span>
            <IconBookOpen className='h-5 w-5 text-emerald-500' />
          </div>
          <p
            className='mt-2 text-2xl font-bold text-slate-900'
            data-testid='actividades-publicadas'
          >
            {publicadas}
          </p>
          <p className='mt-1 text-xs text-slate-500'>
            Visibles para tus estudiantes
          </p>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Borradores
            </span>
            <IconDocumentText className='h-5 w-5 text-amber-500' />
          </div>
          <p
            className='mt-2 text-2xl font-bold text-slate-900'
            data-testid='actividades-borradores'
          >
            {borradores}
          </p>
          <p className='mt-1 text-xs text-slate-500'>
            Pendientes de publicar
          </p>
        </div>
      </section>

      {/* Resumen de clases */}
      <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div className='flex items-center justify-between'>
          <h2 className='text-lg font-semibold text-slate-900'>
            Resumen de Clases
          </h2>
          <Link
            href='/teacher/clases'
            className='inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
          >
            Ver todas
            <IconArrowRight className='h-4 w-4' />
          </Link>
        </div>

        {clases.length === 0 ? (
          <p className='mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500'>
            Aún no tienes clases. Crea tu primera clase para empezar.
          </p>
        ) : (
          <div className='mt-4 grid grid-cols-1 gap-4 md:grid-cols-2'>
            {clases.map((clase) => {
              const publicadasClase = clase.actividades.filter(
                (a) => a.estado === 'published',
              ).length;
              return (
                <Link
                  key={clase.id}
                  href={`/teacher/clases/${clase.id}`}
                  className='group rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <h3 className='truncate text-sm font-semibold text-slate-900'>
                        {clase.nombre}
                      </h3>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          clase.estado === 'active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {clase.estado === 'active' ? 'Activa' : 'Archivada'}
                      </span>
                    </div>
                    <IconArrowRight className='h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600' />
                  </div>

                  <div className='mt-3 flex items-center gap-4 text-xs text-slate-500'>
                    <span className='inline-flex items-center gap-1'>
                      <IconBookOpen className='h-3.5 w-3.5' />
                      {clase.actividades.length} actividad
                      {clase.actividades.length === 1 ? '' : 'es'}
                    </span>
                    <span className='inline-flex items-center gap-1 text-emerald-600'>
                      {publicadasClase} publicada
                      {publicadasClase === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
