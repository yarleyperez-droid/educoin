import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PreguntaDocDto } from './preguntas-doc.dto';

/**
 * Edición parcial de una actividad (solo borradores; una actividad
 * publicada solo acepta cambiar cierraEn — ver ActivitiesService).
 *
 * Todos los campos son opcionales, pero debe llegar AL MENOS uno: un
 * cuerpo vacío no cambia nada y el Service responde 400 en lugar de un
 * no-op (mismo patrón que ActualizarClaseDto). El estado, la clase y
 * las fechas de publicación/eliminación NO son editables desde aquí:
 * la máquina de estados (draft → published → deleted) solo avanza por
 * sus endpoints dedicados.
 */
export class ActualizarActividadDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  recompensaMonedas?: number;

  /** Preguntas completas: reemplazan el JSONB existente (validadas con zod). */
  @ApiProperty({
    type: [PreguntaDocDto],
    description:
      'Preguntas COMPLETAS: reemplazan el JSONB existente (misma estructura que al crear; validadas con zod en el backend).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  preguntas?: unknown[];

  @IsOptional()
  @IsISO8601()
  cierraEn?: string;
}
