/**
 * Contrato zod de las entregas del profesor: cola (T5.9.1, PRO-399) y
 * vista de revisión/calificación (T5.9.2, PRO-400).
 *
 * ## De dónde sale este esquema
 *
 * Espejo verificado (AGENTS.md §10.2) de los DTOs de H3.5:
 * - `EntregaColaDto` / `EstudianteColaDto` / `ListadoEntregasMetaDto` de
 *   `src/modules/submissions/dto/entrega-respuesta.dto.ts` (cola);
 * - `EntregaDetalleProfesorDto` / `CalificacionRespuestaDto` del mismo
 *   archivo y `CalificarEntregaDto` de
 *   `src/modules/submissions/dto/calificar-entrega.dto.ts` (revisión);
 * - los mappers reales `aEntregaCola` / `aEntregaDetalleProfesor` de
 *   `src/modules/submissions/submissions.service.ts` (qué serializa cada
 *   campo hacia el cliente);
 * - la forma real del JSONB `answers` (`RespuestaCalificada`) de
 *   `src/modules/submissions/dto/respuestas.schema.ts` y
 *   `src/modules/submissions/auto-calificacion.ts`.
 *
 * **Aislamiento por diseño:** si el contrato real de H3.5 cambia, se ajusta
 * **solo este archivo** (la vista y la fachada `api/entregas.ts` no cambian)
 * — mismo criterio de aislamiento que `contrato/actividades.ts` con H3.3.
 *
 * ## Forma del DTO (`GET /activities/:id/submissions/queue`)
 *
 * ```json
 * { "data": [EntregaColaDto], "meta": { "total", "page", "limit" } }
 * ```
 *
 * - `id` y `estudiante.id` son `BIGINT` de la BD serializados a `string`
 *   (AGENTS.md §7: `BigInt` no viaja en JSON).
 * - `entregadoEn` es `null` en los borradores (`submitted_at` aún no
 *   existe) y `puntaje` es `null` hasta que el profesor califica
 *   (`NUMERIC(6,2)` → `number` en el DTO).
 * - `monedasOtorgadas` (`coins_awarded INT`) es `0` hasta `graded`.
 * - Las filas de la cola **no** traen `answers` (es un resumen; el detalle
 *   de la entrega vive en la vista de revisión, T5.9.2).
 *
 * ## Doble red de validación
 *
 * Este esquema es la **primera red en cliente** (plan §3): un payload que
 * viole el contrato se convierte en `ApiError` 422 con el mensaje legible de
 * `mensajeDeErroresZod` (helper de `contrato/actividades`, importado por la
 * fachada `api/entregas.ts` — mismo patrón que `features/estudiante/api/
 * entregas.ts`) antes de que la vista reciba nada. El backend sigue siendo
 * la fuente de verdad y la BD la red de seguridad final (AGENTS.md §6).
 */

import { z } from "zod";

/**
 * Estados de la entrega (enum real `submission_status` de
 * `db/001_schema.sql`).
 *
 * El vocabulario manda la BD (igual que en el contrato del estudiante):
 * `in_progress` es el borrador de la entrega.
 */
export const ESTADOS_ENTREGA = [
  "in_progress",
  "submitted",
  "graded",
  "rejected",
] as const;

/** Estado de una entrega de la cola. */
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];

/**
 * Filtro por estado del listado: los 4 valores del enum más `"todas"`
 * (sin filtro en la query — el DTO del backend lo marca `@IsOptional`).
 */
export type FiltroEstado = EstadoEntrega | "todas";

/**
 * `EstudianteColaDto` de H3.5: el estudiante dueño de la entrega, tal
 * como lo ve el profesor (join `enrollments → users`).
 */
export const EstudianteColaSchema = z.object({
  /** ID del usuario (BIGINT serializado a string). */
  id: z.string(),

  /** Nombre de usuario (`users.username`, CITEXT). */
  usuario: z.string(),

  /** Nombre (`users.first_name`). */
  nombre: z.string(),

  /** Apellido (`users.last_name`). */
  apellido: z.string(),
});

