/**
 * Contrato zod del JSONB `questions` de las actividades (T5.6.2, PRO-386).
 *
 * ## De dónde sale este esquema
 *
 * H3.3 (PRO-275) **todavía no publicó sus DTOs** (está en Backlog), así que
 * el esquema se deriva de las dos fuentes que sí son autoridad:
 * - `db/001_schema.sql` §activities: `questions JSONB DEFAULT '[]' CHECK
 *   (jsonb_typeof='array')` y la estructura documentada en el comentario de
 *   la columna;
 * - AGENTS.md §5: tipos de pregunta `test | completion | file | minigame`.
 *
 * **PROVISIONAL por diseño:** si el contrato real de H3.3 difiere, se ajusta
 * **solo este archivo** (la vista y la fachada `api/actividades.ts` no
 * cambian) — mismo criterio de aislamiento que `lib/auth.ts` con H2.x.
 *
 * ## Claves: en inglés, a propósito
 *
 * Las claves del JSONB (`position`, `type`, `prompt`, `score`,
 * `expected_answer`, `options[].text/is_correct`) son **contrato de la
 * BD** y viajan tal cual; el backend auto-califica leyendo `is_correct` y
 * `expected_answer`. El resto del dominio (campos de actividad, UI y
 * docstrings) va en español (convención del proyecto).
 *
 * ## Doble red de validación
 *
 * La BD solo exige `jsonb_typeof='array'` (AGENTS.md §6: el interior lo
 * valida la app). Este esquema es la **primera red en cliente**; H3.3
 * deberá replicar estas reglas en servidor y la BD seguirá siendo la red de
 * seguridad final.
 */

import { z } from "zod";

/** Tipos de pregunta del contrato (`db/001_schema.sql` + AGENTS.md §5). */
export const TIPOS_PREGUNTA = [
  "test",
  "completion",
  "file",
  "minigame",
] as const;

/** Opción de una pregunta `test`/`completion` (clave del JSONB). */
export const OpcionSchema = z.object({
  /** Texto visible de la opción (clave `text` del JSONB). */
  text: z.string().min(1, "La opción no puede estar vacía."),

  /** Única opción marcada como correcta en las preguntas `test`. */
  is_correct: z.boolean(),
});

/** Enunciado obligatorio de toda pregunta. */
const EnunciadoSchema = z
  .string()
  .trim()
  .min(1, "El enunciado de la pregunta no puede estar vacío.");

/** Posición 1-indexada de la pregunta dentro de la actividad. */
const PosicionSchema = z
  .number()
  .int()
  .min(1, "La posición de la pregunta debe ser un número entero mayor que 0.");

/** Puntuación entera ≥ 0 (CHECK de la BD: no hay puntuación negativa). */
const PuntuacionSchema = z
  .number()
  .int("La puntuación debe ser un número entero.")
  .min(0, "La puntuación no puede ser negativa.");

/**
 * Pregunta de opción múltiple (`test`): auto-calificable por `is_correct`.
 *
 * Exige al menos 2 opciones; la marca de "al menos una correcta" se verifica
 * en {@link PreguntasSchema} (superRefine), porque `discriminatedUnion` no
 * admite miembros con `.refine` en todas las versiones de zod.
 */
export const PreguntaTestSchema = z.object({
  type: z.literal("test"),
  position: PosicionSchema,
  prompt: EnunciadoSchema,
  score: PuntuacionSchema,
  expected_answer: z.string().optional(),
  options: z
    .array(OpcionSchema)
    .min(2, "Una pregunta de opción múltiple necesita al menos 2 opciones."),
});

/**
 * Pregunta de completar (`completion`): auto-calificable por
 * `expected_answer` (obligatorio en este tipo).
 */
export const PreguntaCompletionSchema = z.object({
  type: z.literal("completion"),
  position: PosicionSchema,
  prompt: EnunciadoSchema,
  score: PuntuacionSchema,
  expected_answer: z
    .string()
    .trim()
    .min(1, "Indica la respuesta esperada de la pregunta de completar."),
  options: z.array(OpcionSchema).optional(),
});

/**
 * Pregunta de archivo (`file`): el backend la valida al calificar.
 *
 * **Tipada sin UI en esta tarea** (el editor solo implementa `test` y
 * `completion`); se incluye para que el esquema cubra el contrato completo
 * y un JSONB con este tipo no sea rechazado injustamente.
 */
export const PreguntaFileSchema = z.object({
  type: z.literal("file"),
  position: PosicionSchema,
  prompt: EnunciadoSchema,
  score: PuntuacionSchema,
  expected_answer: z.string().optional(),
  options: z.array(OpcionSchema).optional(),
});

