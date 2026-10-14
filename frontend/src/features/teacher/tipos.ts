/**
 * Tipos compartidos del dominio del panel docente (T5.6.1 y T5.6.2).
 *
 * - **Clases** (T5.6.1): espejo de los DTOs de salida de H3.1
 *   (`src/modules/classes/dto/`): `ClaseRespuestaDto` → {@link Clase},
 *   `ListadoMetaDto` → {@link Meta}.
 * - **Actividades** (T5.6.2): {@link Actividad} deriva de
 *   `db/001_schema.sql` porque H3.3 aún no publicó sus DTOs (envelope
 *   provisional, ver su docstring).
 *
 * Los IDs viajan como `string` porque la BD usa `bigint` y `BigInt` no se
 * serializa a JSON (AGENTS.md §7). Si el Swagger cambia un nombre, el
 * mapeo se ajusta en `api/clases.ts` / `api/actividades.ts` (único punto
 * de traducción) y estas vistas no se enteran.
 */

import type { Pregunta } from "./contrato/actividades";

/** Estados de clase (enum `class_status` de `db/001_schema.sql`). */
export type EstadoClase = "active" | "archived";

/**
 * Clase tal y como sale de `ClaseRespuestaDto` (H3.1).
 *
 * `codigo` es el código de unión de 8 caracteres **generado por la BD**
 * (DEFAULT de `classes.code`); jamás se envía desde el cliente
 * (AGENTS.md §7) y solo llega en la respuesta de `POST /classes`.
 */
export interface Clase {
  /** ID de la clase como string (BigInt de la BD). */
  id: string;

  /** ID del profesor dueño de la clase (sale del token, nunca del body). */
  profesorId: string;

  /** Nombre visible (VARCHAR(150), único por profesor vía índice). */
  nombre: string;

  /** Código de unión de 8 caracteres (`A-Z0-9`), generado por PostgreSQL. */
  codigo: string;

  /** Estado lógico: `active` o `archived`. */
  estado: EstadoClase;

  /** Fecha de creación en formato ISO. */
  creadoEn: string;

  /** Fecha de la última modificación en formato ISO. */
  actualizadoEn: string;
}

/**
 * Meta de paginación estándar de los listados (`{ data, meta }`,
 * AGENTS.md §8).
 */
export interface Meta {
  /** Total de filas que coinciden con la búsqueda. */
  total: number;

  /** Página actual (1-indexada). */
  page: number;

  /** Filas por página (tope 50 en el backend). */
  limit: number;
}

/**
 * Estados de actividad (enum `activity_status` de `db/001_schema.sql`).
 *
 * - `draft` → editable y publicable;
 * - `published` → visible para el estudiante (sin reversión a `draft`, CA 3
 *   de H5.6);
 * - `deleted` → borrado lógico (`deleted_at`), invisible en los listados.
 */
export type EstadoActividad = "draft" | "published" | "deleted";

/**
 * Actividad tal y como se modela en la BD (`activities`) con el vocabulario
 * del frontend.
 *
 * **Envelope provisional (T5.6.2):** H3.3 no ha publicado sus DTOs, así que
 * este shape deriva de `db/001_schema.sql` (IDs como string por BigInt,
 * fechas ISO). Cuando H3.3 entregue su contrato, el mapeo se ajusta en
 * `api/actividades.ts` sin tocar ni esta definición ni las vistas.
 */
export interface Actividad {
  /** ID de la actividad (BigInt de la BD como string). */
  id: string;

  /** Clase dueña de la actividad (FK `activities.class_id`). */
  claseId: string;

  /** Título visible (`activities.title NOT NULL`). */
  titulo: string;

  /** Descripción opcional (`activities.description`). */
  descripcion: string | null;

  /** Monedas otorgadas al calificar (`reward_coins ≥ 0`). */
  recompensaMonedas: number;

  /** Estado lógico de la actividad. */
  estado: EstadoActividad;

  /** JSONB `questions` ya validado por el contrato zod. */
  preguntas: Pregunta[];

  /** Fecha de publicación (ISO) o `null` mientras sea `draft`. */
  publicadaEn: string | null;

  /** Fecha de creación (ISO). */
  creadaEn: string;

  /** Fecha de la última modificación (ISO). */
  actualizadaEn: string;
}
