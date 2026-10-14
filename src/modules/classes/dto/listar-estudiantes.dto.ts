import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Parámetros de paginación del listado de estudiantes de una clase
 * (GET /api/v1/classes/:id/estudiantes). Paginación estándar de los
 * listados del proyecto (AGENTS.md §8): ?page=1&limit=20.
 */
export class ListarEstudiantesQueryDto {
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
}