/**
 * `EntregaColaDto` de H3.5: fila de resumen de la cola, **sin `answers`**.
 *
 * Los `null` son parte del contrato y no se sustituyen por defaults: sin
 * envío no hay `entregadoEn` y sin calificación no hay `puntaje` (plan §3,
 * test 3).
 */
export const EntregaColaSchema = z.object({
  /** ID de la entrega (BIGINT serializado a string). */
  id: z.string(),

  /** Estudiante dueño de la entrega. */
  estudiante: EstudianteColaSchema,

  /** Estado real de la entrega (`submission_status`). */
  estado: z.enum(ESTADOS_ENTREGA),

  /** Momento del envío (ISO 8601); `null` en los borradores. */
  entregadoEn: z.string().nullable(),

  /** Puntaje total al calificarse; `null` mientras espera al profesor. */
  puntaje: z.number().nullable(),

  /** Monedas otorgadas por `fn_award_coins` al pasar a `graded` (0 antes). */
  monedasOtorgadas: z.number(),
});

/**
 * `ListadoEntregasMetaDto` de H3.5: meta de la paginación estándar
 * (`?page=1&limit=20`, AGENTS.md §8). `page` es 1-indexada y `limit`
 * tiene tope 50 en el backend (la cola del profesor usa 20).
 */
export const MetaPaginacionSchema = z.object({
  /** Total de entregas que coinciden con el filtro. */
  total: z.number().int().min(0),

  /** Página actual (1-indexada). */
  page: z.number().int().min(1),

  /** Filas por página. */
  limit: z.number().int().min(1),
});

/** Estudiante de la cola, derivado del esquema zod. */
export type EstudianteCola = z.infer<typeof EstudianteColaSchema>;

/**
 * Fila de la cola en el vocabulario del frontend (plan §2).
 *
 * Espejo de {@link EntregaColaSchema}: ids ya como `string` y los `null`
 * de `entregadoEn`/`puntaje` conservados tal cual.
 */
export interface FilaCola {
  /** ID de la entrega como string (BigInt de la BD). */
  id: string;

  /** Estudiante dueño de la entrega. */
  estudiante: EstudianteCola;

  /** Estado real de la entrega. */
  estado: EstadoEntrega;

  /** Fecha de envío (ISO); `null` en los borradores. */
  entregadoEn: string | null;

  /** Puntaje total; `null` hasta calificar. */
  puntaje: number | null;

  /** Monedas otorgadas (`0` hasta calificar). */
  monedasOtorgadas: number;
}

/** Cola paginada con la envoltura estándar `{ data, meta }` (plan §2). */
export interface ColaEntregas {
  /** Filas de la página actual. */
  data: FilaCola[];

  /** Meta de la paginación estándar. */
  meta: { total: number; page: number; limit: number };
}

/**
 * Referencia a un archivo adjunto dentro de una respuesta `file`, tal
 * como vive en el JSONB `answers` (`docs/plataforma_educativa_bd.md` §6).
 *
 * `path` es la ruta interna generada por el servidor al subir el archivo
 * (no el nombre original). Aquí se valida de forma **tolerante** (solo
 * tipos): es una vista de solo lectura y la validación estricta (MIME,
 * regex de ruta, bytes) ya la hizo el backend al subir — si un dato
 * legado variara, la revisión no debe bloquearse (plan §5: las claves del
 * JSONB "se pintan tal cual").
 */
export const ArchivoRespuestaSchema = z.object({
  /** Ruta interna del archivo en el almacenamiento del servidor. */
  path: z.string(),

  /** Tipo MIME con el que se validó la subida. */
  mime: z.string(),

  /** Tamaño reportado por el servidor al subirlo (bytes). */
  bytes: z.number(),
});

/** Archivo adjunto de una respuesta, derivado del esquema zod. */
export type ArchivoRespuesta = z.infer<typeof ArchivoRespuestaSchema>;

