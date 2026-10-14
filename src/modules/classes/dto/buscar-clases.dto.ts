import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Parámetros de búsqueda de clases por nombre (GET /api/v1/classes).
 * El mínimo de 3 caracteres para `q` sigue la mecánica de pg_trgm: los
 * trigramas se extraen de 3 caracteres consecutivos, y consultas más
 * cortas no aprovechan el índice GIN ni producen similitud útil.
 */
export class BuscarClasesQueryDto {
  /** Texto a buscar: coincide por similitud trigram o por subcadena. */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  q!: string;

  /** Página 1-indexada para la paginación { data, meta }. */
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
