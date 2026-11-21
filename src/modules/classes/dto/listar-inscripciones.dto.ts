import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Parámetros de listado de inscripciones del estudiante
 * (`GET /api/v1/enrollments`).
 *
 * Solo paginación: por defecto 50 filas y tope 50; un estudiante raramente
 * tendrá más clases activas, y si las tiene puede paginar con `page`.
 */
export class ListarInscripcionesQueryDto {
  /** Página 1-indexada para la paginación { data, meta }. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Filas por página (tope 50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
