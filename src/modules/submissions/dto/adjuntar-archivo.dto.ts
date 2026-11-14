import { IsInt, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Datos de la SUBIDA de archivos
 * (POST /activities/:id/submissions/archivos, multipart/form-data):
 * la posición de la pregunta `file` a la que se adjuntan.
 *
 * El resto de la petición son los archivos en el campo multipart
 * `archivos` (hasta MAX_ARCHIVOS_POR_PREGUNTA): los toma el
 * FilesInterceptor y NO viajan en el body. En multipart los campos de
 * texto llegan como string: @Type los convierte para que @IsInt valide
 * el número y no su forma textual.
 *
 * La actividad sale del parámetro de ruta `:id` y la inscripción JAMÁS
 * viaja en el cuerpo: el backend la deriva del token (AGENTS.md §9.7).
 */
export class AdjuntarArchivoDto {
  /** Pregunta de tipo file que recibe los archivos subidos. */
  @Type(() => Number)
  @IsInt({
    message:
      'La posición de la pregunta (question_position) debe ser un número entero.',
  })
  @IsPositive({
    message:
      'La posición de la pregunta (question_position) debe ser un entero positivo (desde 1).',
  })
  question_position!: number;
}
