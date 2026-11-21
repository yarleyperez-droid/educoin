/**
 * Sección "Los 2 Pilares del Ecosistema EduCoins" de la landing pública.
 *
 * Sección 5 del mockup: dos tarjetas (estudiantes y profesores) con icono,
 * descripción, checklist de beneficios y badge inferior. Cada tarjeta usa el
 * color de acento de su audiencia siguiendo la convención de iconos tintados
 * de los paneles (ámbar / azul).
 *
 * Las instituciones no usan la app directamente (la usan profesores y
 * alumnos), por lo que no son un pilar propio: sus puntos útiles de
 * gobernanza y seguridad se recogen como nota breve bajo las dos tarjetas.
 */

import { IconCheckCircle, IconTrophy, IconUsers } from "@/components/ui";

/** Pilar del ecosistema dirigido a una audiencia. */
interface PilarEcosistema {
  titulo: string;
  descripcion: string;
  beneficios: string[];
  insignia: string;
  /** Clases del icono (color de acento de la audiencia). */
  claseIcono: string;
  /** Clases del contenedor del icono. */
  claseFondoIcono: string;
  Icono: typeof IconTrophy;
}

/** Los dos pilares del ecosistema EduCoins: quienes usan la app. */
const PILARES: PilarEcosistema[] = [
  {
    titulo: "Para Estudiantes",
    descripcion:
      "El esfuerzo deja de ser invisible: cada reto resuelto suma monedas, posición en el ranking y acceso a recompensas reales del aula.",
    beneficios: [
      "Billetera digital con saldo disponible e histórico de movimientos",
      "Ranking justo y transparente de la clase",
      "Recompensas canjeables por esfuerzo verificable",
      "Progreso visible actividad a actividad",
    ],
    insignia: "Progreso visible en cada reto",
    claseIcono: "text-gold-ink",
    claseFondoIcono: "border-gold-border bg-gold-bg",
    Icono: IconTrophy,
  },
  {
    titulo: "Para Profesores",
    descripcion:
      "Publicar retos, verificar respuestas y acreditar esfuerzo sin hojas de cálculo: la microeconomía se administra sola dentro del flujo de clase.",
    beneficios: [
      "Publicación de retos con recompensa configurable",
      "Verificación automática de respuestas",
      "Seguimiento del progreso de cada estudiante",
      "Reglas claras de acreditación de monedas",
    ],
    insignia: "Corrección y acreditación automáticas",
    claseIcono: "text-accent",
    claseFondoIcono: "border-accent/20 bg-accent-bg",
    Icono: IconUsers,
  },
];

/** Garantías de gobernanza y seguridad que la institución mantiene. */
const GOBERNANZA: string[] = [
  "Entorno propio por colegio y sede (multi-tenant)",
  "Seguimiento de la actividad por curso",
  "Acceso por rol para proteger los datos de cada clase",
];

/**
 * Sección de los pilares del ecosistema.
 *
 * @returns Sección `#ecosistema` con las dos audiencias del producto y la
 * nota de gobernanza para la institución.
 */
export function PilaresEcosistema() {
  return (
    <section
      id="ecosistema"
      aria-labelledby="titulo-pilares"
      className="scroll-mt-20 bg-surface py-16 sm:py-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-ink">
            Ecosistema pedagógico
          </p>
          <h2 id="titulo-pilares" className="mt-3 text-3xl font-bold text-ink">
            Los 2 Pilares del Ecosistema EduCoins
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink2">
            Una sola microeconomía compartida por estudiantes y docentes, con
            reglas claras para cada actor del aula.
          </p>
        </header>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-2">
          {PILARES.map((pilar) => {
            const IconoPilar = pilar.Icono;

            return (
              <article
                key={pilar.titulo}
                className="flex flex-col rounded-panel border border-edge bg-surface p-6 shadow-suave"
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-card border ${pilar.claseFondoIcono}`}
                >
                  <IconoPilar className={`h-5 w-5 ${pilar.claseIcono}`} />
                </span>

                <h3 className="mt-4 text-xl font-semibold text-ink">
                  {pilar.titulo}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink2">
                  {pilar.descripcion}
                </p>

                <ul className="mt-4 space-y-2.5">
                  {pilar.beneficios.map((beneficio) => (
                    <li key={beneficio} className="flex items-start gap-2.5">
                      <IconCheckCircle
                        className={`mt-0.5 h-4 w-4 shrink-0 ${pilar.claseIcono}`}
                      />
                      <span className="text-sm text-ink2">{beneficio}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 inline-flex w-fit rounded-full border border-edge bg-page px-3 py-1 text-xs font-semibold text-ink2">
                  {pilar.insignia}
                </p>
              </article>
            );
          })}
        </div>

        {/* Nota de gobernanza para la institución (no es un tercer pilar:
            la institución no usa la app, la adopta y la gobierna). */}
        <aside className="mx-auto mt-10 max-w-5xl rounded-panel border border-edge bg-page p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-ink">
            Gobernanza para tu institución
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink2">
            Las clases las viven profesores y estudiantes, pero la plataforma se
            implanta por institución: cada centro mantiene el control de sus
            datos y sus reglas.
          </p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {GOBERNANZA.map((garantia) => (
              <li key={garantia} className="flex items-start gap-2.5">
                <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span className="text-sm text-ink2">{garantia}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
