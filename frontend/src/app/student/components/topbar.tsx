'use client';

import { useEffect, useState } from 'react';

import { BotonCerrarSesion } from '@/features/auth/components/boton-cerrar-sesion';
import { obtenerSaldo } from '@/features/billetera/api/billetera';
import {
  IconSearch,
  IconCoin,
  IconUser,
  IconMenu,
} from '@/components/ui';

export function StudentTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const [disponibles, setDisponibles] = useState<number | null>(null);
  const [ganadas, setGanadas] = useState<number | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargarSaldo(): Promise<void> {
      try {
        const saldo = await obtenerSaldo();
        if (vigente) {
          setDisponibles(saldo.monedasDisponibles);
          setGanadas(saldo.monedasGanadas);
        }
      } catch {
        if (vigente) {
          setDisponibles(0);
          setGanadas(0);
        }
      }
    }

    void cargarSaldo();

    return () => {
      vigente = false;
    };
  }, []);

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

      <div className='hidden flex-1 items-center justify-center lg:flex'>
        <div className='relative w-full max-w-xl'>
          <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
          <input
            type='search'
            placeholder='Buscar actividades, clases, insignias...'
            className='w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
          />
        </div>
      </div>

      <div className='flex flex-1 items-center justify-end gap-3 sm:gap-4 lg:flex-none'>
        <span className='inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-sm font-semibold text-amber-700 sm:px-3'>
          <IconCoin className='h-4 w-4' />
          <span className='hidden sm:inline'>+{disponibles ?? '—'}</span>
          <span className='hidden text-xs font-normal text-amber-600 sm:inline'>
            ({ganadas ?? '—'} ganadas)
          </span>
        </span>

        <div className='flex items-center gap-2'>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700'>
            <IconUser className='h-4 w-4' />
          </div>
          <div className='hidden text-sm leading-tight md:block'>
            <p className='font-medium text-slate-900'>Valentina Ríos</p>
            <p className='text-xs text-slate-500'>Estudiante · San Agustín</p>
          </div>
        </div>

        <BotonCerrarSesion />
      </div>
    </header>
  );
}
