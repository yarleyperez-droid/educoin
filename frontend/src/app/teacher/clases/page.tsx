'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import {
  EstadoCarga,
  EstadoError,
  IconClasses,
  IconPlus,
  IconSearch,
} from '@/components/ui';
import {
  actualizarClase,
  buscarClases,
  listarMisClases,
  type ResultadoBusquedaClases,
} from '@/features/teacher/api/clases';
import { BadgeEstado } from '@/features/teacher/componentes/badge-estado';
import type { ClaseListado } from '@/features/teacher/tipos';
import { ApiError } from '@/lib/api-client';

/** Mensaje cuando la búsqueda no llega a 3 caracteres. */
const MENSAJE_BUSQUEDA_CORTA =
  'La búsqueda debe tener al menos 3 caracteres.';

/** Mensaje cuando falla una acción sobre una fila (renombrar/archivar). */
const MENSAJE_ERROR_ACCION =
  'No se pudo completar la operación. Intenta de nuevo.';

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = 'Ocurrió un error inesperado. Intenta de nuevo.';

export default function ListadoClasesPage() {
  const [q, setQ] = useState('');
  const [qEnviada, setQEnviada] = useState('');
  const [clases, setClases] = useState<ClaseListado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState('');
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      setCargando(true);
      setErrorCarga(null);

      try {
        const texto = qEnviada.trim();
        const resultado: ResultadoBusquedaClases =
          texto.length >= 3
            ? await buscarClases(texto, 1, 50)
            : await listarMisClases(1, 50);

        if (vigente) {
          setClases(resultado.data);
        }
      } catch (e) {
        if (vigente) {
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
  }, [qEnviada, recarga]);

  function reintentar(): void {
    setRecarga((anterior) => anterior + 1);
  }

  /**
   * Procesa el envío del buscador.
   *
   * Con ≥ 3 caracteres filtra por nombre; con menos (o vacío) vuelve a
   * listar todas las clases.
   */
  function manejarBusqueda(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();

    const texto = q.trim();
    if (texto !== '' && texto.length < 3) {
      setErrorBusqueda(MENSAJE_BUSQUEDA_CORTA);
      return;
    }

    setErrorBusqueda(null);
    setQEnviada(texto);
  }

  async function guardarRenombrar(): Promise<void> {
    if (!editandoId) {
      return;
    }

    setErrorAccion(null);

    try {
      await actualizarClase(editandoId, { nombre: nombreEdicion });
      setEditandoId(null);
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      setErrorAccion(e instanceof ApiError ? e.message : MENSAJE_ERROR_ACCION);
    }
  }

  async function cambiarEstado(clase: ClaseListado): Promise<void> {
    setErrorAccion(null);

    try {
      await actualizarClase(clase.id, {
        estado: clase.estado === 'active' ? 'archived' : 'active',
      });
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      setErrorAccion(e instanceof ApiError ? e.message : MENSAJE_ERROR_ACCION);
    }
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-slate-900 lg:text-3xl'>
            Mis Clases
          </h1>
          <p className='mt-1 max-w-2xl text-sm text-slate-500'>
            Todas tus clases en un solo lugar. Entra a una para ver sus
            actividades.
          </p>
        </div>
        <Link
          href='/teacher/clases/nueva'
          className='inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'
        >
          <IconPlus className='h-4 w-4' />
          Nueva clase
        </Link>
      </div>

      {/* Buscador */}
      <div className='max-w-md'>
        <form onSubmit={manejarBusqueda} noValidate className='flex gap-2'>
          <div className='relative flex-1'>
            <label htmlFor='buscar-clase' className='sr-only'>
              Buscar clase
            </label>
            <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
            <input
              id='buscar-clase'
              type='search'
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={cargando}
              placeholder='Buscar por nombre (mínimo 3 caracteres)…'
              aria-describedby='ayuda-busqueda'
              className='w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
            />
          </div>
          <button
            type='submit'
            disabled={cargando}
            className='rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
          >
            {cargando ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        <p id='ayuda-busqueda' className='mt-1 text-xs text-slate-500'>
          Deja el campo vacío y busca para ver todas tus clases.
        </p>
        {errorBusqueda !== null && (
          <p role='alert' className='mt-1 text-xs text-red-700'>
            {errorBusqueda}
          </p>
        )}
      </div>

      {errorAccion !== null && (
        <p role='alert' className='text-sm text-red-700'>
          {errorAccion}
        </p>
      )}

      {cargando && <EstadoCarga mensaje='Cargando tus clases…' />}

      {errorCarga !== null && !cargando && (
        <EstadoError mensaje={errorCarga} alReintentar={reintentar} />
      )}

      {!cargando && errorCarga === null && clases.length === 0 && (
        <p className='rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500'>
          {q.trim().length >= 3
            ? `No encontramos clases que coincidan con «${q.trim()}».`
            : 'Aún no tienes clases. Crea tu primera clase para empezar.'}
        </p>
      )}

      {!cargando && errorCarga === null && clases.length > 0 && (
        <ul className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          {clases.map((clase) => (
            <li
              key={clase.id}
              className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
            >
              {editandoId === clase.id ? (
                <div className='space-y-3'>
                  <label
                    htmlFor={`nombre-${clase.id}`}
                    className='block text-sm font-medium text-slate-700'
                  >
                    Nuevo nombre de la clase
                  </label>
                  <input
                    id={`nombre-${clase.id}`}
                    type='text'
                    value={nombreEdicion}
                    onChange={(e) => setNombreEdicion(e.target.value)}
                    autoFocus
                    className='w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
                  />
                  <div className='flex gap-2'>
                    <button
                      type='button'
                      onClick={guardarRenombrar}
                      className='rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700'
                    >
                      Guardar
                    </button>
                    <button
                      type='button'
                      onClick={() => setEditandoId(null)}
                      className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50'
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <Link
                        href={`/teacher/clases/${clase.id}`}
                        className='flex items-center gap-2 text-base font-semibold text-slate-900 underline-offset-2 hover:underline'
                      >
                        <IconClasses className='h-5 w-5 shrink-0 text-indigo-500' />
                        <span className='truncate'>{clase.nombre}</span>
                      </Link>
                      <div className='mt-2'>
                        <BadgeEstado estado={clase.estado} />
                      </div>
                    </div>
                  </div>

                  <p className='mt-3 text-xs text-slate-500'>
                    Creada el{' '}
                    {new Date(clase.creadoEn).toLocaleDateString('es-CO')}
                  </p>

                  <div className='mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4'>
                    <Link
                      href={`/teacher/clases/${clase.id}`}
                      className='rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700'
                    >
                      Abrir clase
                    </Link>
                    <button
                      type='button'
                      onClick={() => {
                        setEditandoId(clase.id);
                        setNombreEdicion(clase.nombre);
                        setErrorAccion(null);
                      }}
                      className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50'
                    >
                      Renombrar
                    </button>
                    <button
                      type='button'
                      onClick={() => cambiarEstado(clase)}
                      className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50'
                    >
                      {clase.estado === 'active' ? 'Archivar' : 'Reactivar'}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
