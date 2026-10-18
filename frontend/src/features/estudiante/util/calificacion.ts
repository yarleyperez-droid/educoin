/**
 * Cálculo del resultado de una entrega (T5.8.3, PRO-396).
 *
 * ## ⚠️ Solo para el mock — la verdad vive en el servidor
 *
 * Con API real, **H3.4** evalúa `submissions.answers` contra
 * `activities.questions` y guarda `score`/`coins_awarded` en la entrega
 * (AGENTS.md §11: la lógica crítica vive en la BD/backend). Esta función
 * existe únicamente porque el mock tiene que *simular* esa
 * auto-calificación de forma creíble. **T5.8.4 la elimina** al integrar
 * la API real.
 *
 * Reglas del MVP (supuestos declarados en la spec):
 * - `test`: correcta si `option` coincide exactamente con la opción que
 *   tiene `is_correct: true`.
 * - `completion`: correcta si `text` coincide con `expected_answer` (con
 *   `trim` e insensible a mayúsculas).
 * - `file` / `minigame`: no se auto-califican en el MVP → incorrectas.
 * - `puntos` = `score` de la pregunta si es correcta; `0` en caso
 *   contrario. El `puntaje` total es la suma.
 *
 * El resultado devuelto (`ResultadoPregunta`) **no lleva secretos**: es
 * exactamente lo que H3.4 devolvería al estudiante.
 */

import type { Pregunta } from "@/features/teacher/contrato/actividades";

import type { ResultadoPregunta, Respuesta } from "../contrato/entregas";

/** Resultado completo del cálculo sobre una actividad. */
export interface CalculoResultado {
  /** Evaluación por pregunta (en orden de la actividad). */
  resultado: ResultadoPregunta[];

  /** Puntaje total (suma de `puntos`). */
  puntaje: number;
}

/**
 * Evalúa las respuestas del estudiante contra las preguntas de la
 * actividad.
 *
 * @param respuestas `answers` enviados (sin campos de calificación).
 * @param preguntas Preguntas **con secretos** (solo las usa el mock).
 * @returns Resultado por pregunta y puntaje total.
 */
export function calcularResultado(
  respuestas: Respuesta[],
  preguntas: Pregunta[],
): CalculoResultado {
  const resultado: ResultadoPregunta[] = preguntas.map((pregunta) => {
    const respuesta = respuestas.find(
      (item) => item.question_position === pregunta.position,
    );

    let correcta = false;

    if (respuesta) {
      if (pregunta.type === "test") {
        const opcionCorrecta = pregunta.options.find(
          (opcion) => opcion.is_correct,
        );

        correcta =
          opcionCorrecta !== undefined &&
          respuesta.option === opcionCorrecta.text;
      } else if (pregunta.type === "completion") {
        const esperado = (pregunta.expected_answer ?? "").trim().toLowerCase();
        const obtenido = (respuesta.text ?? "").trim().toLowerCase();

        correcta = esperado !== "" && obtenido === esperado;
      }
      // file/minigame: sin UI en el MVP → queda en false.
    }

    return {
      question_position: pregunta.position,
      correcta,
      puntos: correcta ? pregunta.score : 0,
    };
  });

  const puntaje = resultado.reduce((total, item) => total + item.puntos, 0);

  return { resultado, puntaje };
}
