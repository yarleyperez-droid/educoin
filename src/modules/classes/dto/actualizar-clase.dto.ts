import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { class_status } from '../../../generated/prisma/client';

/**
 * Edición parcial de una clase: nombre y/o estado (archivar o reactivar).
 * Ambos campos son opcionales, pero debe llegar AL MENOS uno — un cuerpo
 * vacío no cambia nada y el Service responde 400 en lugar de un no-op.
 * El código de unión y el profesor NO son editables: el primero lo genera
 * y posee la BD y el segundo sale del token (prevención de IDOR).
 */
export class ActualizarClaseDto {
  /** Nombre visible de la clase (misma regla que al crear: VARCHAR(150)). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(150)
  nombre?: string;

  /** Estado de la clase: 'active' o 'archived' (enum class_status de la BD). */
  @ApiProperty({
    enum: class_status,
    description:
      'Nuevo estado de la clase: active (reactivar) o archived (archivar).',
  })
  @IsOptional()
  @IsIn(Object.values(class_status))
  estado?: class_status;
}
