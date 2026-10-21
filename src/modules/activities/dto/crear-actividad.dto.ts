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
 * Datos para crear una actividad en una clase del profesor autenticado.
 *
 * El estado NO viaja aquí: la BD crea toda actividad como 'draft'
 * (DEFAULT de activities.status — db/001_schema.sql §7) y solo el
 * endpoint de publicación puede pasarla a 'published'. Tampoco se
 * aceptan published_at ni deleted_at: los setea el backend al
 * publicar/eliminar. La clase sale del parámetro de ruta
 * `:claseId` (verificado por @PerteneceA), jamás del cuerpo.
 *
 * `preguntas` es OBLIGATORIO y sigue la estructura del JSONB de la seed
 * (db/002_seed.sql §7): la validación profunda de cada pregunta
 * (posición secuencial, tipos, opciones con una única correcta,
 * expected_answer en completion…) la hace zod en el Service
 * (dto/preguntas.schema.ts), porque la BD solo comprueba que sea un
 * arreglo JSON.
 */
export class CrearActividadDto {
  /** Título visible (la BD exige VARCHAR(200) NOT NULL). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo!: string;

  /** Enunciado general de la actividad (TEXT, opcional). */
  @IsOptional()
  @IsString()
  descripcion?: string;

  /** Recompensa en monedas al calificar la entrega (CHECK >= 0). */
  @IsOptional()
  @IsInt()
  @Min(0)
  recompensaMonedas?: number;

  /**
   * Preguntas embebidas (activities.questions, JSONB): estructura de la
   * seed. Se recibe como arreglo sin tipar y lo valida zod en el Service.
   */
  @ApiProperty({
    type: [PreguntaDocDto],
    description:
      'Preguntas de la actividad (JSONB, validadas con zod en el backend): cada una con position secuencial desde 1, type, prompt y score; las test con options (exactamente una is_correct=true) y las completion con expected_answer.',
    example: [
      {
        position: 1,
        type: 'test',
        prompt: '¿Cuánto es 2 + 2?',
        score: 5,
        options: [
          { text: '3', is_correct: false },
          { text: '4', is_correct: true },
        ],
      },
      {
        position: 2,
        type: 'completion',
        prompt: 'Escribe el resultado de 2×2',
        score: 5,
        expected_answer: '4',
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  preguntas!: unknown[];

  /** Fecha opcional de cierre (closes_at, TIMESTAMPTZ ISO 8601). */
  @IsOptional()
  @IsISO8601()
  cierraEn?: string;
}
