/**
 * Preview de texto con fórmulas `$…$` para el editor del panel docente
 * (rediseño H5.x / KaTeX en el enunciado de las preguntas).
 *
 * Reutiliza la utilidad de saneado **ya probada** del lado estudiante
 * (`features/estudiante/util/formulas.ts`, T5.8.1): `partirTextoYFormulas`
 * divide el texto y `renderizarFormula` pinta cada fórmula con KaTeX en
 * modo seguro (`trust: false`, `throwOnError: false`), de modo que un
 * enunciado con HTML o LaTeX malicioso **no se ejecuta** (la política de
 * saneado completa vive en ese archivo). No se duplica lógica aquí.
 *
 * Es un preview **en vivo y no intrusivo**: mientras el docente escribe,
 * pinta el enunciado tal cual lo verá el estudiante; el campo editable
 * sigue siendo el `textarea`/`input` de la página (el texto crudo es lo
 * que se guarda en `activities.questions`).
 *
 * Seguridad: el único `dangerouslySetInnerHTML` del flujo es el interno de
 * `renderizarFormula`, y siempre recibe HTML generado por KaTeX (nunca
 * contenido crudo del usuario) — ver AGENTS.md §9.2.
 */

import "katex/dist/katex.min.css";

import {
  partirTextoYFormulas,
  renderizarFormula,
} from "@/features/estudiante/util/formulas";

/**
 * Propiedades del preview.
 */
interface PropsTextoMatematico {
  /** Texto crudo escrito por el docente (puede contener `$…$`). */
  texto: string;

  /** Clases extra para el contenedor (tipografía hereda del padre). */
  className?: string;
}

/**
 * Pinta un texto renderizando sus fórmulas `$…$` con KaTeX.
 *
 * El texto plano lo pinta React (escape automático); solo las fórmulas
 * pasan por el HTML generado por KaTeX.
 *
 * @param props Texto crudo y clases del contenedor.
 * @returns Segmentos de texto/fórmulas en orden de aparición.
 */
export function TextoMatematico({ texto, className }: PropsTextoMatematico) {
  const segmentos = partirTextoYFormulas(texto);

  return (
    <span className={className}>
      {segmentos.map((segmento, indice) =>
        segmento.tipo === "texto" ? (
          <span key={indice}>{segmento.valor}</span>
        ) : (
          <span
            key={indice}
            dangerouslySetInnerHTML={{
              __html: renderizarFormula(segmento.valor),
            }}
          />
        ),
      )}
    </span>
  );
}

/**
 * Indica si el texto contiene al menos una fórmula `$…$` renderizable.
 *
 * Las páginas lo usan para mostrar el preview **solo** cuando aporta algo
 * (evita cajas de preview vacías en textos sin matemáticas).
 *
 * @param texto Texto crudo.
 * `true` si hay al menos un par de delimitadores `$`.
 */
export function contieneFormulas(texto: string): boolean {
  return partirTextoYFormulas(texto).some(
    (segmento) => segmento.tipo === "formula",
  );
}