/**
 * Pregunta tipo minijuego (`minigame`): **post-MVP**
 * (`docs/post_mvp.md`, AGENTS.md §5 — "minijuegos sin implementar").
 *
 * Se tipa para completar el contrato; el editor no la ofrece.
 */
export const PreguntaMinigameSchema = z.object({
  type: z.literal("minigame"),
  position: PosicionSchema,
  prompt: EnunciadoSchema,
  score: PuntuacionSchema,
  expected_answer: z.string().optional(),
  options: z.array(OpcionSchema).optional(),
});

/**
 * Pregunta válida del JSONB `questions` (unión discriminada por `type`).
 *
 * Equivalente al shape documentado de la columna:
 * `{ position, type, prompt, score, expected_answer?, options? }`.
 */
export const PreguntaSchema = z.discriminatedUnion("type", [
  PreguntaTestSchema,
  PreguntaCompletionSchema,
  PreguntaFileSchema,
  PreguntaMinigameSchema,
]);

/**
 * Array completo de preguntas de una actividad.
 *
 * Además de exigir ≥ 1 pregunta, verifica por pregunta (superRefine):
 * - `test` → al menos una opción con `is_correct: true`;
 * - `completion` → `expected_answer` presente (la regla del miembro ya
 *   obliga a no vacío; aquí se refuerza el mensaje para el editor).
 */
export const PreguntasSchema = z
  .array(PreguntaSchema)
  .min(1, "Agrega al menos una pregunta a la actividad.")
  .superRefine((preguntas, contexto) => {
    preguntas.forEach((pregunta, indice) => {
      if (
        pregunta.type === "test" &&
        !pregunta.options.some((opcion) => opcion.is_correct)
      ) {
        contexto.addIssue({
          code: "custom",
          message: "Marca al menos una opción como correcta.",
          path: [indice, "options"],
        });
      }
    });
  });

/**
 * Datos editables de una actividad (sin id ni estados: eso es cosa de la
 * fachada y del backend).
 *
 * `recompensaMonedas` replica el CHECK de la BD
 * (`reward_coins INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0)`).
 */
export const BorradorActividadSchema = z.object({
  /** Título visible de la actividad (`activities.title NOT NULL`). */
  titulo: z
    .string()
    .trim()
    .min(1, "El título de la actividad no puede estar vacío.")
    .max(150, "El título no puede superar los 150 caracteres."),

  /** Descripción opcional (`activities.description`). */
  descripcion: z
    .string()
    .trim()
    .max(1000, "La descripción no puede superar los 1000 caracteres.")
    .optional(),

  /** Monedas que otorga al ser calificada (≥ 0, entero). */
  recompensaMonedas: PuntuacionSchema,
});

/** Pregunta derivada del esquema zod. */
export type Pregunta = z.infer<typeof PreguntaSchema>;

/** Opción derivada del esquema zod. */
export type Opcion = z.infer<typeof OpcionSchema>;

/** Datos editables de actividad derivados del esquema zod. */
export type BorradorActividad = z.infer<typeof BorradorActividadSchema>;

/**
 * Renumera las posiciones de las preguntas (1..n) según su orden en la
 * lista.
 *
 * El `position` del JSONB es un índice derivado, no un dato del usuario:
 * añadir/quitar preguntas en el editor deja huecos y el backend espera
 * posiciones contiguas. Se aplica **antes** de validar y de guardar
 * (plan §3 de T5.6.2).
 *
 * @param preguntas Preguntas en el orden del editor.
 * @returns Copia con `position` consecutivo desde 1.
 */
export function normalizarPosiciones(preguntas: Pregunta[]): Pregunta[] {
  return preguntas.map((pregunta, indice) => ({
    ...pregunta,
    position: indice + 1,
  }));
}

/**
 * Convierte los `issues` de zod en un mensaje único en español para la UI.
 *
 * La vista solo muestra texto (nunca estructuras del backend); este helper
 * centraliza el formato para que los errores lleguen legibles al resumen
 * `role="alert"` del formulario.
 *
 * @param problemas `error.issues` de un `safeParse` fallido (el `path` de
 *   zod es `PropertyKey[]`; los segmentos `symbol` se pasan a texto).
 * @returns Mensaje con el primer problema (y el total si hay varios).
 */
export function mensajeDeErroresZod(
  problemas: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>,
): string {
  if (problemas.length === 0) {
    return "Revisa los datos de la actividad.";
  }

  const primero = problemas[0];
  const campo =
    primero.path.length > 0
      ? primero.path
          .map((segmento) =>
            typeof segmento === "symbol" ? String(segmento) : segmento,
          )
          .join(".")
      : "formulario";

  if (problemas.length === 1) {
    return `${campo}: ${primero.message}`;
  }

  return `${campo}: ${primero.message} (+${problemas.length - 1} más)`;
}
