import type { enrollment_status } from '../../../generated/prisma/client';
import type { ListadoMetaDto } from './clase-respuesta.dto';

/**
 * Una inscripción activa del estudiante en una clase.
 *
 * Solo expone el id de la inscripción (para poder pedir
 * `GET /enrollments/:id/activities`), el id y nombre de la clase, y la
 * fecha de inscripción. No incluye el código de unión ni datos del
 * profesor (mínima exposición, AGENTS.md §8).
 */
export class InscripcionListadoDto {
  /** Id de la inscripción (`enrollments.id`). */
  id!: string;

  /** Clase en la que está inscrito el estudiante. */
  clase!: { id: string; nombre: string };

  /** Estado de la inscripción (devuelve solo `active` en este listado). */
  estado!: enrollment_status;

  /** Fecha/hora de inscripción en formato ISO 8601. */
  inscritoEn!: string;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoInscripcionesDto {
  data!: InscripcionListadoDto[];
  meta!: ListadoMetaDto;
}
