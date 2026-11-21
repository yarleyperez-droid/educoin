import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query de los rankings (H4.3 / PRO-281). Paginación idéntica a la
 * billetera (S6): `page`/`limit` opcionales con defaults 1/20 en el
 * service y tope 100; la pipe global responde 400 ante valores fuera de
 * rango o campos desconocidos.
 */
export class RankingQueryDto {
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
