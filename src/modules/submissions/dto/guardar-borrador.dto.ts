import { IsArray } from 'class-validator';

/**
 * Datos para guardar el BORRADOR de una entrega
 * (PUT /activities/:id/submissions) — el autosave del estudiante.
 *
 * La actividad sale del parámetro de ruta `:id` y la inscripción JAMÁS
 * viaja en el cuerpo: el backend la deriva del token (AGENTS.md §9.7).
 * El estado tampoco se acepta: el borrador es siempre 'in_progress'
 * (valor real del enum submission_status) y solo el envío (POST) puede
 * llevar la entrega a 'submitted'.
 *
 * `respuestas` PUEDE venir vacío: el estudiante abre la actividad sin
 * responder nada todavía y el frontend crea el borrador de una vez
 * (started_at queda registrado). La validación profunda contra las
 * preguntas reales la hace zod en el Service (dto/respuestas.schema.ts);
 * el borrador NUNCA lleva is_correct/score (AGENTS.md §9.5: mientras se
 * resuelve, nada de lo correcto se filtra).
 */
export class GuardarBorradorDto {
  /**
   * Respuestas parciales (submissions.answers, JSONB): lo que el
   * estudiante lleva respondido hasta ahora. is_correct/score no se
   * aceptan nunca (AGENTS.md §9.5: mientras se resuelve, nada de lo
   * correcto se filtra); en preguntas file, `files` referencia
   * archivos ya subidos (la metadata que devolvió el servidor).
   */
  @IsArray()
  respuestas!: unknown[];
}
