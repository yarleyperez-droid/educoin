import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { organization_type } from '../../../generated/prisma/client';

/**
 * Convierte el query string a booleano real antes de la validación:
 * sin esto, Boolean('false') sería true (la trampa clásica de
 * @Type(() => Boolean) con strings de query). Los valores que no son
 * 'true'/'false' pasan intactos para que @IsBoolean() los rechace con
 * 400 en lugar de interpretarlos en silencio.
 */
const aBooleano = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return value;
};

/**
 * Parámetros del listado de organizaciones (GET /api/v1/organizations):
 * paginación estándar (AGENTS.md §8) más filtros opcionales de nombre,
 * tipo y estado. A diferencia de la búsqueda de clases, aquí no hay
 * índice pg_trgm (organizations no lo tiene): el filtro de nombre es un
 * contains insensible (ILIKE) simple y no exige mínimo de caracteres.
 */
export class ListarOrganizacionesQueryDto {
  /** Filtra por nombre: contiene, sin distinguir mayúsculas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  q?: string;

  /** Filtra por tipo de organización (enum de la BD). */
  @IsOptional()
  @IsIn(Object.values(organization_type))
  tipo?: organization_type;

  /** true → solo activas; false → solo desactivadas. */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  activa?: boolean;

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
