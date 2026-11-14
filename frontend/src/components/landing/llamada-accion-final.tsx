/**
 * Llamada a la acción final de la landing pública.
 *
 * Sección 6 (y última) del mockup: cierre orientado a instituciones educativas
 * que quieren adoptar la plataforma, con dos botones y una fila de ventajas
 * reales del producto (sin cifras de adopción ni promesas de implantación).
 *
 * El botón "Contactar Coordinación Académica" es **solo visual** por ahora:
 * el mockup no define canal de contacto y no se inventan datos de contacto
 * reales. Ver el `TODO` del botón para el cableado futuro.
 */

import Link from "next/link";

import { IconArrowRight, IconCheckCircle } from "@/components/ui";

/** Ventajas reales de la plataforma mostradas bajo los CTAs. */
const VENTAJAS_PLATAFORMA: string[] = [
  "Acreditación automática del esfuerzo verificable",
  "Billetera digital y ranking justo para cada clase",
  "Tienda de recompensas con canje de monedas",
];

/**
 * Sección de cierre con los CTAs de institución.
 *
 * @returns Sección `#instituciones` con el llamado a la acción final.
 */
export function LlamadaAccionFinal() {
  return (
    <section
      id="instituciones"
      aria-labelledby="titulo-cta-final"
      className="scroll-mt-20 bg-surface pb-20 pt-4 sm:pt-8"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-panel border border-gold-border bg-gradient-to-br from-gold-bg via-surface to-accent-bg p-8 text-center sm:p-12">
          <h2
            id="titulo-cta-final"
            className="text-3xl font-bold leading-tight text-ink"
          >
            ¿Tu institución quiere adoptar EduCoins?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-ink2">
            EduCoins se implanta por institución educativa. Solicita una demo
            para tu centro y coordina con nuestro equipo la adopción de la
            plataforma: te acompañamos en la puesta en marcha, desde la
            configuración de cursos y clases hasta las primeras actividades en
            el aula.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-card bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Iniciar Sesión
              <IconArrowRight className="h-4 w-4" />
            </Link>
            {/*
              TODO: botón solo visual mientras se define el canal de contacto
              con coordinación académica (formulario, correo o agenda). No se
              inventan datos de contacto reales; al cablearlo, sustituir por
              el destino real (p. ej. `mailto:` o ruta de contacto).
            */}
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-card border border-edge bg-surface px-6 py-3 text-sm font-semibold text-ink2 transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Contactar Coordinación Académica
            </button>
          </div>

          <ul className="mx-auto mt-10 flex max-w-3xl flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8">
            {VENTAJAS_PLATAFORMA.map((ventaja) => (
              <li
                key={ventaja}
                className="flex items-center gap-2 text-sm font-medium text-ink2"
              >
                <IconCheckCircle className="h-4 w-4 shrink-0 text-success" />
                {ventaja}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
