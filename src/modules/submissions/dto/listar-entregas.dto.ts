import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { submission_status } from '../../../generated/prisma/client';

/**
 * Parámetros de la cola de entregas del profesor
 * (GET /api/v1/activities/:id/submissions/queue). Paginación estándar de
 * los listados del proyecto (AGENTS.md §8): ?page=1&limit=20, con filtro
 * opcional por estado del enum real submission_status de la BD
 * (in_progress | submitted | graded | rejected).
 *
 * El caso principal de la cola de calificación es ?estado=submitted: las
 * entregas que esperan la revisión del profesor. Sin filtro llegan TODAS
 * (mismo criterio que el listado de actividades por clase): el profesor
 * también quiere ver las calificadas de un vistazo.
 */
export class ListarEntregasQueryDto {
  /** Página 1-indexada. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Filas por página (tope 50 para evitar listados gigantes). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Filtro opcional por estado: in_progress, submitted, graded o rejected. */
  @IsOptional()
  @IsIn(Object.values(submission_status))
  estado?: submission_status;
}
