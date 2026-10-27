/**
 * Hero de la landing pública: mensaje de valor, CTAs y mockup decorativo.
 *
 * Sección 2 del mockup de la landing. Dos columnas en escritorio (texto +
 * mockup del navegador) y una sola columna en móvil. El `h1` de esta sección
 * es el único de la página.
 *
 * Coherencia visual: paleta de marca del prototipo
 * (`docs/prototipo-educoins.html`) — dorado para el badge y los acentos,
 * azul acento para el CTA primario (par `btn-primary` del prototipo).
 */

import Link from "next/link";

import { IconArrowRight, IconShield } from "@/components/ui";

import { MockupNavegador } from "./mockup-navegador";

/**
 * Sección principal (hero) de la landing.
 *
 * @returns Sección `#inicio` con el titular, los CTAs y el mockup visual.
 */
export function HeroInicio() {
  return (
    <section
      id="inicio"
      aria-labelledby="titulo-hero"
      className="relative overflow-hidden bg-gradient-to-b from-gold-bg/50 via-surface to-page"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:py-24">
        {/* Columna de texto */}
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-gold-border bg-gold-bg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gold-ink">
            Microeconomía pedagógica multi-tenant · Lista para el aula
          </p>

          <h1
            id="titulo-hero"
            className="mt-6 text-4xl font-bold leading-tight text-ink sm:text-5xl"
          >
            Transforma el esfuerzo académico en valor tangible.
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink2">
            EduCoins es la microeconomía del aula: los estudiantes resuelven
            retos, acumulan monedas digitales en su billetera y las canjean en
            la tienda de clase, mientras los docentes acreditan el esfuerzo con
            reglas claras y cada movimiento queda registrado con transparencia.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-card bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Iniciar Sesión en mi Colegio
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-card border border-edge bg-surface px-6 py-3 text-sm font-semibold text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Explorar Demo Interactiva
            </Link>
          </div>

          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <IconShield className="h-4 w-4 shrink-0 text-gold-ink" />
            Diseñado para instituciones educativas: los datos de cada clase
            permanecen bajo el control de la institución.
          </p>
        </div>

        {/* Columna visual */}
        <MockupNavegador />
      </div>
    </section>
  );
}
