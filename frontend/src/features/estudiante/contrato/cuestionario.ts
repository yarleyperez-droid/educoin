/**
 * Contrato del cuestionario para el estudiante (T5.8.1, PRO-394).
 *
 * ## Por qué existe una proyección aparte
 *
 * El contrato completo de preguntas (T5.6.2,
 * `features/teacher/contrato/actividades.ts`) incluye los **secretos de
 * auto-calificación**: `options[].is_correct` y `expected_answer`. La
 * historia H5.8 exige que **el estudiante nunca los reciba**: este esquema
 * define la forma **segura** que sí puede salir hacia la vista.
 *
 * Con API real quien garantiza la proyección es **H3.3** (endpoint por
 * rol); mientras exista el mock, la proyección la aplica
 * `features/estudiante/api/actividades-estudiante.ts`. La vista **jamás**
 * importa el contrato del profesor.
 *
 * Estructura derivada de `activities.questions` (`db/001_schema.sql`),
 * con las claves en inglés que son contrato de la BD.
 */

import { z } from 'zod';

/**
 * Opción de respuesta vista por el estudiante: **solo el texto**.
 *
 * Sin `is_correct` — es exactamente la información que la historia prohíbe
 * exponer antes de calificar.
 */
export const OpcionEstudianteSchema = z.object({
  /** Texto visible de la opción (clave `text` del JSONB). */
  text: z.string(),
});

/**
 * Pregunta en su forma segura para el estudiante.
 *
 * Mismas claves que el JSONB (`position`, `type`, `prompt`, `score`,
 * `options`), **sin** `expected_answer` y sin `is_correct`. Es un objeto
 * plano (no una unión discriminada) porque la vista solo lee: no valida
 * reglas de negocio por tipo — eso ya lo hizo el contrato del profesor.
 */
export const PreguntaEstudianteSchema = z.object({
  /** Posición 1-indexada de la pregunta. */
  position: z.number().int().min(1),

  /** Tipo de pregunta (enum real de la BD). */
  type: z.enum(['test', 'completion', 'file', 'minigame']),

  /** Enunciado (puede contener fórmulas `$…$`). */
  prompt: z.string(),

  /** Puntos que vale la pregunta (≥ 0). */
  score: z.number().int().min(0),

  /** Opciones solo con texto (los tipos que no las usan la omiten). */
  options: z.array(OpcionEstudianteSchema).optional(),
});

/** Pregunta derivada del esquema seguro. */
export type PreguntaEstudiante = z.infer<typeof PreguntaEstudianteSchema>;

/**
 * Resumen de actividad en los listados del estudiante: sin preguntas ni
 * descripción. El backend ya filtra `published` para estudiantes.
 */
export interface ActividadResumen {
  /** ID de la actividad (BigInt de la BD como string). */
  id: string;

  /** Título visible. */
  titulo: string;

  /** Monedas que otorga al ser calificada. */
  recompensaMonedas: number;

  /** Fecha de publicación (ISO). */
  publicadaEn: string | null;

  /** Fecha de cierre (ISO) o `null` si no tiene. */
  cierraEn: string | null;

  /** Fecha de creación (ISO). */
  creadoEn: string;
}

/**
 * Actividad publicada tal como la ve el estudiante.
 *
 * Envelope provisional (mismo criterio que `Actividad` del profesor): deriva
 * de `db/001_schema.sql` hasta que H3.3 publique sus DTOs. No incluye
 * `estado`: el estudiante solo recibe actividades `published`.
 */
export interface ActividadEstudiante {
  /** ID de la actividad (BigInt de la BD como string). */
  id: string;

  /** Clase dueña de la actividad. */
  claseId: string;

  /** Título visible. */
  titulo: string;

  /** Descripción opcional. */
  descripcion: string | null;

  /** Monedas que otorga al ser calificada. */
  recompensaMonedas: number;

  /** Preguntas ya proyectadas (sin secretos). */
  preguntas: PreguntaEstudiante[];

  /** Fecha de publicación (ISO). */
  publicadaEn: string | null;
}
