import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query de los listados paginados de canjes (H7.2 / T7.2.4-T7.2.5):
 * `GET /redemptions/pending` (cola del profesor) y `GET /redemptions/mine`
 * (historial del estudiante). Paginación estándar del repo `{ data, meta }`.
 */
export class ListarCanjesQueryDto {
  /** Página 1-indexada. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Filas por página (tope 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
