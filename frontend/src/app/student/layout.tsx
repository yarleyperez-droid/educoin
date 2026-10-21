'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { StudentSidebar } from './components/sidebar';
import { StudentTopbar } from './components/topbar';

export default function StudentLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className='flex min-h-screen bg-slate-50'>
      <div className='hidden lg:block'>
        <StudentSidebar />
      </div>

      {mobileOpen && (
        <>
          <div
            className='fixed inset-0 z-40 bg-black/50 lg:hidden'
            onClick={() => setMobileOpen(false)}
            aria-hidden='true'
          />
          <div className='fixed inset-y-0 left-0 z-50 w-64 lg:hidden'>
            <StudentSidebar onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <div className='flex min-w-0 flex-1 flex-col'>
        <StudentTopbar onMenuClick={() => setMobileOpen(true)} />
        <main className='flex-1 overflow-auto p-4 lg:p-8'>
          <div className='mx-auto max-w-7xl'>{children}</div>
        </main>
      </div>
    </div>
  );
}
