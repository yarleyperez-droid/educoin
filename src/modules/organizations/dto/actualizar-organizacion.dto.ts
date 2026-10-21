import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { organization_type } from '../../../generated/prisma/client';

/**
 * Edición parcial de una organización: nombre, tipo, ciudad y/o estado
 * activo. Todos los campos son opcionales, pero debe llegar AL MENOS
 * uno — un cuerpo vacío no cambia nada y el Service responde 400 en
 * lugar de un no-op (patrón de ActualizarClaseDto). ciudad acepta null
 * para limpiarse (la columna es nullable); activa=true reactiva y
 * activa=false desactiva, que es el borrado lógico del recurso (la
 * tabla no tiene deleted_at: is_active ES su ciclo de vida). El id y
 * las fechas no son editables: updated_at lo mantiene el trigger
 * fn_set_updated_at (AGENTS.md §6) y created_at es inmutable.
 */
export class ActualizarOrganizacionDto {
  /** Nombre visible (misma regla que al crear: VARCHAR(200) único). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  nombre?: string;

  /** Tipo de organización (enum organization_type de la BD). */
  @ApiProperty({
    enum: organization_type,
    description: 'Tipo de organización: school, university u other.',
  })
  @IsOptional()
  @IsIn(Object.values(organization_type))
  tipo?: organization_type;

  /** null limpia la ciudad; la cadena vacía se rechaza (VARCHAR(100)). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ciudad?: string | null;

  /** Activa o desactiva la organización (organizations.is_active). */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
