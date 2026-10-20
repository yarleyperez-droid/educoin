import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { user_role } from '../../../generated/prisma/client';

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
 * Parámetros del listado de usuarios (GET /api/v1/users): paginación
 * estándar (AGENTS.md §8) más filtros opcionales de texto (busca en
 * usuario, correo, nombre y apellido), rol, organización y estado
 * activo. A diferencia de la búsqueda de clases, users no tiene índice
 * pg_trgm: el filtro de texto es un contains insensible (ILIKE) simple
 * y no exige mínimo de caracteres, igual que el de organizaciones.
 */
export class ListarUsuariosQueryDto {
  /** Busca en usuario, correo, nombre y apellido: contains insensible. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q?: string;

  /**
   * Filtra por rol (enum user_role completo: listar es de solo lectura
   * y el admin también puede querer ver otros admins).
   */
  @IsOptional()
  @IsIn(Object.values(user_role))
  rol?: user_role;

  /** Filtra por organización (id numérico como string). */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(20)
  organizacionId?: string;

  /** true → solo activos; false → solo desactivados. */
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
