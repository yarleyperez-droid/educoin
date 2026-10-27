/**
 * Cabecera sticky de la landing pública (`/`).
 *
 * Único componente cliente de la landing: el menú hamburguesa móvil necesita
 * estado (abrir/cerrar y cerrar al navegar a un ancla); el resto de secciones
 * son Server Components (AGENTS.md §8).
 *
 * Contenido (mockup de la landing):
 * - Marca EduCoins con el tagline "Microeconomía Gamificada".
 * - Nav de anclas con scroll suave hacia las secciones de la página
 *   (`#como-funciona`, `#ecosistema`, `#billetera-y-ledger`,
 *   `#tienda-de-aula`, `#instituciones`).
 * - Acciones a la derecha: "Ver Demo Estudiante" e "Iniciar Sesión" (ambas
 *   apuntan a `/login`). No hay CTA de "Crear Cuenta": las cuentas las crea
 *   el administrador cuando una institución contacta y adopta el servicio, y
 *   no existe un flujo de registro público.
 *
 * Accesibilidad: `header` semántico, botón hamburguesa con `aria-expanded` y
 * `aria-controls`, foco visible en todos los enlaces y botones.
 */

"use client";

import Link from "next/link";
import { useState } from "react";

import { IconMenu, IconX } from "@/components/ui";

/** Anclas del nav: texto visible → id de la sección de destino. */
const ENLACES_SECCION = [
  { texto: "Cómo Funciona", href: "#como-funciona" },
  { texto: "Ecosistema Pedagógico", href: "#ecosistema" },
  { texto: "Billetera y Ledger", href: "#billetera-y-ledger" },
  { texto: "Tienda de Aula", href: "#tienda-de-aula" },
  { texto: "Instituciones", href: "#instituciones" },
] as const;

/**
 * Cabecera pública con nav de anclas y accesos de sesión.
 *
 * @returns Elemento `header` sticky con marca, navegación y CTAs.
 */
export function CabeceraLanding() {
  const [menuAbierto, setMenuAbierto] = useState(false);

  /** Cierra el menú móvil (al navegar o al pulsar de nuevo la hamburguesa). */
  function cerrarMenu(): void {
    setMenuAbierto(false);
  }

  return (
    <header className='sticky top-0 z-50 border-b border-edge bg-surface/95 backdrop-blur'>
      <div className='mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6'>
        {/* Marca */}
        <Link
          href='/'
          className='flex items-center gap-2.5 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
        >
          <span
            aria-hidden='true'
            className='flex h-9 w-9 items-center justify-center rounded-full bg-gold text-base font-bold text-white'
          >
            E
          </span>
          <span className='flex flex-col leading-tight'>
            <span className='text-lg font-bold text-ink'>EduCoins</span>
            <span className='hidden text-[11px] font-medium text-muted sm:block'>
              Microeconomía Gamificada
            </span>
          </span>
        </Link>

        {/* Nav de anclas (escritorio) */}
        <nav aria-label='Secciones de la página' className='hidden lg:block'>
          <ul className='flex items-center gap-1'>
            {ENLACES_SECCION.map((enlace) => (
              <li key={enlace.href}>
                <a
                  href={enlace.href}
                  className='rounded-card px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
                >
                  {enlace.texto}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Acciones (escritorio) */}
        <div className='hidden items-center gap-2 lg:flex'>
          <Link
            href='/login'
            className='rounded-card px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
          >
            Ver Demo Estudiante
          </Link>
          <Link
            href='/login'
            className='rounded-card border border-edge px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
          >
            Iniciar Sesión
          </Link>
        </div>

        {/* Hamburguesa (móvil) */}
        <button
          type='button'
          onClick={() => setMenuAbierto((abierto) => !abierto)}
          aria-expanded={menuAbierto}
          aria-controls='menu-movil-landing'
          className='inline-flex items-center justify-center rounded-card border border-edge p-2 text-ink2 transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 lg:hidden'
        >
          {menuAbierto ? (
            <IconX className='h-5 w-5' />
          ) : (
            <IconMenu className='h-5 w-5' />
          )}
          <span className='sr-only'>
            {menuAbierto ? "Cerrar menú" : "Abrir menú"}
          </span>
        </button>
      </div>

      {/* Panel móvil */}
      {menuAbierto && (
        <nav
          id='menu-movil-landing'
          aria-label='Secciones de la página'
          className='border-t border-edge bg-surface px-4 pb-4 pt-2 lg:hidden'
        >
          <ul className='space-y-1'>
            {ENLACES_SECCION.map((enlace) => (
              <li key={enlace.href}>
                <a
                  href={enlace.href}
                  onClick={cerrarMenu}
                  className='block rounded-card px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
                >
                  {enlace.texto}
                </a>
              </li>
            ))}
          </ul>
          <div className='mt-3 space-y-2 border-t border-edge pt-3'>
            <Link
              href='/login'
              onClick={cerrarMenu}
              className='block rounded-card px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
            >
              Ver Demo Estudiante
            </Link>
            <Link
              href='/login'
              onClick={cerrarMenu}
              className='block rounded-card border border-edge px-3 py-2 text-center text-sm font-medium text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2'
            >
              Iniciar Sesión
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
