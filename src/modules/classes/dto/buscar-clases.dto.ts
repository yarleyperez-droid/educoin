import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Parámetros de búsqueda de clases por nombre (GET /api/v1/classes).
 *
 * `q` es **opcional**: cuando se omite, el endpoint lista todas las clases
 * visibles para el rol del usuario (para `teacher`, las suyas propias),
 * ordenadas por fecha de creación descendente. Esto permite al panel docente
 * mostrar su resumen de clases sin depender de un texto de búsqueda.
 *
 * Cuando `q` viene presente, el mínimo de 3 caracteres sigue la mecánica de
 * pg_trgm: los trigramas se extraen de 3 caracteres consecutivos, y consultas
 * más cortas no aprovechan el índice GIN ni producen similitud útil.
 */
export class BuscarClasesQueryDto {
  /** Texto a buscar: coincide por similitud trigram o por subcadena. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  q?: string;

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
