import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import type { item_status, item_type } from '../../../generated/prisma/client';

/** Tipos admitidos por la columna `item_type` de la BD. */
const TIPOS: readonly item_type[] = ['grade_bonus', 'fun_activity'];

/** Estados editables desde PATCH (el borrado es solo DELETE). */
const ESTADOS_EDITABLES: readonly item_status[] = ['active', 'inactive'];

/**
 * Datos para crear un ítem canjeable (H4.1 / PRO-279, T4.1.1).
 *
 * Los campos numéricos NO llevan `@Min`/`@IsPositive`: la regla de
 * negocio (> 0, stock ≥ 0, obligatoriedad por tipo) se evalúa en el
 * Service y responde **422** (CA 4 y T4.1.2). Aquí solo se valida
 * estructura → errores 400 (pipe global con whitelist).
 */
export class CrearItemDto {
  /** Clase a la que pertenece el ítem (BIGINT como número). */
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  classId!: number;

  /** Nombre visible (VARCHAR(150) NOT NULL, único por clase). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  /** Texto descriptivo opcional (acepta `null` explícito). */
  @IsOptional()
  @IsString()
  description?: string | null;

  /** `grade_bonus` (puntos de nota) o `fun_activity` (actividad con stock). */
  @IsIn(TIPOS)
  type!: item_type;

  /** Costo en monedas; la regla > 0 es de negocio (422). */
  @Type(() => Number)
  @IsInt()
  costCoins!: number;

  /** Puntos de nota; obligatorio (> 0) solo para `grade_bonus` (422). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gradePoints?: number | null;

  /** Stock; obligatorio (≥ 0) solo para `fun_activity` (422). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock?: number | null;
}

/**
 * Edición parcial de un ítem (H4.1 / PRO-279).
 *
 * No incluye `type` ni `classId`: el tipo no cambia en caliente (supuesto
 * 5 de la spec) y la clase del ítem es inmutable. La validación por tipo
 * se re-evalúa sobre el **resultado** del merge (422 si el merge deja el
 * ítem inválido).
 */
export class ActualizarItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  costCoins?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  gradePoints?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock?: number | null;

  /** `deleted` no se envía aquí: el borrado tiene su propio endpoint. */
  @IsOptional()
  @IsIn(ESTADOS_EDITABLES)
  status?: 'active' | 'inactive';
}

/**
 * Query para listar los ítems de una clase (H4.1 / T4.1.1).
 */
export class ListarItemsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  classId!: number;
}

/**
 * Respuesta de un ítem (H4.1 / T4.1.1).
 *
 * IDs como `string` y fechas ISO (AGENTS §7); `gradePoints`/`stock` como
 * `number | null` (`null` según el tipo del ítem).
 */
export class ItemDto {
  id!: string;
  classId!: string;
  name!: string;
  description!: string | null;
  type!: item_type;
  costCoins!: number;
  gradePoints!: number | null;
  stock!: number | null;
  status!: item_status;
  creadoEn!: string;
  actualizadoEn!: string;
}
