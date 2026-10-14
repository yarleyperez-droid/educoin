import type { enrollment_status } from '../../../generated/prisma/client';
import type { ListadoMetaDto } from './clase-respuesta.dto';

/**
 * Un estudiante inscrito en la clase, tal como SALE hacia el profesor.
 * Solo identidad y estado de la inscripción (mínima exposición): sin
 * monedas ni email — el select de Prisma ni siquiera los lee. Los IDs
 * viajan como string porque BigInt no se serializa a JSON (AGENTS.md §7).
 */
export class EstudianteInscritoDto {
  /** Id de la INSCRIPCIÓN (enrollments.id). */
  id!: string;
  /** Id del usuario estudiante (users.id). */
  estudianteId!: string;
  username!: string;
  nombre!: string;
  estado!: enrollment_status;
  inscritoEn!: string;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoEstudiantesDto {
  data!: EstudianteInscritoDto[];
  meta!: ListadoMetaDto;
}
