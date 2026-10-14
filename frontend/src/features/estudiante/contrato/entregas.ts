/**
 * Contrato de entregas del estudiante (T5.8.2, PRO-395).
 *
 * ## Forma real (`db/001_schema.sql` §submissions)
 *
 * - `answers JSONB NOT NULL DEFAULT '[]'` con forma
 *   `[{ question_position, text, option, files, is_correct, score }]`.
 * - **Este esquema modela SOLO lo que envía el estudiante:**
 *   `question_position` + `text` (completion) o `option` (test). Los campos
 *   `files` (tipo `file`, post-MVP), `is_correct` y `score` **los escribe
 *   el backend** al calificar (H3.4) — el cliente no los conoce ni los
 *   envía.
 * - `CONSTRAINT uq_submission UNIQUE (activity_id, enrollment_id)` → una
 *   sola entrega por estudiante y actividad; el segundo intento es un
 *   **409** (garantía de la BD, replicada hoy por el mock).
 *
 * ## Vocabulario de estados
 *
 * El enum real es `submission_status = in_progress | submitted | graded |
 * rejected`. El ticket habla de "draft", pero **manda la BD**:
 * `in_progress` es el borrador de la entrega.
 */

import { z } from "zod";

/**
 * Una respuesta individual del estudiante.
 *
 * Debe traer `text` (completion) o `option` (test); vaciar ambos produce
 * un error de validación ("Falta la respuesta de esta pregunta").
 */
export const RespuestaSchema = z
  .object({
    /** Posición 1-indexada de la pregunta respondida. */
    question_position: z.number().int().min(1),

    /** Respuesta de texto (preguntas `completion`). */
    text: z.string().optional(),

    /** Texto de la opción elegida (preguntas `test`). */
    option: z.string().optional(),
  })
  .refine(
    (respuesta) =>
      (respuesta.text ?? "").trim() !== "" ||
      (respuesta.option ?? "").trim() !== "",
    { message: "Falta la respuesta de esta pregunta." },
  );

/**
 * El JSONB completo de `answers` que sale hacia el backend.
 *
 * Array ≥ 1: enviar vacío no tiene sentido (la vista además exige cubrir
 * todas las preguntas).
 */
export const RespuestasSchema = z
  .array(RespuestaSchema)
  .min(1, "Responde al menos una pregunta antes de enviar.");

/** Respuesta derivada del esquema zod. */
export type Respuesta = z.infer<typeof RespuestaSchema>;

/**
 * Estado de la entrega (enum `submission_status` real de la BD).
 *
 * - `in_progress` → borrador (el "draft" del ticket);
 * - `submitted` → enviada, espera de auto-calificación;
 * - `graded` → calificada (T5.8.3);
 * - `rejected` → rechazada por el profesor (T5.8.3).
 */
export type EstadoEntrega =
  | "in_progress"
  | "submitted"
  | "graded"
  | "rejected";

/**
 * Entrega vista por el estudiante (envelope provisional de `submissions`,
 * igual que el resto de H5.8 hasta que H3.4 publique sus DTOs).
 */
export interface Entrega {
  /** ID de la entrega (BigInt de la BD como string). */
  id: string;

  /** Actividad respondida. */
  actividadId: string;

  /** Estudiante dueño de la entrega (`enrollments.student_id`). */
  estudianteId: string;

  /** Estado actual de la entrega. */
  estado: EstadoEntrega;

  /** Respuestas enviadas (`answers`, sin campos de calificación). */
  respuestas: Respuesta[];

  /** Fecha de creación (ISO) — `started_at`. */
  iniciadaEn: string;

  /** Fecha de envío (ISO) — `submitted_at`; `null` mientras es borrador. */
  enviadaEn: string | null;

  /** Fecha de calificación (ISO) — `graded_at`; `null` hasta T5.8.3. */
  calificadaEn: string | null;

  /** Puntaje final (`score NUMERIC(6,2)`); `null` hasta calificar. */
  puntaje: number | null;

  /** Monedas otorgadas (`coins_awarded`); `0` hasta calificar. */
  monedasOtorgadas: number;

  /** Feedback del profesor (`feedback TEXT`); `null` si no hay. */
  retroalimentacion: string | null;
}
