import {
  totalPuntosDe,
  type Pregunta,
} from '../activities/dto/preguntas.schema';
import type { RespuestaEntrega } from './dto/respuestas.schema';

/**
 * Auto-calificación de entregas (AGENTS.md §11.2 y §11.3): evaluar las
 * respuestas contra `activities.questions` y, cuando toda la actividad
 * es auto-calificable, pasar la entrega directamente a 'graded'.
 *
 * Funciones PURAS, sin BD (AGENTS.md §6): las monedas siguen siendo
 * exclusivas del trigger fn_award_coins — aquí solo se decide el
 * veredicto de cada respuesta y si la entrega alcanza el umbral.
 *
 * Regla del equipo (umbral POR PUNTAJE): para que una entrega
 * auto-calificable pase a 'graded' (y con ello el trigger acredite las
 * monedas), el puntaje obtenido debe cubrir al menos el
 * UMBRAL_PUNTOS_PORCENTAJE% del PUNTAJE TOTAL de la actividad (suma de
 * questions[].score) — no un porcentaje de respuestas correctas.
 */

/** Umbral del equipo: % del puntaje total exigido para calificar. */
export const UMBRAL_PUNTOS_PORCENTAJE = 80;

/**
 * Respuesta calificada: lo que el estudiante envió (RespuestaEntrega)
 * más el veredicto del backend — la estructura documentada del JSONB
 * answers (docs/plataforma_educativa_bd.md §6). `is_correct`/`score` en
 * null = pregunta pendiente de calificación manual (minigame/file).
 *
 * Type alias (y no interface): los alias de objeto reciben la firma de
 * índice implícita que exige el InputJsonValue de Prisma al escribir el
 * JSONB answers; las interfaces la desconocen (AGENTS.md §7).
 */
export type RespuestaCalificada = RespuestaEntrega & {
  is_correct: boolean | null;
  /** Puntaje obtenido (0 al fallar); null = pendiente de calificar. */
  score: number | null;
};

/** Resultado de evaluar la entrega completa contra la actividad. */
export interface EvaluacionEntrega {
  /** answers tal como se guardan: cada respuesta con su veredicto. */
  respuestas: RespuestaCalificada[];
  /** Suma de los puntajes obtenidos (redondeada a 2 decimales). */
  puntaje: number;
  /** Suma de preguntas[].score: puntaje total (máximo) de la actividad. */
  totalPuntos: number;
  /** Preguntas respondidas correctamente (solo test/completion, informativo). */
  correctas: number;
  /** Total de preguntas de la actividad. */
  totalPreguntas: number;
  /** ¿Todas las preguntas fueron respondidas y todas son test/completion? */
  autoCalificable: boolean;
  /** autoCalificable Y con el UMBRAL_PUNTOS_PORCENTAJE% del puntaje total. */
  alcanzaUmbral: boolean;
}

/**
 * Normalización de respuestas abiertas (decisión del equipo): sin
 * espacios al inicio/fin e insensible a mayúsculas — " 4 " == "4".
 */
function normalizar(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Evalúa las respuestas validadas contra las preguntas REALES de la
 * actividad. Debe correr DESPUÉS de validarRespuestas (que garantiza
 * posiciones existentes, sin repetir y opciones coherentes):
 *
 * - test: copia el `is_correct` de la opción elegida (la opción ya se
 *   validó contra options[].text) y otorga el puntaje de la pregunta.
 * - completion: compara text contra expected_answer normalizado.
 * - minigame: sin evaluación automática (docs/post_mvp.md) → null/null;
 *   su calificación la hace el profesor.
 * - file: sin evaluación automática → null/null; el contenido del
 *   archivo lo revisa y califica el profesor (la subida valida MIME y
 *   tamaño, no la corrección).
 *
 * La entrega es `autoCalificable` solo si TODAS las preguntas de la
 * actividad fueron respondidas y todas son test/completion; alcanza el
 * umbral si además el `puntaje` obtenido cubre al menos el
 * UMBRAL_PUNTOS_PORCENTAJE% del `totalPuntos` de la actividad.
 */
export function evaluarRespuestas(
  respuestas: RespuestaEntrega[],
  preguntas: Pregunta[],
): EvaluacionEntrega {
  const calificadas: RespuestaCalificada[] = respuestas.map((respuesta) => {
    const pregunta = preguntas.find(
      (candidata) => candidata.position === respuesta.question_position,
    );
    if (pregunta === undefined) {
      // Invariante: validarRespuestas ya rechazó posiciones inválidas.
      throw new Error(
        `Respuesta sin pregunta asociada (question_position ${respuesta.question_position}): validarRespuestas debe correr antes.`,
      );
    }

    switch (pregunta.type) {
      case 'test': {
        const elegida = pregunta.options.find(
          (opcion) => opcion.text === respuesta.option,
        );
        const acierto = elegida?.is_correct ?? false;
        return {
          ...respuesta,
          is_correct: acierto,
          score: acierto ? pregunta.score : 0,
        };
      }
      case 'completion': {
        const acierto =
          respuesta.text !== undefined &&
          normalizar(respuesta.text) === normalizar(pregunta.expected_answer);
        return {
          ...respuesta,
          is_correct: acierto,
          score: acierto ? pregunta.score : 0,
        };
      }
      case 'minigame':
        return {
          ...respuesta,
          is_correct: null,
          score: null,
        };
      case 'file':
        // Calificación MANUAL del profesor: la subida (POST .../archivos)
        // validó MIME y tamaño del contenido, pero la corrección de un
        // archivo no es automática — igual que minigame, queda null/null.
        return {
          ...respuesta,
          is_correct: null,
          score: null,
        };
    }
  });

  const correctas = calificadas.filter(
    (respuesta) => respuesta.is_correct === true,
  ).length;
  const puntaje =
    Math.round(
      calificadas.reduce(
        (total, respuesta) => total + (respuesta.score ?? 0),
        0,
      ) * 100,
    ) / 100;

  const autoCalificable =
    respuestas.length === preguntas.length &&
    preguntas.every(
      (pregunta) => pregunta.type === 'test' || pregunta.type === 'completion',
    );

  const totalPuntos = totalPuntosDe(preguntas);

  // Comparación entera (sin punto flotante): el puntaje obtenido debe
  // cubrir el UMBRAL_PUNTOS_PORCENTAJE% del puntaje TOTAL de la
  // actividad (preguntas ponderadas: 12/14 ≈ 85.7% sí, 10/14 ≈ 71.4% no).
  const alcanzaUmbral =
    autoCalificable &&
    totalPuntos > 0 &&
    Math.round(puntaje * 100) >=
      Math.round(totalPuntos * UMBRAL_PUNTOS_PORCENTAJE);

  return {
    respuestas: calificadas,
    puntaje,
    totalPuntos,
    correctas,
    totalPreguntas: preguntas.length,
    autoCalificable,
    alcanzaUmbral,
  };
}
