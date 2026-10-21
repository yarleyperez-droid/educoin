'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  IconDashboard,
  IconClasses,
  IconBuilding,
  IconX,
} from '@/components/ui';

const navItems = [
  { href: '/teacher', label: 'Dashboard', icon: IconDashboard },
  { href: '/teacher/clases', label: 'Mis Clases', icon: IconClasses },
];

export function TeacherSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className='flex h-full w-64 flex-col border-r border-slate-200 bg-white'>
      <div className='flex items-center gap-3 p-4'>
        <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white'>
          E
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-bold leading-tight text-slate-900'>EduCoins</p>
          <p className='text-xs text-slate-500'>Panel Docente</p>
        </div>
        <span className='rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700'>
          Campus Beta
        </span>
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className='rounded-md p-1 text-slate-400 hover:bg-slate-100 lg:hidden'
            aria-label='Cerrar menú'
          >
            <IconX className='h-5 w-5' />
          </button>
        )}
      </div>

      <nav
        className='flex-1 overflow-y-auto px-3 py-4'
        aria-label='Navegación docente'
      >
        <p className='px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400'>
          Gestión Docente
        </p>
        <ul className='space-y-1'>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-slate-400'}`}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className='border-t border-slate-200 p-4'>
        <div className='flex items-center justify-between text-slate-500'>
          <div className='flex items-center gap-2'>
            <IconBuilding className='h-4 w-4 text-slate-400' />
            <span className='text-xs font-medium text-slate-600'>
              Col. San Agustín - Bogotá
            </span>
          </div>
          <span className='text-xs text-slate-400'>v1.2.0</span>
        </div>
      </div>
    </aside>
  );
}
