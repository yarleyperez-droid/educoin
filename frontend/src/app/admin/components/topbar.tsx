'use client';

/**
 * Barra superior del panel admin.
 *
 * Mismo patrón que la topbar teacher: menú móvil a la izquierda y a la
 * derecha avatar + nombre/rol de la sesión y botón de cerrar sesión.
 */
import { leerSesionActual } from '@/features/auth/api/auth';
import { BotonCerrarSesion } from '@/features/auth/components/boton-cerrar-sesion';
import { IconMenu, IconUser } from '@/components/ui';

export function AdminTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const sesion = leerSesionActual();
  const nombreCompleto = sesion
    ? `${sesion.nombre} ${sesion.apellido}`.trim()
    : 'Administrador';

  return (
    <header className='sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-8'>
      <button
        type='button'
        onClick={onMenuClick}
        className='rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden'
        aria-label='Abrir menú'
      >
        <IconMenu className='h-6 w-6' />
      </button>

      <div className='flex flex-1 items-center justify-end gap-3'>
        <div className='flex items-center gap-2'>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700'>
            <IconUser className='h-4 w-4' />
          </div>
          <div className='hidden text-sm leading-tight md:block'>
            <p className='font-medium text-slate-900'>{nombreCompleto}</p>
            <p className='text-xs text-slate-500'>Administrador</p>
          </div>
        </div>

        <BotonCerrarSesion />
      </div>
    </header>
  );
}
