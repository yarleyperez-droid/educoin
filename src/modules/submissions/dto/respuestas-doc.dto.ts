import { ApiProperty } from '@nestjs/swagger';
import {
  MAX_ARCHIVOS_POR_PREGUNTA,
  MIMES_PERMITIDOS,
} from '../validar-archivo';

/**
 * DTOs de DOCUMENTACIÓN del JSONB `answers` de las entregas
 * (submissions.answers — docs/plataforma_educativa_bd.md §6). La
 * validación REAL la hace zod en dto/respuestas.schema.ts contra las
 * preguntas reales de la actividad (AGENTS.md §2): estas clases existen
 * solo para que Swagger muestre la estructura y nunca se instancian.
 *
 * Una respuesta individual referencia su pregunta por posición y, según
 * el TIPO de esa pregunta, lleva la opción elegida (test), el texto de
 * la respuesta (completion/minigame) o las referencias a los archivos
 * YA SUBIDOS (file) — nunca el contenido del archivo.
 */

/** Metadata de un archivo adjunto, tal como la devuelve el endpoint de subida. */
export class ArchivoRespuestaDocDto {
  @ApiProperty({
    example: '7/1/3f2504e0-4f89-11d3-9a0c-0305e82c3301.pdf',
    description:
      'Ruta INTERNA generada por el servidor al subir el archivo (POST .../archivos): {actividadId}/{inscripcionId}/{uuid}.{ext}. No es el nombre original del estudiante: ese jamás se persiste.',
  })
  path!: string;

  @ApiProperty({
    enum: MIMES_PERMITIDOS,
    description: 'Tipo real del archivo (validado por magic bytes al subirlo).',
  })
  mime!: string;

  @ApiProperty({
    example: 12345,
    description: 'Tamaño en bytes, tal como lo reportó el endpoint de subida.',
  })
  bytes!: number;
}

/** Una respuesta del estudiante, tal como se guarda en el borrador. */
export class RespuestaDocDto {
  @ApiProperty({
    example: 1,
    description:
      'Posición de la pregunta que responde (activities.questions[].position). Una respuesta por pregunta, sin repetir.',
  })
  question_position!: number;

  @ApiProperty({
    required: false,
    description: 'SOLO preguntas test: el TEXTO de la opción elegida.',
  })
  option?: string;

  @ApiProperty({
    required: false,
    description:
      'SOLO preguntas completion/minigame: la respuesta abierta (o el resultado del minijuego alcanzado).',
  })
  text?: string;

  @ApiProperty({
    type: [ArchivoRespuestaDocDto],
    required: false,
    description: `SOLO preguntas file: referencias a archivos YA SUBIDOS con el endpoint de subida (máximo ${MAX_ARCHIVOS_POR_PREGUNTA}); un arreglo vacío desadjunta lo subido. Nunca lleva is_correct/score.`,
  })
  files?: ArchivoRespuestaDocDto[];
}

/**
 * Una respuesta YA calificada, tal como sale en la entrega enviada: lo
 * que el estudiante envió MÁS el veredicto del backend
 * (is_correct/score por respuesta — AGENTS.md §9.5). Solo viaja
 * DESPUÉS del envío: el borrador jamás la incluye.
 */
export class RespuestaCalificadaDocDto extends RespuestaDocDto {
  @ApiProperty({
    nullable: true,
    description:
      'Veredicto de la auto-calificación de la pregunta; null = pendiente de calificación manual (file/minigame).',
  })
  is_correct!: boolean | null;

  @ApiProperty({
    nullable: true,
    description:
      'Puntaje obtenido en la pregunta (0 al fallar); null = pendiente de calificar.',
  })
  score!: number | null;
}
