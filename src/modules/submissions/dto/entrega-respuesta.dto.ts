import type { submission_status } from '../../../generated/prisma/client';
import type { RespuestaCalificada } from '../auto-calificacion';
import type { RespuestaEntrega } from './respuestas.schema';

/**
 * DTOs de respuesta del flujo de entregas, separados por ESTADO (mismo
 * patrón que los DTOs por rol del módulo activities, AGENTS.md §9.5):
 * el borrador (in_progress) y la entrega enviada tienen formas
 * distintas y conviene no mentir con campos nulos.
 *
 * Los IDs viajan como string porque BigInt no se serializa a JSON
 * (AGENTS.md §7).
 */

/**
 * El BORRADOR del estudiante ('in_progress' en el enum real). Sale por
 * GET y PUT /activities/:id/submissions.
 *
 * `respuestas` NUNCA lleva is_correct/score: mientras el estudiante
 * resuelve, la API no filtra nada de lo correcto (AGENTS.md §9.5) — la
 * evaluación ocurre solo al ENVIAR. Sin entregadoEn (submitted_at aún
 * no existe) ni puntaje/monedas (aún no se califica).
 */
export class EntregaBorradorRespuestaDto {
  id!: string;
  actividadId!: string;
  /** Siempre 'in_progress' en esta respuesta: el borrador aún no se envía. */
  estado!: 'in_progress';
  /** null mientras es borrador: la entrega se registra al enviarla. */
  entregadoEn!: null;
  /** null mientras es borrador: todavía no hay calificación. */
  puntaje!: null;
  /** 0 mientras es borrador: las monedas llegan solo al calificarse. */
  monedasOtorgadas!: number;
  /** answers JSONB saneado tal como quedó guardado, SIN veredicto. */
  respuestas!: RespuestaEntrega[];
}

/**
 * La entrega ENVIADA ('submitted'/'graded', o 'rejected' cuando exista
 * el flujo del profesor). Sale por GET y POST.
 *
 * Retroalimentación legítima post-entrega: la entrega es ÚNICA por
 * actividad (uq_submission), así que revelar el veredicto DESPUÉS de
 * enviar no permite reintentar hasta acertar. Aun así, la respuesta
 * nunca incluye expected_answer ni qué opción era la correcta: solo si
 * LO QUE EL ESTUDIANTE ENVIÓ estuvo bien o mal.
 */
export class EntregaRespuestaDto {
  id!: string;
  actividadId!: string;
  estado!: submission_status;
  /** Momento del envío (submissions.submitted_at, ISO 8601). */
  entregadoEn!: string;
  /** Puntaje total al calificarse; null mientras espera al profesor. */
  puntaje!: number | null;
  /** Monedas otorgadas por fn_award_coins al pasar a 'graded' (0 antes). */
  monedasOtorgadas!: number;
  /** answers JSONB: lo enviado + veredicto (is_correct/score por respuesta). */
  respuestas!: RespuestaCalificada[];
}

/**
 * Respuesta de PUT /api/v1/activities/:id/submissions: confirma el
 * autosave y recuerda que la entrega se registra al enviarla.
 */
export class BorradorGuardadoRespuestaDto {
  mensaje!: string;
  entrega!: EntregaBorradorRespuestaDto;
}

/**
 * Respuesta de POST /api/v1/activities/:id/submissions: confirma el
 * envío y su resultado inmediato — auto-calificada ('graded', con
 * monedas acreditadas por el trigger), bajo el umbral del 80% o
 * pendiente del profesor ('submitted', ambas sin monedas todavía).
 */
export class EntregaCreadaRespuestaDto {
  mensaje!: string;
  entrega!: EntregaRespuestaDto;
}
