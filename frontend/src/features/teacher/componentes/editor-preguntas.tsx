/**
 * Editor de preguntas de una actividad (T5.6.2, PRO-386).
 *
 * Componente cliente controlado: **no guarda estado interno** — recibe las
 * preguntas por props y notifica cada cambio con `cambiarPreguntas`, de
 * modo que la página que lo usa conserva siempre la única fuente de verdad
 * (y por eso **no pierde lo escrito** cuando la validación falla, CA 3 de
 * H5.6).
 *
 * Alcance (spec §Supuestos 2):
 * - Soporta los tipos auto-calificables del MVP: **`test`** (opción
 *   múltiple con radio de correcta) y **`completion`** (respuesta
 *   esperada).
 * - `file` y `minigame` están **tipados en el contrato zod** pero sin UI
 *   aquí (`minigame` es post-MVP); el editor no los emite.
 *
 * El editor permite construir estados **inválidos** a propósito (enunciado
 * vacío, una sola opción…): quien valida antes de guardar es el contrato
 * zod en la fachada (`api/actividades.ts`), que devuelve el error en
 * español para el resumen `role="alert"` del formulario.
 *
 * `position` **no se edita a mano**: lo renumera `normalizarPosiciones`
 * en el envío (el orden de la lista es la posición).
 */

import type { Pregunta } from "../contrato/actividades";

/** Tipos de pregunta ofrecidos por el editor (MVP auto-calificable). */
type TipoEditable = "test" | "completion";

/** Props del editor de preguntas. */
interface EditorPreguntasProps {
  /** Lista actual de preguntas (fuente de verdad de la página). */
  preguntas: Pregunta[];

  /** Notifica la lista completa reemplazada. */
  cambiarPreguntas: (nuevas: Pregunta[]) => void;

  /** Bloquea la edición (p. ej. actividad ya publicada, T5.6.3). */
  deshabilitado?: boolean;
}

/**
 * Construye una pregunta `test` vacía lista para editar.
 *
 * Arranca con 2 opciones (una correcta) para que el caso base sea válido;
 * el usuario puede quitar opciones y entonces el contrato zod rechazará el
 * guardado con su mensaje.
 *
 * @param posicion Posición sugerida (se renumera en el envío).
 * @returns Pregunta `test` con enunciado vacío.
 */
function crearPreguntaTest(posicion: number): Pregunta {
  return {
    type: "test",
    position: posicion,
    prompt: "",
    score: 1,
    options: [
      { text: "", is_correct: true },
      { text: "", is_correct: false },
    ],
  };
}

/**
 * Construye una pregunta `completion` vacía.
 *
 * @param posicion Posición sugerida (se renumera en el envío).
 * @returns Pregunta `completion` con enunciado y respuesta vacíos.
 */
function crearPreguntaCompletion(posicion: number): Pregunta {
  return {
    type: "completion",
    position: posicion,
    prompt: "",
    score: 1,
    expected_answer: "",
  };
}

/**
 * Editor de preguntas (test/completion) del formulario de actividad.
 *
 * @param props Lista de preguntas, notificador de cambio y bandera de solo
 *   lectura.
 * @returns Panel con la lista de preguntas y los controles de añadir/quitar.
 */
