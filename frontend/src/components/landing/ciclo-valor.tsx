/**
 * Sección "El Ciclo de Valor Escolar en 4 Pasos" de la landing pública.
 *
 * Sección 4 del mockup: cuatro tarjetas numeradas que explican el ciclo de
 * la microeconomía del aula (publicar → resolver → acreditar → canjear).
 *
 * Anclas del nav: los pasos 03 y 04 llevan los ids `#billetera-y-ledger` y
 * `#tienda-de-aula` porque el mockup no define secciones independientes para
 * esas áreas del producto: el ledger vive en la acreditación automática y la
 * tienda en el canje por recompensas.
 */

/** Paso del ciclo de valor del aula. */
interface PasoCiclo {
  numero: string;
  titulo: string;
  descripcion: string;
  insignia: string;
  /** Id de ancla opcional para el nav de la landing. */
  id?: string;
}

/** Los cuatro pasos del ciclo de valor escolar. */
const PASOS_CICLO: PasoCiclo[] = [
  {
    numero: "01",
    titulo: "Docente Publica Retos",
    descripcion:
      "El profesor crea la actividad con su enunciado, la respuesta esperada y la recompensa en monedas que ganará quien la resuelva.",
    insignia: "Listo en minutos",
  },
  {
    numero: "02",
    titulo: "Estudiante Resuelve",
    descripcion:
      "El estudiante trabaja el reto desde su panel, envía su respuesta y recibe retroalimentación sin esperar la próxima clase.",
    insignia: "Retroalimentación inmediata",
  },
  {
    numero: "03",
    titulo: "Acreditación Automática",
    descripcion:
      "Al verificarse la respuesta, el sistema acredita las monedas en la billetera del estudiante y asienta cada movimiento en el ledger del aula.",
    insignia: "Ledger auditable",
    id: "billetera-y-ledger",
  },
  {
    numero: "04",
    titulo: "Canje por Recompensas",
    descripcion:
      "Con su saldo, el estudiante canjea monedas por las recompensas que el colegio define en la tienda de aula, con reglas claras de canje.",
    insignia: "Recompensas del aula",
    id: "tienda-de-aula",
  },
];

/**
 * Sección del ciclo de valor escolar.
 *
 * @returns Sección `#como-funciona` con los cuatro pasos numerados.
 */
export function CicloValor() {
  return (
    <section
      id="como-funciona"
      aria-labelledby="titulo-ciclo"
      className="scroll-mt-20 bg-page py-16 sm:py-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-ink">
            Cómo funciona
          </p>
          <h2 id="titulo-ciclo" className="mt-3 text-3xl font-bold text-ink">
            El Ciclo de Valor Escolar en 4 Pasos
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink2">
            Del reto que publica el docente al canje en la tienda de aula: un
            circuito cerrado donde el esfuerzo se convierte en valor tangible.
          </p>
        </header>

        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PASOS_CICLO.map((paso) => (
            <li
              key={paso.numero}
              id={paso.id}
              className="flex scroll-mt-24 flex-col rounded-panel border border-edge bg-surface p-6 shadow-suave"
            >
              <span
                aria-hidden="true"
                className="text-3xl font-bold leading-none text-gold"
              >
                {paso.numero}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-ink">
                {paso.titulo}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink2">
                {paso.descripcion}
              </p>
              <p className="mt-5 inline-flex w-fit rounded-full border border-gold-border bg-gold-bg px-3 py-1 text-xs font-semibold text-gold-ink">
                {paso.insignia}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
