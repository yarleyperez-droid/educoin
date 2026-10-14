/**
 * Tipos compartidos del dominio de clases (T5.6.1, PRO-385).
 *
 * Espejo de los DTOs de salida de H3.1 (`src/modules/classes/dto/`):
 * - `ClaseRespuestaDto` → {@link Clase}
 * - `ListadoMetaDto` → {@link Meta}
 *
 * Los IDs viajan como `string` porque la BD usa `bigint` y `BigInt` no se
 * serializa a JSON (AGENTS.md §7). Si el Swagger de H3.1 cambia un nombre,
 * el mapeo se ajusta en `api/clases.ts` (único punto de traducción) y estas
 * vistas no se enteran.
 */

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
