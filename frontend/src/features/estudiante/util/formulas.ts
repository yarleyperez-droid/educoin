/**
 * Render de fórmulas con KaTeX, saneado (T5.8.1, PRO-394).
 *
 * ## Política de saneado (CA: "un JSONB malicioso no se ejecuta")
 *
 * 1. **Texto plano:** lo renderiza React (escapa `<script>`, `onerror`,
 *    etc.); este módulo solo lo devuelve como segmento, nunca como HTML.
 * 2. **Fórmulas:** se procesan con KaTeX en modo estrictamente seguro:
 *    - `trust: false` → KaTeX **rechaza** comandos de confianza
 *      (`\href`, `\includegraphics`, `\url`…), que son la vía clásica de
 *      inyección de `javascript:`;
 *    - `throwOnError: false` → LaTeX inválido no lanza: KaTeX lo pinta
 *      como texto de error **ya escapado**;
 *    - `strict: "ignore"` → no rompe por avisos de estilo.
 * 3. **Único `dangerouslySetInnerHTML` del flujo:** el HTML que sale de
 *    {@link renderizarFormula} es **generado por KaTeX** (que escapa su
 *    entrada); nunca es contenido del usuario en crudo. El fallback del
 *    `catch` pasa por {@link escapearHtml} por si acaso.
 *
 * El delimitador de fórmulas del MVP es `$…$` (spec §Supuestos 1).
 */

import { renderToString } from "katex";

/**
 * Segmento de un enunciado: texto literal o fórmula a renderizar.
 *
 * - `texto`: se pinta con React (escape automático).
 * - `formula`: contenido **entre** `$…$`, sin los delimitadores; el HTML lo
 *   genera KaTeX en {@link renderizarFormula}.
 */
export type Segmento =
  | { tipo: "texto"; valor: string }
  | { tipo: "formula"; valor: string };

/**
 * Escapa caracteres especiales de HTML (fallback defensivo).
 *
 * Solo se usa en el camino de error de {@link renderizarFormula}; el texto
 * normal nunca se convierte a HTML aquí (eso lo hace React).
 *
 * @param texto Texto crudo.
 * @returns Texto con `& < > " '` escapados.
 */
export function escapearHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Divide un enunciado en segmentos de texto y fórmulas (`$…$`).
 *
 * Un `$` sin cerrar se trata como texto normal (no rompe el render); el
 * contenido entre delimitadores se extrae tal cual para KaTeX.
 *
 * @param texto Enunciado de la pregunta.
 * @returns Lista de segmentos en orden de aparición (nunca vacía para un
 *   texto no vacío; `""` produce `[]`).
 */
export function partirTextoYFormulas(texto: string): Segmento[] {
  const segmentos: Segmento[] = [];
  const expresion = /\$([^$]+)\$/g;
  let ultimoIndice = 0;
  let coincidencia: RegExpExecArray | null;

  while ((coincidencia = expresion.exec(texto)) !== null) {
    if (coincidencia.index > ultimoIndice) {
      segmentos.push({
        tipo: "texto",
        valor: texto.slice(ultimoIndice, coincidencia.index),
      });
    }

    segmentos.push({ tipo: "formula", valor: coincidencia[1] });
    ultimoIndice = coincidencia.index + coincidencia[0].length;
  }

  if (ultimoIndice < texto.length) {
    segmentos.push({ tipo: "texto", valor: texto.slice(ultimoIndice) });
  }

  return segmentos;
}

/**
 * Renderiza una fórmula LaTeX a HTML seguro con KaTeX.
 *
 * Modo seguro (`trust: false`, `throwOnError: false`, `strict: "ignore"`):
 * nunca lanza y nunca devuelve HTML del usuario sin escapar — ver la
 * política de saneado del encabezado del archivo.
 *
 * @param tex Contenido LaTeX (sin los `$`).
 * @returns HTML generado por KaTeX; en el caso imposible de fallo total,
 *   el texto original **escapado** (nunca crudo).
 */
export function renderizarFormula(tex: string): string {
  try {
    return renderToString(tex, {
      throwOnError: false,
      trust: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return escapearHtml(tex);
  }
}