/**
 * `RespuestaCalificada` de H3.5: una entrada del JSONB `answers` tal
 * como la ve el profesor en la vista de revisión.
 *
 * Forma real (verificada en `respuestas.schema.ts` + `auto-calificacion.ts`):
 * - `question_position` (1-indexada) más **una variante** de lo enviado:
 *   `option` (pregunta `test`), `text` (`completion`/`minigame`) o
 *   `files` (`file`, referencias a archivos subidos);
 * - el veredicto del backend `is_correct`/`score` — **opcional y
 *   nullable a propósito** (tolerancia a variantes del JSONB): `null`
 *   marca la pregunta pendiente de calificación manual (`minigame`/
 *   `file`) y **ausente** cuando el JSONB aún no tiene veredicto (el
 *   borrador `in_progress` se guarda sin evaluar, AGENTS.md §9.5).
 *
 * Las claves van en inglés porque son contrato de la BD; las etiquetas
 * visibles de la vista son cosa de la página (plan §5).
 */
export const RespuestaCalificadaSchema = z.object({
  /** Posición 1-indexada de la pregunta respondida. */
  question_position: z
    .number({ error: "La posición de la pregunta (question_position) debe ser un número." })
    .int({ error: "La posición de la pregunta (question_position) debe ser un número entero." })
    .min(1, "La posición de la pregunta (question_position) debe ser mayor que 0."),

  /** Opción elegida (variante de preguntas `test`). */
  option: z.string().optional(),

  /** Respuesta de texto (variante `completion`/`minigame`). */
  text: z.string().optional(),

  /** Archivos adjuntos (variante `file`); referencias, nunca el contenido. */
  files: z.array(ArchivoRespuestaSchema).optional(),

  /** Veredicto: `true`/`false`; `null` o ausente = sin evaluar aún. */
  is_correct: z.boolean().nullable().optional(),

  /** Puntaje obtenido en la pregunta; `null` o ausente = sin evaluar. */
  score: z.number().nullable().optional(),
});

/** Respuesta con veredicto, derivada del esquema zod. */
export type RespuestaCalificada = z.infer<typeof RespuestaCalificadaSchema>;

/**
 * `EntregaDetalleProfesorDto` de H3.5 (DTO **plano** de
 * `GET /activities/:id/submissions/:entregaId`): la fila de la cola más
 * las respuestas con veredicto, la retroalimentación y `calificadoEn`.
 *
 * Notas del contrato real (mapper `aEntregaDetalleProfesor`):
 * - `calificadoEn` es `graded_at` y solo se setea al pasar a `graded`
 *   (en `rejected` la BD lo deja `null`);
 * - `entregadoEn` es `null` en los borradores (`in_progress`);
 * - `puntaje` es `null` hasta calificar (`NUMERIC(6,2)` → `number`);
 * - `monedasOtorgadas` lo escribe el trigger `fn_award_coins` (`0`
 *   antes de `graded`) — la UI jamás lo calcula (AGENTS.md §6).
 */
export const EntregaDetalleSchema = z.object({
  /** ID de la entrega (BIGINT serializado a string). */
  id: z.string(),

  /** Estudiante dueño de la entrega (mismo shape que la cola). */
  estudiante: EstudianteColaSchema,

  /** Estado real de la entrega (`submission_status`). */
  estado: z.enum(ESTADOS_ENTREGA),

  /** Momento del envío (ISO 8601); `null` en los borradores. */
  entregadoEn: z.string().nullable(),

  /** Momento de la calificación (ISO 8601); `null` sin calificar. */
  calificadoEn: z.string().nullable(),

  /** Puntaje total al calificarse; `null` mientras espera al profesor. */
  puntaje: z.number().nullable(),

  /** Monedas otorgadas por `fn_award_coins` al pasar a `graded` (0 antes). */
  monedasOtorgadas: z.number(),

  /** Retroalimentación del profesor; `null` si no se escribió. */
  feedback: z.string().nullable(),

  /** Entradas del JSONB `answers`: lo enviado + veredicto. */
  respuestas: z.array(RespuestaCalificadaSchema),
});

/** Detalle de revisión derivado del esquema zod (plan §2). */
export interface EntregaDetalle {
  /** ID de la entrega (BigInt de la BD como string). */
  id: string;

  /** Estudiante dueño de la entrega. */
  estudiante: EstudianteCola;

  /** Estado real de la entrega. */
  estado: EstadoEntrega;

