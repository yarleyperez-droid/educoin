import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { activity_status } from '../../../generated/prisma/client';

/**
 * Parámetros del listado de actividades de una clase
 * (GET /api/v1/classes/:claseId/activities). Paginación estándar de los
 * listados del proyecto (AGENTS.md §8): ?page=1&limit=20, con filtro
 * opcional por estado del enum real activity_status de la BD
 * (draft | published | deleted).
 */
export class ListarActividadesQueryDto {
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

  /** Filtro opcional por estado: 'draft', 'published' o 'deleted'. */
  @ApiProperty({
    enum: activity_status,
    description: 'Filtro opcional por estado: draft, published o deleted.',
  })
  @IsOptional()
  @IsIn(Object.values(activity_status))
  estado?: activity_status;
}

/**
 * Parámetros del listado del ESTUDIANTE
 * (GET /api/v1/enrollments/:inscripcionId/activities). Solo paginación:
 * el filtro es fijo por diseño — el estudiante únicamente ve las
 * actividades published de la clase de su inscripción, así que no hay
 * ?estado que elegir (mandarlo se rechaza con 400 por el whitelist).
 */
export class ListarActividadesPublicadasQueryDto {
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
