'use client';

/**
 * Organizaciones del panel admin (`/admin/organizaciones`).
 *
 * Listado paginado (`GET /organizations`, H2.4) con filtros reales del
 * backend (`q`, `tipo`, `activa`) y formulario de alta (`POST /
 * organizations`). Tras el alta se vuelve a pedir la lista (el backend
 * es la fuente de verdad; AGENTS.md §6).
 *
 * Testids/labels preservados para `e2e/admin-panel.spec.ts`:
 * `form-organizacion`, `lista-organizaciones`, `fila-organizacion`,
 * labels `Nombre` / `Ciudad (opcional)`, botón `Crear organización` y
 * el texto de carga `Cargando organizaciones…`.
 *
 * Estados del kit H5.2: carga, error con reintento y vacío.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  mensajeDeErrorApi,
  useToast,
} from '@/components/ui';
import {
  crearOrganizacion,
  listarOrganizaciones,
  LIMITE_ORGANIZACIONES,
} from '@/features/admin/organizaciones/api/organizaciones';
import {
  TipoOrganizacionSchema,
  type ListadoOrganizaciones,
  type TipoOrganizacion,
} from '@/features/admin/organizaciones/contrato/organizaciones';
import { ApiError } from '@/lib/api-client';

/** Título del estado vacío sin filtro. */
const TITULO_VACIO = 'Aún no hay organizaciones';

/** Descripción del estado vacío sin filtro. */
const DESCRIPCION_VACIO =
  'Crea la primera institución con el formulario de arriba.';

/** Título del estado vacío con filtros activos. */
const TITULO_VACIO_FILTRO = 'Sin organizaciones con esos filtros';

/** Descripción del estado vacío con filtros. */
const DESCRIPCION_VACIO_FILTRO =
  'Ajusta la búsqueda o quita los filtros para ver todas.';

/** Etiquetas de los tipos de organización en la UI. */
const ETIQUETAS_TIPO: Record<TipoOrganizacion, string> = {
  school: 'Escuela',
  university: 'Universidad',
  other: 'Otra',
};

/** Texto de respaldo si el backend no devolviera `mensaje`. */
const MENSAJE_CREADA = 'Organización creada con éxito.';

/**
 * Vista de organizaciones del admin.
 *
 * @returns Filtros, formulario y listado dentro del shell de `/admin`.
 */