  /** Fecha de envío (ISO); `null` en los borradores. */
  entregadoEn: string | null;

  /** Fecha de calificación (ISO); `null` sin calificar. */
  calificadoEn: string | null;

  /** Puntaje total; `null` hasta calificar. */
  puntaje: number | null;

  /** Monedas otorgadas (`0` hasta calificar). */
  monedasOtorgadas: number;

  /** Retroalimentación escrita al calificar; `null` si no hay. */
  feedback: string | null;

  /** Respuestas del estudiante con su veredicto. */
  respuestas: RespuestaCalificada[];
}

/** Decisiones de calificación del profesor (`CalificarEntregaDto` de H3.5). */
export const DECISIONES_CALIFICACION = ["graded", "rejected"] as const;

/** Decisión válida: transición permitida desde `submitted`. */
export type DecisionCalificacion = (typeof DECISIONES_CALIFICACION)[number];

/**
 * `CalificarEntregaDto` de H3.5 (espejo de
 * `src/modules/submissions/dto/calificar-entrega.dto.ts`): lo que envía el
 * profesor para dejar una entrega `submitted` en `graded` o `rejected`.
 *
 * Reglas condicionales (el Service de H3.5 las re-aplica como red final):
 * - `graded` **exige** `puntaje`: numérico, 0..9999.99 (`NUMERIC(6,2)`),
 *   hasta 2 decimales. El tope real por actividad (0..total de
 *   `preguntas[].score`) lo conoce solo la vista — vía `obtenerActividad` —
 *   y lo re-valida el backend con 422; este esquema no ve el total.
 * - `rejected` **prohíbe** `puntaje`: la nota queda `null`.
 * - `feedback` opcional (1..2000): la retroalimentación que verá el
 *   estudiante (un string vacío se omite antes de enviar).
 *
 * Un payload que viole estas reglas se convierte en `ApiError` 422 con
 * {@link mensajeDeErroresZod} **sin invocar el transporte** (plan §3,
 * test 4).
 */
export const CalificacionSchema = z
  .object({
    /** Transición a aplicar: `graded` (aprobar) o `rejected` (rechazar). */
    decision: z.enum(DECISIONES_CALIFICACION),

    /**
     * Puntaje total de la actividad (0..9999.99, ≤ 2 decimales).
     * Obligatorio solo con `graded`; prohibido con `rejected`.
     */
    puntaje: z
      .number({ error: "El puntaje debe ser un número." })
      .min(0, "El puntaje no puede ser negativo.")
      .max(9999.99, "El puntaje no puede superar 9999.99.")
      .refine(
        (valor) => Math.round(valor * 100) / 100 === valor,
        { message: "El puntaje admite hasta 2 decimales." },
      )
      .optional(),

    /** Retroalimentación para el estudiante (opcional, 1..2000). */
    feedback: z
      .string({ error: "El feedback debe ser un texto." })
      .min(1, "El feedback no puede estar vacío: omítelo si no quieres escribir nada.")
      .max(2000, "El feedback no puede superar los 2000 caracteres.")
      .optional(),
  })
  .superRefine((datos, contexto) => {
    if (datos.decision === "graded" && datos.puntaje === undefined) {
      contexto.addIssue({
        code: "custom",
        path: ["puntaje"],
        message: "Para aprobar la entrega (graded) debes indicar el puntaje.",
      });
    }

    if (datos.decision === "rejected" && datos.puntaje !== undefined) {
      contexto.addIssue({
        code: "custom",
        path: ["puntaje"],
        message: "No se envía puntaje al rechazar una entrega (rejected).",
      });
    }
  });

/**
 * Datos de calificación en el vocabulario del frontend (plan §2): espejo
 * de la entrada de {@link CalificacionSchema} y del body del
 * `POST /activities/:id/submissions/:entregaId/calificar`.
 */
export interface DatosCalificacion {
  /** Transición a aplicar (`graded` aprueba, `rejected` rechaza). */
  decision: DecisionCalificacion;

  /** Puntaje total; requerido con `graded`, prohibido con `rejected`. */
  puntaje?: number;

  /** Retroalimentación opcional (≤ 2000). */
  feedback?: string;
}
