/**
 * Tipos compartidos del dominio del panel docente (T5.6.1 y T5.6.2).
 *
 * - **Clases** (T5.6.1): espejo de los DTOs de salida de H3.1
 *   (`src/modules/classes/dto/`): `ClaseRespuestaDto` → {@link Clase},
 *   `ListadoMetaDto` → {@link Meta}.
 * - **Actividades** (T5.6.2): espejo de los DTOs de salida de H3.3
 *   (`src/modules/activities/dto/`): `ActividadRespuestaDto` →
 *   {@link Actividad}, `ActividadListadoDto` → su proyección sin preguntas
 *   (el detalle completo solo llega por `GET /activities/:id`).
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
 * Ítem del listado de clases — espejo de `ClaseListadoDto` (H3.1).
 *
 * **Sin `codigo`** a propósito: verlo en un listado permitiría
 * auto-inscribirse sin que el profesor comparta el código (decisión del
 * backend, spec §Contrato 3 de T5.6.3). El código solo se muestra al
 * crear la clase (T5.6.1, CA 1 de H5.6). Tampoco expone
 * `profesorId`/organización: solo el nombre del profesor.
 */
export interface ClaseListado {
  /** ID de la clase (BigInt de la BD como string). */
  id: string;

  /** Nombre visible de la clase. */
  nombre: string;

  /** Estado lógico de la clase. */
  estado: EstadoClase;

  /** Nombre completo del profesor dueño de la clase. */
  profesorNombre: string;

  /** Fecha de creación (ISO). */
  creadoEn: string;
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
 * Actividad tal y como la devuelve `ActividadRespuestaDto` (H3.3) con el
 * vocabulario del frontend.
 *
 * El mapeo real desde el backend (incluida la traducción
 * `creadoEn → creadaEn`, que preserva el nombre histórico del frontend)
 * vive en `api/actividades.ts`. El listado real (`ActividadListadoDto`)
 * **no** trae `preguntas`, `descripcion` ni `actualizadoEn`: la fachada
 * completa esos campos con valores neutros al mapear sus filas.
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

  /** Fecha de cierre (ISO) o `null` si la actividad no cierra. */
  cierraEn: string | null;

  /** Fecha de creación (ISO). */
  creadaEn: string;

  /** Fecha de la última modificación (ISO). */
  actualizadaEn: string;
}
