import type { class_status } from '../../../generated/prisma/client';

/**
 * Datos de la clase que SALEN hacia el cliente (AGENTS.md §8: nunca se
 * devuelven entidades Prisma crudas). Los IDs viajan como string porque
 * BigInt no se serializa a JSON (AGENTS.md §7).
 */
export class ClaseRespuestaDto {
  id!: string;
  profesorId!: string;
  nombre!: string;
  /** Código de unión generado por la BD (8 caracteres). */
  codigo!: string;
  estado!: class_status;
  creadoEn!: string;
  actualizadoEn!: string;
}

/**
 * Respuesta de POST /api/v1/classes: confirma la creación y destaca el
 * código de unión para que el profesor lo comparta con sus estudiantes.
 * El código solo se conoce después del INSERT (lo genera la BD), así que
 * el mensaje se arma con el código real de la clase creada.
 */
export class ClaseCreadaRespuestaDto {
  mensaje!: string;
  clase!: ClaseRespuestaDto;
}
