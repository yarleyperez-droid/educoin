import { IsArray } from 'class-validator';

/**
 * Datos para ENVIAR la entrega de una actividad
 * (POST /activities/:id/submissions): el cierre del borrador o, si no
 * existe, la entrega directa en una sola sesión.
 *
 * La actividad sale del parámetro de ruta `:id` y la inscripción JAMÁS
 * viaja en el cuerpo: el backend la deriva del token (AGENTS.md §9.7).
 * El estado tampoco se acepta: el envío pasa la entrega a 'submitted'
 * y, si la auto-calificación alcanza el umbral, a 'graded' — jamás lo
 * decide el cliente.
 *
 * `respuestas` sigue la estructura del JSONB answers
 * (docs/plataforma_educativa_bd.md §6): la validación profunda contra
 * las preguntas REALES de la actividad la hace zod en el Service
 * (dto/respuestas.schema.ts), que además EXIGE COMPLETITUD — al enviar
 * no puede faltar ninguna respuesta (excepto preguntas file, que hoy
 * no se pueden responder). Por eso este DTO no fija un mínimo: el
 * mínimo real es "todas las respuestas de la actividad".
 */
export class CrearEntregaDto {
  /**
   * Respuestas finales de la entrega (submissions.answers, JSONB):
   * una por cada pregunta de la actividad, referenciadas por su
   * question_position. is_correct/score no se aceptan nunca; en
   * preguntas file, `files` referencia archivos YA SUBIDOS con el
   * endpoint de subida (solo la metadata que devolvió el servidor).
   */
  @IsArray()
  respuestas!: unknown[];
}