export function EditorPreguntas({
  preguntas,
  cambiarPreguntas,
  deshabilitado = false,
}: EditorPreguntasProps) {
  /** Aplica `edicion` a la pregunta de `indice` (narrowing por tipo). */
  function editar(indice: number, edicion: (p: Pregunta) => Pregunta): void {
    cambiarPreguntas(
      preguntas.map((pregunta, i) => (i === indice ? edicion(pregunta) : pregunta)),
    );
  }

  /** Añade una pregunta del tipo indicado al final de la lista. */
  function agregar(tipo: TipoEditable): void {
    const nueva =
      tipo === "test"
        ? crearPreguntaTest(preguntas.length + 1)
        : crearPreguntaCompletion(preguntas.length + 1);

    cambiarPreguntas([...preguntas, nueva]);
  }

  /** Elimina la pregunta de `indice`. */
  function eliminar(indice: number): void {
    cambiarPreguntas(preguntas.filter((_, i) => i !== indice));
  }

  /** Cambia el tipo de la pregunta manteniendo enunciado y puntuación. */
  function cambiarTipo(indice: number, tipo: TipoEditable): void {
    editar(indice, (pregunta): Pregunta => {
      if (tipo === pregunta.type) {
        return pregunta;
      }

      if (tipo === "completion") {
        return {
          type: "completion",
          position: pregunta.position,
          prompt: pregunta.prompt,
          score: pregunta.score,
          expected_answer: "",
        };
      }

      // completion → test: conserva las opciones si las había (y si siguen
      // siendo jugables); si no, vuelve al par por defecto.
      const opcionesPrevias =
        pregunta.type === "completion" ? pregunta.options : undefined;
      const opciones =
        opcionesPrevias !== undefined && opcionesPrevias.length >= 2
          ? opcionesPrevias
          : [
              { text: "", is_correct: true },
              { text: "", is_correct: false },
            ];

      return {
        type: "test",
        position: pregunta.position,
        prompt: pregunta.prompt,
        score: pregunta.score,
        options: opciones,
      };
    });
  }

  /** Actualiza el enunciado de la pregunta. */
  function cambiarPrompt(indice: number, valor: string): void {
    editar(indice, (p) => ({ ...p, prompt: valor }));
  }

  /** Actualiza la puntuación de la pregunta (entero ≥ 0). */
  function cambiarScore(indice: number, valor: string): void {
    const numero = valor === "" ? 0 : Number(valor);
    editar(indice, (p) => ({ ...p, score: Number.isNaN(numero) ? p.score : numero }));
  }

  /** Actualiza la respuesta esperada de una pregunta `completion`. */
  function cambiarRespuesta(indice: number, valor: string): void {
    editar(indice, (p) =>
      p.type === "completion" ? { ...p, expected_answer: valor } : p,
    );
  }

  /** Añade una opción vacía a una pregunta `test`. */
  function agregarOpcion(indice: number): void {
    editar(indice, (p) =>
      p.type === "test"
        ? { ...p, options: [...p.options, { text: "", is_correct: false }] }
        : p,
    );
  }

  /** Elimina la opción `opcionIndice` de una pregunta `test`. */
  function eliminarOpcion(indice: number, opcionIndice: number): void {
    editar(indice, (p) =>
      p.type === "test"
        ? { ...p, options: p.options.filter((_, i) => i !== opcionIndice) }
        : p,
    );
  }

  /** Actualiza el texto de una opción. */
  function cambiarTextoOpcion(
    indice: number,
    opcionIndice: number,
    valor: string,
  ): void {
    editar(indice, (p) =>
      p.type === "test"
        ? {
            ...p,
            options: p.options.map((opcion, i) =>
              i === opcionIndice ? { ...opcion, text: valor } : opcion,
            ),
          }
        : p,
    );
  }

  /** Marca `opcionIndice` como la única correcta (radio). */
  function marcarCorrecta(indice: number, opcionIndice: number): void {
    editar(indice, (p) =>
      p.type === "test"
        ? {
            ...p,
            options: p.options.map((opcion, i) => ({
              ...opcion,
              is_correct: i === opcionIndice,
            })),
          }
        : p,
    );
  }

  return (
    <section aria-labelledby="titulo-preguntas" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3
          id="titulo-preguntas"
          className="text-sm font-semibold text-neutral-800"
        >
          Preguntas
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={deshabilitado}
            onClick={() => agregar("test")}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Opción múltiple
          </button>
          <button
            type="button"
            disabled={deshabilitado}
            onClick={() => agregar("completion")}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Completar
          </button>
        </div>
      </div>

      {preguntas.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
          Aún no hay preguntas. Añade la primera con los botones de arriba.
        </p>
      )}

      {preguntas.map((pregunta, indice) => (
        <article
          key={indice}
          className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Pregunta {indice + 1}
            </span>
            <div className="flex items-center gap-2">
              <label
                htmlFor={`tipo-${indice}`}
                className="text-xs text-neutral-600"
              >
                Tipo
              </label>
              <select
                id={`tipo-${indice}`}
                value={pregunta.type === "completion" ? "completion" : "test"}
                disabled={deshabilitado}
                onChange={(e) =>
                  cambiarTipo(indice, e.target.value as TipoEditable)
                }
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="test">Opción múltiple</option>
                <option value="completion">Completar</option>
              </select>
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => eliminar(indice)}
                aria-label={`Eliminar pregunta ${indice + 1}`}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Eliminar
              </button>
            </div>
          </div>

          <div className="mt-3">
            <label
              htmlFor={`enunciado-${indice}`}
              className="block text-xs font-medium text-neutral-700"
            >
              Enunciado
            </label>
            <textarea
              id={`enunciado-${indice}`}
              value={pregunta.prompt}
              disabled={deshabilitado}
              rows={2}
              onChange={(e) => cambiarPrompt(indice, e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="Escribe la pregunta"
            />
          </div>

          <div className="mt-3 max-w-[10rem]">
            <label
              htmlFor={`puntuacion-${indice}`}
              className="block text-xs font-medium text-neutral-700"
            >
              Puntuación
            </label>
            <input
              id={`puntuacion-${indice}`}
              type="number"
              min={0}
              step={1}
              value={pregunta.score}
              disabled={deshabilitado}
              onChange={(e) => cambiarScore(indice, e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {pregunta.type === "completion" && (
            <div className="mt-3">
              <label
                htmlFor={`respuesta-${indice}`}
                className="block text-xs font-medium text-neutral-700"
              >
                Respuesta esperada
              </label>
              <input
                id={`respuesta-${indice}`}
                type="text"
                value={pregunta.expected_answer ?? ""}
                disabled={deshabilitado}
                onChange={(e) => cambiarRespuesta(indice, e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Texto que espera el correcto"
              />
            </div>
          )}

          {pregunta.type === "test" && (
            <fieldset className="mt-3">
              <legend className="text-xs font-medium text-neutral-700">
                Opciones (marca la correcta)
              </legend>
              <ul className="mt-2 space-y-2">
                {pregunta.options.map((opcion, opcionIndice) => (
                  <li key={opcionIndice} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correcta-${indice}`}
                      checked={opcion.is_correct}
                      disabled={deshabilitado}
                      onChange={() => marcarCorrecta(indice, opcionIndice)}
                      aria-label={`Marcar como correcta la opción ${opcionIndice + 1}`}
                      className="h-4 w-4 accent-neutral-900"
                    />
                    <input
                      type="text"
                      value={opcion.text}
                      disabled={deshabilitado}
                      onChange={(e) =>
                        cambiarTextoOpcion(indice, opcionIndice, e.target.value)
                      }
                      aria-label={`Texto de la opción ${opcionIndice + 1}`}
                      placeholder={`Opción ${opcionIndice + 1}`}
                      className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={deshabilitado}
                      onClick={() => eliminarOpcion(indice, opcionIndice)}
                      aria-label={`Quitar opción ${opcionIndice + 1}`}
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => agregarOpcion(indice)}
                className="mt-2 text-xs font-medium text-neutral-700 underline hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Añadir opción
              </button>
            </fieldset>
          )}
        </article>
      ))}
    </section>
  );
}
