/**
 * Piezas compartidas de "Mis Actividades": filtros y tarjeta de actividad.
 *
 * La lógica de filtrado es pura y se exporta para probarla sin DOM.
 * "Realizada" = la entrega ya salió del borrador (`submitted`, `graded` o
 * `rejected`); una actividad sin entrega o con borrador sigue pendiente.
 */

import Link from 'next/link';

import {
  IconArrowRight,
  IconCalendar,
  IconClock,
  IconCoin,
} from '@/components/ui';
import {
  BadgeModoCalificacion,
  explicacionModoCalificacion,
} from '@/features/estudiante/componentes/badge-modo-calificacion';
import type { ActividadResumen } from '@/features/estudiante/contrato/cuestionario';
import {
  etiquetaEstadoEntrega,
  type EstadoEntrega,
} from '@/features/estudiante/contrato/entregas';

/** Filtro por estado de resolución. */
export type FiltroEstadoActividad = 'todas' | 'realizadas' | 'pendientes';

/** Mapa `actividadId → estado de la entrega` (sin clave = sin entrega). */
export type EstadosEntregas = Record<string, EstadoEntrega>;

/**
 * Indica si una actividad ya fue resuelta por el estudiante.
 *
 * @param estado Estado de la entrega, o `undefined` si no existe.
 * @returns `true` si la entrega ya se envió (aunque espere calificación).
 */
export function esActividadRealizada(
  estado: EstadoEntrega | undefined,
): boolean {
  return (
    estado === 'submitted' || estado === 'graded' || estado === 'rejected'
  );
}

/**
 * Filtra actividades por estado de resolución.
 *
 * @param actividades Actividades publicadas de una materia.
 * @param estados Mapa de estados de entrega.
 * @param filtro `todas`, `realizadas` o `pendientes`.
 * @returns Las actividades que cumplen el filtro, en el mismo orden.
 */
export function filtrarActividades(
  actividades: ActividadResumen[],
  estados: EstadosEntregas,
  filtro: FiltroEstadoActividad,
): ActividadResumen[] {
  if (filtro === 'todas') return actividades;
  return actividades.filter((actividad) =>
    filtro === 'realizadas'
      ? esActividadRealizada(estados[actividad.id])
      : !esActividadRealizada(estados[actividad.id]),
  );
}

/** Opción de materia para el selector. */
export interface OpcionMateria {
  id: string;
  nombre: string;
}

interface FiltrosActividadesProps {
  estado: FiltroEstadoActividad;
  alCambiarEstado: (estado: FiltroEstadoActividad) => void;
  /** Materias disponibles; si se omite, el selector no se pinta. */
  materias?: OpcionMateria[];
  materia?: string;
  alCambiarMateria?: (materia: string) => void;
}

/**
 * Barra de filtros: estado (obligatorio) y materia (opcional).
 */
export function FiltrosActividades({
  estado,
  alCambiarEstado,
  materias,
  materia = 'todas',
  alCambiarMateria,
}: FiltrosActividadesProps) {
  return (
    <div className='flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center'>
      <label className='flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600'>
        Estado
        <select
          value={estado}
          onChange={(evento) =>
            alCambiarEstado(evento.target.value as FiltroEstadoActividad)
          }
          className='rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500'
        >
          <option value='todas'>Todas las actividades</option>
          <option value='pendientes'>Pendientes</option>
          <option value='realizadas'>Realizadas</option>
        </select>
      </label>

      {materias !== undefined && (
        <label className='flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600'>
          Materia
          <select
            value={materia}
            onChange={(evento) => alCambiarMateria?.(evento.target.value)}
            className='rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500'
          >
            <option value='todas'>Todas las materias</option>
            {materias.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function formatearFecha(fecha: string | null): string {
  if (fecha === null) return '';
  return new Date(fecha).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface TarjetaActividadProps {
  actividad: ActividadResumen;
  claseNombre: string;
  estado?: EstadoEntrega;
}

/**
 * Tarjeta de una actividad publicada, con su estado de resolución.
 */
export function TarjetaActividad({
  actividad,
  claseNombre,
  estado,
}: TarjetaActividadProps) {
  const etiquetaEstado =
    estado === undefined ? 'Pendiente' : etiquetaEstadoEntrega(estado);

  return (
    <li className='group flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50'>
      <div>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span className='rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700'>
            {claseNombre}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              esActividadRealizada(estado)
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {etiquetaEstado}
          </span>
        </div>
        <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
          <h3 className='flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900'>
            {actividad.titulo}
            <BadgeModoCalificacion modo={actividad.modoCalificacion} />
          </h3>
          <span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'>
            <IconCoin className='h-3 w-3' />
            hasta {actividad.recompensaMonedas} monedas
          </span>
        </div>
        <p className='mt-1 text-xs text-slate-500'>
          {explicacionModoCalificacion(actividad.modoCalificacion)}
        </p>
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
        {esActividadRealizada(estado) ? 'Ver resultado' : 'Ver actividad'}
        <IconArrowRight className='h-3 w-3' />
      </Link>
    </li>
  );
}