export default function OrganizacionesPage() {
  const { mostrar } = useToast();
  const [listado, setListado] = useState<ListadoOrganizaciones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /** Contador para forzar una recarga desde un evento (reintento/alta). */
  const [recarga, setRecarga] = useState(0);

  // Filtros reales del backend.
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroActiva, setFiltroActiva] = useState('');

  // Formulario de alta.
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoOrganizacion>('school');
  const [ciudad, setCiudad] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const resultado = await listarOrganizaciones({
          page: pagina,
          limit: LIMITE_ORGANIZACIONES,
          ...(busqueda.trim() !== '' ? { q: busqueda.trim() } : {}),
          ...(filtroTipo !== ''
            ? { tipo: TipoOrganizacionSchema.parse(filtroTipo) }
            : {}),
          ...(filtroActiva !== '' ? { activa: filtroActiva === 'true' } : {}),
        });
        if (vigente) {
          setListado(resultado);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setListado(null);
          setError(
            e instanceof ApiError
              ? e.message
              : 'Ocurrió un error inesperado. Intenta de nuevo.',
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
  }, [pagina, recarga, busqueda, filtroTipo, filtroActiva]);

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const cambiarFiltro = (
    actualizador: () => void,
  ): void => {
    setCargando(true);
    setPagina(1);
    actualizador();
  };

  const enviar = async (
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    evento.preventDefault();
    const nombreLimpio = nombre.trim();
    if (nombreLimpio.length < 3) {
      mostrar('El nombre debe tener al menos 3 caracteres.', 'error');
      return;
    }

    setEnviando(true);
    try {
      const creacion = await crearOrganizacion({
        nombre: nombreLimpio,
        tipo,
        ciudad: ciudad.trim(),
      });
      mostrar(creacion.mensaje || MENSAJE_CREADA, 'exito');
      setNombre('');
      setCiudad('');
      // Volver a pedir la lista (fuente de verdad: la API).
      setPagina(1);
      setCargando(true);
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), 'error');
    } finally {
      setEnviando(false);
    }
  };

  const hayAnterior = (listado?.meta.page ?? 1) > 1;
  const haySiguiente =
    listado !== null &&
    listado.meta.page * listado.meta.limit < listado.meta.total;
  const filtrando =
    busqueda.trim() !== '' || filtroTipo !== '' || filtroActiva !== '';

  return (
    <div className='space-y-6'>
      <header className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div className='space-y-1'>
          <p className='text-[11px] font-semibold uppercase tracking-wider text-indigo-600'>
            Gestión Institucional
          </p>
          <h1 className='text-2xl font-bold tracking-tight text-slate-900'>
            Organizaciones
          </h1>
          <p className='max-w-2xl text-sm text-slate-500'>
            Alta y listado de las instituciones de la plataforma.
          </p>
        </div>
      </header>

      <div className='rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
        <h2 className='text-base font-bold text-slate-900'>
          Nueva organización
        </h2>
        <p className='mt-1 text-sm text-slate-500'>
          Registra una institución educativa de la plataforma.
        </p>

        <form
          data-testid='form-organizacion'
          onSubmit={(evento) => void enviar(evento)}
          className='mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'
        >
          <div className='flex flex-col gap-1.5 sm:col-span-2'>
            <label
              htmlFor='org-nombre'
              className='text-sm font-semibold text-slate-700'
            >
              Nombre
            </label>
            <input
              id='org-nombre'
              name='nombre'
              type='text'
              autoComplete='off'
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder='Nombre de la institución'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='org-tipo'
              className='text-sm font-semibold text-slate-700'
            >
              Tipo
            </label>
            <select
              id='org-tipo'
              name='tipo'
              value={tipo}
              onChange={(evento) =>
                setTipo(TipoOrganizacionSchema.parse(evento.target.value))
              }
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              {TipoOrganizacionSchema.options.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {ETIQUETAS_TIPO[opcion]}
                </option>
              ))}
            </select>
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='org-ciudad'
              className='text-sm font-semibold text-slate-700'
            >
              Ciudad (opcional)
            </label>
            <input
              id='org-ciudad'
              name='ciudad'
              type='text'
              autoComplete='off'
              value={ciudad}
              onChange={(evento) => setCiudad(evento.target.value)}
              placeholder='Ciudad'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='flex items-end sm:col-span-2 lg:col-span-4'>
            <button
              type='submit'
              disabled={enviando}
              className='rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {enviando ? 'Enviando…' : 'Crear organización'}
            </button>
          </div>
        </form>
      </div>

      <div className='rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
          <div>
            <h2 className='text-base font-bold text-slate-900'>
              Listado
            </h2>
            {listado !== null && (
              <p className='mt-0.5 text-xs text-slate-500'>
                {listado.meta.total.toLocaleString('es-CO')} organización
                {listado.meta.total === 1 ? '' : 'es'}
                {filtrando ? ' con filtros aplicados' : ''}
              </p>
            )}
          </div>

          <div className='grid gap-2 sm:grid-cols-3 lg:w-auto'>
            <div className='relative sm:col-span-1'>
              <label htmlFor='busqueda-organizacion' className='sr-only'>
                Buscar organización
              </label>
              <input
                id='busqueda-organizacion'
                data-testid='busqueda-organizacion'
                type='search'
                value={busqueda}
                onChange={(evento) =>
                  cambiarFiltro(() => setBusqueda(evento.target.value))
                }
                placeholder='Buscar por nombre…'
                className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
              />
            </div>

            <div className='relative'>
              <label htmlFor='filtro-tipo' className='sr-only'>
                Filtrar por tipo
              </label>
              <select
                id='filtro-tipo'
                data-testid='filtro-tipo'
                value={filtroTipo}
                onChange={(evento) =>
                  cambiarFiltro(() => setFiltroTipo(evento.target.value))
                }
                className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
              >
                <option value=''>Tipo: Todos</option>
                <option value='school'>Escuela</option>
                <option value='university'>Universidad</option>
                <option value='other'>Otra</option>
              </select>
            </div>

            <div className='relative'>
              <label htmlFor='filtro-activa' className='sr-only'>
                Filtrar por estado
              </label>
              <select
                id='filtro-activa'
                data-testid='filtro-activa'
                value={filtroActiva}
                onChange={(evento) =>
                  cambiarFiltro(() => setFiltroActiva(evento.target.value))
                }
                className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
              >
                <option value=''>Estado: Todos</option>
                <option value='true'>Solo activas</option>
                <option value='false'>Solo inactivas</option>
              </select>
            </div>
          </div>
        </div>

        {cargando && <EstadoCarga mensaje='Cargando organizaciones…' />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={reintentar} />
        )}

        {error === null && !cargando && listado !== null && (
          <>
            {listado.meta.total === 0 ? (
              <EstadoVacio
                titulo={filtrando ? TITULO_VACIO_FILTRO : TITULO_VACIO}
                descripcion={
                  filtrando ? DESCRIPCION_VACIO_FILTRO : DESCRIPCION_VACIO
                }
              />
            ) : (
              <div className='mt-4 overflow-x-auto'>
                <table
                  className='w-full text-left text-sm'
                  data-testid='lista-organizaciones'
                  aria-label='Listado de organizaciones'
                >
                  <thead>
                    <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
                      <th scope='col' className='px-4 py-3'>
                        Nombre
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Tipo
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Ciudad
                      </th>
                      <th scope='col' className='px-4 py-3 text-center'>
                        Estado
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Creado
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-slate-100'>
                    {listado.data.map((organizacion) => (
                      <tr
                        key={organizacion.id}
                        data-testid='fila-organizacion'
                        className='transition-colors hover:bg-slate-50/50'
                      >
                        <td className='px-4 py-3'>
                          <span className='block font-semibold text-slate-900'>
                            {organizacion.nombre}
                          </span>
                          <span className='font-mono text-[11px] text-slate-400'>
                            ID {organizacion.id}
                          </span>
                        </td>
                        <td className='px-4 py-3'>
                          <span className='inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600'>
                            {ETIQUETAS_TIPO[organizacion.tipo]}
                          </span>
                        </td>
                        <td className='px-4 py-3 text-slate-600'>
                          {organizacion.ciudad ?? '—'}
                        </td>
                        <td className='px-4 py-3 text-center'>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              organizacion.activa
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                organizacion.activa
                                  ? 'bg-green-600'
                                  : 'bg-slate-400'
                              }`}
                              aria-hidden='true'
                            />
                            {organizacion.activa ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td className='px-4 py-3 font-mono text-[11px] text-slate-500'>
                          {new Date(organizacion.creadoEn).toLocaleDateString(
                            'es-CO',
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {listado.meta.total > 0 && (
              <div
                className='mt-4 flex items-center justify-between'
                aria-label='Paginación de organizaciones'
              >
                <span className='text-xs text-slate-500'>
                  Página {listado.meta.page} de{' '}
                  {Math.max(
                    1,
                    Math.ceil(listado.meta.total / listado.meta.limit),
                  )}
                </span>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    onClick={() => cambiarPagina(listado.meta.page - 1)}
                    disabled={!hayAnterior}
                    className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    Anterior
                  </button>
                  <button
                    type='button'
                    onClick={() => cambiarPagina(listado.meta.page + 1)}
                    disabled={!haySiguiente}
                    className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className='text-sm'>
        <Link
          href='/admin'
          className='font-semibold text-indigo-600 underline-offset-2 hover:underline'
        >
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
