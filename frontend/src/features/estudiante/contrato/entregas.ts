/**
 * Contrato de entregas del estudiante (T5.8.2 → T5.8.4, PRO-397).
 *
 * ## Forma real (`db/001_schema.sql` §submissions, H3.4)
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
 *   **409** que produce el backend (garantía de la BD).
 *
 * ## Vocabulario de estados
 *
 * El enum real es `submission_status = in_progress | submitted | graded |
 * rejected`. El ticket habla de "draft", pero **manda la BD**:
 * `in_progress` es el borrador de la entrega.
 *
 * ## Mapeo desde los DTOs de H3.4 (T5.8.4)
 *
 * `Entrega` se alimenta de `EntregaBorradorRespuestaDto` y
 * `EntregaRespuestaDto` (`src/modules/submissions/dto/entrega-respuesta.dto.ts`)
 * mediante el mapper de `features/estudiante/api/entregas.ts`:
 *
 * - `entregadoEn` (del backend) → `enviadaEn`; `null` en el borrador.
 * - `estudianteId`, `iniciadaEn` y `calificadaEn` **se eliminaron**: los
 *   DTOs de H3.4 no los exponen (la inscripción sale del token y ni
 *   `started_at` ni `graded_at` viajan en la respuesta) y ninguna vista
 *   los lee. Con API real el backend es la única fuente de verdad y el
 *   cliente no rellena campos que no puede saber.
 * - `retroalimentacion` se **conserva** porque la vista de T5.8.3 la
 *   muestra; desde T5.9.3 se mapea desde el `feedback` real de H3.5
 *   (`EntregaRespuestaDto.feedback`) — antes la fachada lo dejaba siempre
 *   `null` y la vista pintaba su estado vacío aunque el profesor hubiera
 *   escrito retroalimentación.
 * - `resultado` se **deriva** de `respuestas` calificadas del backend
 *   (`RespuestaCalificada`: `is_correct`/`score` por respuesta) y
 *   `respuestas` se sanea a la forma enviada por el estudiante (sin
 *   veredictos).
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

/**
 * Respuestas **parciales** del borrador (`PUT /submissions`): a diferencia
 * de {@link RespuestasSchema} admite el arreglo vacío — el estudiante puede
 * guardar el autosave recién abre la actividad (H3.4 persiste `[]` sin
 * problema). Cada elemento individual sí cumple {@link RespuestaSchema}.
 */
export const RespuestasParcialesSchema = z.array(RespuestaSchema);

/** Respuesta derivada del esquema zod. */
export type Respuesta = z.infer<typeof RespuestaSchema>;

/**
 * Estado de la entrega (enum `submission_status` real de la BD).
 *
 * - `in_progress` → borrador (el "draft" del ticket);
 * - `submitted` → enviada: con la auto-calificación inmediata de H3.4
 *   significa **pendiente del profesor** (bajo el umbral del 80% o con
 *   preguntas de calificación manual);
 * - `graded` → calificada (monedas acreditadas por el trigger);
 * - `rejected` → rechazada por el profesor (H3.5).
 */
export type EstadoEntrega =
  | "in_progress"
  | "submitted"
  | "graded"
  | "rejected";

/**
 * Resultado de una pregunta **ya calculado por el backend** (T5.8.3).
 *
 * Es la única fuente del estudiante para ver aciertos: **no** deriva de
 * `is_correct`/`expected_answer` del JSONB de preguntas (nunca expuestos)
 * sino del veredicto que H3.4 escribe en `submissions.answers`
 * (`RespuestaCalificada`) y que esta fachada traduce al ver el envío.
 *
 * `correcta` = si la respuesta fue correcta; `puntos` = `score` obtenido
 * (0 si fue incorrecta).
 */
export const ResultadoPreguntaSchema = z.object({
  /** Posición de la pregunta evaluada. */
  question_position: z.number().int().min(1),

  /** Si la respuesta del estudiante fue correcta. */
  correcta: z.boolean(),

  /** Puntos obtenidos en esta pregunta (0 si falló). */
  puntos: z.number().min(0),
});

/** Resultado por pregunta derivado del esquema zod. */
export type ResultadoPregunta = z.infer<typeof ResultadoPreguntaSchema>;

/**
 * Entrega vista por el estudiante: proyección del cliente sobre los DTOs
 * de H3.4 (ver el mapeo en la cabecera de este archivo). Sin campos que el
 * backend no expone.
 */
export interface Entrega {
  /** ID de la entrega (BigInt de la BD como string). */
  id: string;

  /** Actividad respondida. */
  actividadId: string;

  /** Estado actual de la entrega. */
  estado: EstadoEntrega;

  /** Respuestas enviadas (`answers`, saneadas: sin veredictos). */
  respuestas: Respuesta[];

  /** Fecha de envío (ISO) — `submitted_at`; `null` mientras es borrador. */
  enviadaEn: string | null;

  /** Puntaje final (`score NUMERIC(6,2)`); `null` hasta calificar. */
  puntaje: number | null;

  /** Monedas otorgadas (`coins_awarded`); `0` hasta calificar. */
  monedasOtorgadas: number;

  /**
   * Feedback del profesor (`feedback TEXT`); `null` si no hay. El backend
   * aún no lo expone (H3.5), pero la vista de T5.8.3 lo muestra, así que
   * el campo se conserva y llega neutro.
   */
  retroalimentacion: string | null;

  /**
   * Resultado por pregunta derivado de los veredictos del backend;
   * `null` en el borrador. En una entrega enviada se calcula aunque el
   * estado siga en `submitted` (la vista solo lo pinta cuando `graded`);
   * las respuestas pendientes de calificación manual (`is_correct: null`)
   * se omiten hasta que el profesor las califique (H3.5).
   */
  resultado: ResultadoPregunta[] | null;
}

/**
 * Etiquetas en español de cada estado de la entrega.
 *
 * Una sola fuente para todas las vistas (convención AGENTS.md §8).
 */
const ETIQUETAS_ENTREGA: Readonly<Record<EstadoEntrega, string>> = {
  in_progress: "En curso",
  submitted: "Enviada",
  graded: "Calificada",
  rejected: "Rechazada",
};

/**
 * Etiqueta en español de un estado de entrega.
 *
 * @param estado Estado de la entrega.
 * @returns Texto visible (p. ej. `"Calificada"`).
 */
export function etiquetaEstadoEntrega(estado: EstadoEntrega): string {
  return ETIQUETAS_ENTREGA[estado];
}
