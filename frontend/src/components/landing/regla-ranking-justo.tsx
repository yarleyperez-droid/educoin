/**
 * Sección "La Regla Psicológica del Ranking Justo" de la landing pública.
 *
 * Sección 6 del mockup: comparativa de dos columnas entre el sistema escolar
 * tradicional (tono de peligro) y la Regla de Honor EduCoins (tono de
 * éxito), para explicar por qué el ranking de la plataforma reconoce el
 * esfuerzo sostenido con reglas claras de puntos y canje.
 */

import { IconCheckCircle, IconX } from "@/components/ui";

/** Contraste entre el modelo tradicional y la Regla de Honor EduCoins. */
const ASPECTOS_TRADICIONAL: string[] = [
  "El esfuerzo extra rara vez se refleja en la nota final.",
  "Los rankings premian solo al primer lugar y desmotivan al resto.",
  "La motivación depende de estímulos externos de corto plazo.",
  "No queda registro claro de quién hizo qué ni cuándo.",
];

/** Ventajas de la Regla de Honor EduCoins. */
const ASPECTOS_EDUCOINS: string[] = [
  "Cada logro verificable suma puntos y monedas para quien lo demuestra.",
  "El ranking reconoce el progreso sostenido, no solo el podio.",
  "El esfuerzo acumulado se traduce en recompensas canjeables en la tienda de aula.",
  "Todo movimiento queda asentado en el ledger, transparente para el aula.",
];

/**
 * Comparativa del ranking justo.
 *
 * @returns Sección `#ranking-justo` con las dos columnas enfrentadas.
 */
export function ReglaRankingJusto() {
  return (
    <section
      id="ranking-justo"
      aria-labelledby="titulo-ranking-justo"
      className="scroll-mt-20 bg-page py-16 sm:py-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-ink">
            Motivación sostenible
          </p>
          <h2
            id="titulo-ranking-justo"
            className="mt-3 text-3xl font-bold text-ink"
          >
            La Regla Psicológica del Ranking Justo
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink2">
            Por qué EduCoins premia el esfuerzo verificable en lugar del
            rendimiento de un solo día, con reglas claras de puntos y canje
            para toda la clase.
          </p>
        </header>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* Columna tradicional (tono de peligro) */}
          <article className="rounded-panel border border-danger/30 bg-danger-bg/60 p-6 sm:p-8">
            <h3 className="flex items-center gap-2.5 text-xl font-semibold text-danger">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-danger/30 bg-surface"
              >
                <IconX className="h-4 w-4 text-danger" />
              </span>
              Sistema Escolar Tradicional
            </h3>
            <ul className="mt-6 space-y-4">
              {ASPECTOS_TRADICIONAL.map((aspecto) => (
                <li key={aspecto} className="flex items-start gap-3">
                  <IconX className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <span className="text-sm leading-relaxed text-ink2">
                    {aspecto}
                  </span>
                </li>
              ))}
            </ul>
          </article>

          {/* Columna EduCoins (tono de éxito) */}
          <article className="rounded-panel border border-success/30 bg-success-bg/60 p-6 sm:p-8">
            <h3 className="flex items-center gap-2.5 text-xl font-semibold text-success">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-success/30 bg-surface"
              >
                <IconCheckCircle className="h-4 w-4 text-success" />
              </span>
              Regla de Honor EduCoins
            </h3>
            <ul className="mt-6 space-y-4">
              {ASPECTOS_EDUCOINS.map((aspecto) => (
                <li key={aspecto} className="flex items-start gap-3">
                  <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="text-sm leading-relaxed text-ink2">
                    {aspecto}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
