/**
 * Render de una pregunta en el cuestionario del estudiante
 * (T5.8.1, PRO-394).
 *
 * Componente presentacional sobre la forma **segura**
 * (`contrato/cuestionario.ts`): nunca ve `is_correct` ni
 * `expected_answer`, así que no puede filtrar la respuesta correcta.
 *
 * Saneado del enunciado (CA 1 de H5.8):
 * - El texto lo pinta React (escape automático de HTML del JSONB).
 * - Las fórmulas `$…$` pasan por `renderizarFormula` (KaTeX con
 *   `trust: false`); **solo** el HTML generado por KaTeX usa
 *   `dangerouslySetInnerHTML` (ver la política en `util/formulas.ts`).
 *
 * Controles por tipo (alcance de T5.8.1):
 * - `test` → grupo de radios **deshabilitados**: la vista aún no envía
 *   respuestas (el formulario operativo llega con T5.8.2 / PRO-395).
 * - `completion` → campo de texto deshabilitado.
 * - `file` / `minigame` → aviso (tipos sin UI en el MVP,
 *   `docs/post_mvp.md`).
 */

import type { PreguntaEstudiante } from "../contrato/cuestionario";
import { partirTextoYFormulas, renderizarFormula } from "../util/formulas";

/**
 * Pinta un enunciado con fórmulas renderizadas.
 *
 * Único punto del flujo con `dangerouslySetInnerHTML`, y siempre con el
 * HTML producido por KaTeX (nunca con contenido crudo del usuario).
 *
 * @param props Texto del enunciado.
 * @returns Segmentos de texto (React-escapados) y fórmulas (KaTeX).
 */
function Enunciado({ texto }: { texto: string }) {
  const segmentos = partirTextoYFormulas(texto);

  return (
    <span>
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

/** Props del componente. */
interface PreguntaCuestionarioProps {
  /** Pregunta en su forma segura (sin secretos). */
  pregunta: PreguntaEstudiante;
}

/**
 * Renderiza una pregunta completa del cuestionario.
 *
 * @param props Pregunta a mostrar.
 * @returns Tarjeta de la pregunta con su enunciado y controles.
 */
export function PreguntaCuestionario({ pregunta }: PreguntaCuestionarioProps) {
  return (
    <article className="rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Pregunta {pregunta.position}
        </span>
        <span className="text-xs text-neutral-500">
          {pregunta.score} {pregunta.score === 1 ? "punto" : "puntos"}
        </span>
      </div>

      <p className="mt-2 text-sm text-neutral-900">
        <Enunciado texto={pregunta.prompt} />
      </p>

      {pregunta.type === "test" && (
        <fieldset className="mt-3" disabled>
          <legend className="sr-only">Opciones de respuesta</legend>
          <ul className="space-y-2">
            {(pregunta.options ?? []).map((opcion, indice) => (
              <li key={indice} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`opcion-${pregunta.position}`}
                  disabled
                  aria-label={`Opción ${indice + 1}: ${opcion.text}`}
                  className="h-4 w-4 accent-neutral-900"
                />
                <span className="text-sm text-neutral-700">{opcion.text}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {pregunta.type === "completion" && (
        <div className="mt-3">
          <label
            htmlFor={`respuesta-${pregunta.position}`}
            className="sr-only"
          >
            Tu respuesta
          </label>
          <input
            id={`respuesta-${pregunta.position}`}
            type="text"
            disabled
            placeholder="Tu respuesta"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      )}

      {(pregunta.type === "file" || pregunta.type === "minigame") && (
        <p className="mt-3 rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-500">
          Este tipo de pregunta se resuelve de otra forma y no está disponible
          en la versión actual.
        </p>
      )}
    </article>
  );
}
