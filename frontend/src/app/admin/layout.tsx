'use client';

/**
 * Layout del panel de administración (`/admin`).
 *
 * Shell compartido con los paneles teacher/student: sidebar en flujo
 * (desktop) + drawer móvil + topbar. La protección de rol la da el
 * middleware H5.3 (`/admin/:path*`); este layout NO valida seguridad
 * (el backend rechaza igual a un no-admin).
 */
import { useState } from 'react';
import type { ReactNode } from 'react';

import { AdminSidebar } from './components/sidebar';
import { AdminTopbar } from './components/topbar';

export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className='flex min-h-screen bg-slate-50'>
      <div className='hidden lg:block'>
        <AdminSidebar />
      </div>

      {mobileOpen && (
        <>
          <div
            className='fixed inset-0 z-40 bg-black/50 lg:hidden'
            onClick={() => setMobileOpen(false)}
            aria-hidden='true'
          />
          <div className='fixed inset-y-0 left-0 z-50 w-64 lg:hidden'>
            <AdminSidebar onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <div className='flex min-w-0 flex-1 flex-col'>
        <AdminTopbar onMenuClick={() => setMobileOpen(true)} />
        <main className='flex-1 overflow-auto p-4 lg:p-8'>
          <div className='mx-auto flex w-full max-w-6xl flex-col gap-6'>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
