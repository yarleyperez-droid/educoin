import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Validación de `activities.questions` (JSONB) con zod (AGENTS.md §2:
 * zod es la herramienta designada para validar el JSONB de preguntas).
 *
 * Estructura de referencia — db/002_seed.sql §7 y
 * docs/plataforma_educativa_bd.md §6:
 *
 *   [
 *     { "position": 1, "type": "test", "prompt": "…", "score": 5,
 *       "options": [{ "text": "3", "is_correct": true }] },
 *     { "position": 2, "type": "completion", "prompt": "…", "score": 5,
 *       "expected_answer": "4" }
 *   ]
 *
 * La BD solo exige que sea un arreglo JSON (CHECK jsonb_typeof); TODO el
 * resto de la validación vive aquí, antes de guardar. Los objetos de zod
 * descartan las claves desconocidas, así que nunca se guardan campos
 * ajenos a la estructura (p. ej. un expected_answer enviado en una
 * pregunta de tipo test se elimina en lugar de almacenarse).
 */

const campoPosicion = z
  .number({
    error: 'La posición (position) de la pregunta debe ser un número.',
  })
  .int({
    error: 'La posición (position) de la pregunta debe ser un número entero.',
  })
  .positive({
    error:
      'La posición (position) de la pregunta debe ser un entero positivo (desde 1).',
  });

const campoEnunciado = z
  .string({ error: 'El enunciado (prompt) de la pregunta debe ser un texto.' })
  .min(1, {
    error: 'El enunciado (prompt) de la pregunta no puede estar vacío.',
  });

const campoPuntaje = z
  .number({ error: 'El puntaje (score) de la pregunta debe ser un número.' })
  .positive({
    error: 'El puntaje (score) de la pregunta debe ser mayor que 0.',
  });

const opcionSchema = z.object({
  text: z
    .string({ error: 'El texto de cada opción debe ser un string.' })
    .min(1, { error: 'El texto de una opción no puede estar vacío.' }),
  is_correct: z.boolean({
    error: 'is_correct de cada opción debe ser un booleano.',
  }),
});

/** Pregunta discrimada por `type` (los 4 tipos del MVP, AGENTS.md §5). */
const preguntaSchema = z.discriminatedUnion('type', [
  z.object({
    position: campoPosicion,
    type: z.literal('test'),
    prompt: campoEnunciado,
    score: campoPuntaje,
    options: z
      .array(opcionSchema, {
        error: 'options debe ser un arreglo de opciones.',
      })
      .min(2, {
        error:
          'Una pregunta de tipo test necesita al menos 2 opciones (options).',
      }),
  }),
  z.object({
    position: campoPosicion,
    type: z.literal('completion'),
    prompt: campoEnunciado,
    score: campoPuntaje,
    expected_answer: z
      .string({
        error: 'expected_answer de una pregunta completion debe ser un texto.',
      })
      .min(1, {
        error:
          'Una pregunta de tipo completion necesita expected_answer (la respuesta esperada).',
      }),
  }),
  z.object({
    position: campoPosicion,
    type: z.literal('file'),
    prompt: campoEnunciado,
    score: campoPuntaje,
  }),
  z.object({
    position: campoPosicion,
    type: z.literal('minigame'),
    prompt: campoEnunciado,
    score: campoPuntaje,
  }),
]);

/**
 * Arreglo completo de preguntas de la actividad. Reglas:
 * - Al menos 1 pregunta (la actividad se crea con su JSONB, como la seed).
 * - Posiciones secuenciales desde 1 (1, 2, 3…): las entregas referencian
 *   las preguntas por question_position (docs/plataforma_educativa_bd.md §6).
 * - Cada pregunta test con exactamente una opción correcta: la
 *   auto-calificación depende de ese único marcador.
 */
export const preguntasSchema = z
  .array(preguntaSchema, {
    error: 'preguntas debe ser un arreglo de preguntas.',
  })
  .min(1, { error: 'La actividad necesita al menos una pregunta.' })
  .refine(
    (preguntas) =>
      preguntas.every((pregunta, indice) => pregunta.position === indice + 1),
    {
      error:
        'Las posiciones de las preguntas deben ser secuenciales desde 1 (1, 2, 3…).',
    },
  )
  .refine(
    (preguntas) =>
      preguntas.every(
        (pregunta) =>
          pregunta.type !== 'test' ||
          pregunta.options.filter((opcion) => opcion.is_correct).length === 1,
      ),
    {
      error:
        'Cada pregunta de tipo test debe tener exactamente una opción correcta (is_correct = true).',
    },
  );

/** Pregunta ya validada, tal como se guarda en el JSONB. */
export type Pregunta = z.infer<typeof preguntasSchema>[number];

/**
 * Pregunta tal como la ve el ESTUDIANTE: sin `options[].is_correct` ni
 * `expected_answer` (AGENTS.md §9.5: la respuesta correcta nunca se
 * envía al frontend mientras el estudiante resuelve).
 */
export type PreguntaSinRespuestas =
  | {
      position: number;
      type: 'test';
      prompt: string;
      score: number;
      options: { text: string }[];
    }
  | {
      position: number;
      type: 'completion';
      prompt: string;
      score: number;
    }
  | {
      position: number;
      type: 'file';
      prompt: string;
      score: number;
    }
  | {
      position: number;
      type: 'minigame';
      prompt: string;
      score: number;
    };

/**
 * Sanitiza preguntas para la vista del estudiante con ALLOW-LIST: solo
 * copia `position`, `type`, `prompt`, `score` y `options[].text`. Por
 * construcción nunca emite `is_correct` ni `expected_answer`, aunque el
 * JSONB contuviera campos inesperados (p. ej. por una edición directa
 * de la BD): lo que no está en la lista no sale.
 */
export function sinRespuestasCorrectas(
  preguntas: Pregunta[],
): PreguntaSinRespuestas[] {
  return preguntas.map((pregunta) => {
    switch (pregunta.type) {
      case 'test':
        return {
          position: pregunta.position,
          type: 'test',
          prompt: pregunta.prompt,
          score: pregunta.score,
          options: pregunta.options.map((opcion) => ({
            text: opcion.text,
          })),
        };
      case 'completion':
        return {
          position: pregunta.position,
          type: 'completion',
          prompt: pregunta.prompt,
          score: pregunta.score,
        };
      case 'file':
        return {
          position: pregunta.position,
          type: 'file',
          prompt: pregunta.prompt,
          score: pregunta.score,
        };
      case 'minigame':
        return {
          position: pregunta.position,
          type: 'minigame',
          prompt: pregunta.prompt,
          score: pregunta.score,
        };
    }
  });
}

/**
 * Valida el valor recibido del cliente contra la estructura de la seed.
 * Devuelve las preguntas saneadas (sin claves desconocidas) o lanza un
 * 400 con el primer problema encontrado y su ubicación, para que el
 * profesor sepa exactamente qué corregir.
 */
export function validarPreguntas(valor: unknown): Pregunta[] {
  const resultado = preguntasSchema.safeParse(valor);
  if (!resultado.success) {
    const primerProblema = resultado.error.issues[0];
    if (primerProblema === undefined) {
      throw new BadRequestException(
        'Las preguntas de la actividad no son válidas.',
      );
    }
    const ubicacion =
      primerProblema.path.length > 0
        ? ` (campo: ${primerProblema.path.join('.')})`
        : '';
    throw new BadRequestException(
      `Las preguntas de la actividad no son válidas: ${primerProblema.message}${ubicacion}.`,
    );
  }
  return resultado.data;
}
