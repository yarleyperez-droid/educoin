/**
 * Landing pública (`/`) — panel principal de EduCoins.
 *
 * Página pública (fuera del `config.matcher` del middleware, T5.3.2), por lo
 * que cualquiera puede verla sin sesión. Sustituye al placeholder de marca y
 * compone las secciones del mockup de la landing:
 *
 * 1. Cabecera sticky con nav de anclas (`CabeceraLanding`).
 * 2. Hero con el mensaje de valor y el mockup del aula (`HeroInicio`).
 * 3. El Ciclo de Valor Escolar en 4 Pasos (`CicloValor`).
 * 4. Los 2 Pilares del Ecosistema (`PilaresEcosistema`).
 * 5. La Regla Psicológica del Ranking Justo (`ReglaRankingJusto`).
 * 6. Llamada a la acción final (`LlamadaAccionFinal`).
 *
 * Fuente de verdad del diseño: `docs/prototipo-educoins.html` (paleta de
 * marca expuesta como tokens en `app/globals.css`). El scroll suave vive en
 * `globals.css` (`prefers-reduced-motion`) y las secciones llevan
 * `scroll-mt-20` para compensar la cabecera sticky.
 *
 * Contenido: la app aún no está lanzada al mercado, por lo que la landing no
 * muestra cifras de adopción (colegios, alumnos) ni equivalencias entre
 * EduCoins y décimas de nota. Las cuentas las crea el administrador cuando
 * una institución contacta el servicio.
 */

import type { Metadata } from "next";

import { CabeceraLanding } from "@/components/landing/cabecera-landing";
import { CicloValor } from "@/components/landing/ciclo-valor";
import { HeroInicio } from "@/components/landing/hero-inicio";
import { LlamadaAccionFinal } from "@/components/landing/llamada-accion-final";
import { PilaresEcosistema } from "@/components/landing/pilares-ecosistema";
import { ReglaRankingJusto } from "@/components/landing/regla-ranking-justo";

export const metadata: Metadata = {
  title: "EduCoins — Transforma el esfuerzo académico en valor tangible",
  description:
    "Microeconomía pedagógica para tu institución: retos con monedas, billetera digital, registro transparente de movimientos y tienda de aula.",
};

/**
 * Landing pública de EduCoins.
 *
 * @returns Página completa con cabecera, secciones del mockup y CTA final.
 */
export default function Home() {
  return (
    <>
      <CabeceraLanding />
      <main>
        <HeroInicio />
        <CicloValor />
        <PilaresEcosistema />
        <ReglaRankingJusto />
        <LlamadaAccionFinal />
      </main>
    </>
  );
}
