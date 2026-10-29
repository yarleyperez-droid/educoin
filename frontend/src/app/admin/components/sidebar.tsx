'use client';

/**
 * Sidebar del panel admin.
 *
 * Navegación persistente con las únicas secciones que existen hoy
 * (Dashboard, Organizaciones, Usuarios). El estado activo se deriva de
 * `usePathname`; el middleware H5.3 ya garantiza que solo un admin
 * llegue aquí. Mismo patrón visual que los sidebars teacher/student.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { IconBuilding, IconDashboard, IconUsers, IconX } from '@/components/ui';

/** Enlaces del nav bajo "Gestión Institucional". */
const navItems = [
  { href: '/admin', label: 'Dashboard', icon: IconDashboard },
  { href: '/admin/organizaciones', label: 'Organizaciones', icon: IconBuilding },
  { href: '/admin/usuarios', label: 'Usuarios', icon: IconUsers },
];

/**
 * Sidebar del admin.
 *
 * @param onClose Cierra el panel móvil (drawer); opcional en desktop.
 */
export function AdminSidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className='flex h-full w-64 flex-col border-r border-slate-200 bg-white'>
      <div className='flex items-center gap-3 p-4'>
        <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white'>
          E
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-bold leading-tight text-slate-900'>
            EduCoins
          </p>
          <p className='text-xs text-slate-500'>Panel Administrador</p>
        </div>
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
        aria-label='Navegación administrativa'
      >
        <p className='px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400'>
          Gestión Institucional
        </p>
        <ul className='space-y-1'>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
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
        <p className='text-xs text-slate-400'>EduCoins Admin</p>
      </div>
    </aside>
  );
}
