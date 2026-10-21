import { ApiProperty } from '@nestjs/swagger';
import { submission_status } from '../../../generated/prisma/client';
import type { RespuestaCalificada } from '../auto-calificacion';
import type { RespuestaEntrega } from './respuestas.schema';
import {
  RespuestaCalificadaDocDto,
  RespuestaDocDto,
} from './respuestas-doc.dto';

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

  /** Literal del enum real: el borrador siempre está 'in_progress'. */
  @ApiProperty({
    enum: ['in_progress'],
    description: "Siempre 'in_progress': el borrador aún no se envía.",
    example: 'in_progress',
  })
  estado!: 'in_progress';

  /** null mientras es borrador: la entrega se registra al enviarla. */
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      'null mientras es borrador: la fecha de envío se registra al ENVIAR (POST).',
  })
  entregadoEn!: null;

  /** null mientras es borrador: todavía no hay calificación. */
  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'null mientras es borrador: todavía no hay calificación.',
  })
  puntaje!: null;

  /** 0 mientras es borrador: las monedas llegan solo al calificarse. */
  monedasOtorgadas!: number;

  /**
   * answers JSONB saneado tal como quedó guardado, SIN veredicto.
   * Tipo zod-inferido que el plugin no puede reflejar: esquema doc.
   */
  @ApiProperty({
    type: [RespuestaDocDto],
    description:
      'answers JSONB tal como quedó guardado, SIN veredicto (nunca lleva is_correct/score).',
  })
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

  /** El plugin CLI no infiere los enums-objeto de Prisma: explícito. */
  @ApiProperty({
    enum: submission_status,
    description: 'Estado de la entrega: submitted, graded o rejected.',
  })
  estado!: submission_status;

  /** Momento del envío (submissions.submitted_at, ISO 8601). */
  entregadoEn!: string;

  /** Puntaje total al calificarse; null mientras espera al profesor. */
  puntaje!: number | null;

  /** Monedas otorgadas por fn_award_coins al pasar a 'graded' (0 antes). */
  monedasOtorgadas!: number;

  /**
   * Retroalimentación del profesor (submissions.feedback): null hasta
   * que la califique; con él ve el motivo de un 'rejected' o los
   * comentarios de un 'graded'.
   */
  feedback!: string | null;

  /**
   * answers JSONB: lo enviado + veredicto (is_correct/score por respuesta).
   * Tipo zod-inferido que el plugin no puede reflejar: esquema doc.
   */
  @ApiProperty({
    type: [RespuestaCalificadaDocDto],
    description:
      'answers JSONB: lo que el estudiante envió MÁS el veredicto por respuesta (is_correct/score).',
  })
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

/**
 * El ESTUDIANTE dueño de la entrega, tal como lo ve el profesor en la
 * cola de calificación: para calificar hace falta saber QUIÉN entregó
 * (join enrollments → users). Sale solo en la fila del listado del
 * profesor; al estudiante nunca se le exponen entregas ajenas.
 */
export class EstudianteColaDto {
  id!: string;
  usuario!: string;
  nombre!: string;
  apellido!: string;
}

/**
 * Fila de la COLA DE CALIFICACIÓN del profesor
 * (GET /api/v1/activities/:id/submissions/queue): resumen de UNA
 * entrega de la actividad, SIN `answers` — el listado es un resumen
 * (mismo criterio que el de actividades: el JSONB completo puede ser
 * grande) y el detalle de cada entrega llegará con el endpoint de
 * calificación (docs/flujo_entregas.md §10).
 *
 * `entregadoEn` es null en los borradores (in_progress aún no se envía)
 * y `puntaje` viaja null mientras la entrega espera al profesor.
 */
export class EntregaColaDto {
  id!: string;
  estudiante!: EstudianteColaDto;

  /** El plugin CLI no infiere los enums-objeto de Prisma: explícito. */
  @ApiProperty({
    enum: submission_status,
    description:
      'Estado de la entrega: in_progress, submitted, graded o rejected.',
  })
  estado!: submission_status;

  /** Momento del envío (submissions.submitted_at, ISO 8601); null en borrador. */
  entregadoEn!: string | null;

  /** Puntaje total al calificarse; null mientras espera al profesor. */
  puntaje!: number | null;

  /** Monedas otorgadas por fn_award_coins al pasar a 'graded' (0 antes). */
  monedasOtorgadas!: number;
}

/** Meta de la paginación estándar de listados (AGENTS.md §8). */
export class ListadoEntregasMetaDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoEntregasDto {
  data!: EntregaColaDto[];
  meta!: ListadoEntregasMetaDto;
}

/**
 * VISTA DE REVISIÓN del profesor
 * (GET /api/v1/activities/:id/submissions/:entregaId): la fila de la
 * cola MÁS lo que hace falta para calificar — las respuestas del
 * estudiante con su veredicto (answers JSONB con is_correct/score por
 * respuesta) y la retroalimentación si ya fue calificada. Es la única
 * vista que expone answers a alguien distinto del estudiante dueño
 * (AGENTS.md §9.5): el dueño de la actividad es quien califica.
 *
 * `calificadoEn` es graded_at — lo setea fn_award_coins SOLO en la
 * transición a 'graded': en 'rejected' queda null (la BD no lo marca).
 * Las preguntas de la actividad no viajan aquí: el profesor ya las
 * tiene completas (con las correctas) en GET /activities/:id.
 */
export class EntregaDetalleProfesorDto {
  id!: string;
  estudiante!: EstudianteColaDto;

  /** El plugin CLI no infiere los enums-objeto de Prisma: explícito. */
  @ApiProperty({
    enum: submission_status,
    description:
      'Estado de la entrega: in_progress, submitted, graded o rejected.',
  })
  estado!: submission_status;

  entregadoEn!: string | null;

  /** Momento de la calificación (graded_at, ISO 8601); null sin calificar. */
  calificadoEn!: string | null;

  puntaje!: number | null;
  monedasOtorgadas!: number;

  /** Retroalimentación escrita al calificar; null si no hay. */
  feedback!: string | null;

  /**
   * answers JSONB: lo enviado + veredicto por respuesta (is_correct/score).
   * Tipo zod-inferido que el plugin no puede reflejar: esquema doc.
   */
  @ApiProperty({
    type: [RespuestaCalificadaDocDto],
    description:
      'answers JSONB: lo que el estudiante envió MÁS el veredicto por respuesta (is_correct/score).',
  })
  respuestas!: RespuestaCalificada[];
}

/**
 * Respuesta de POST /api/v1/activities/:id/submissions/:entregaId/calificar:
 * confirma la transición (graded/rejected) y devuelve la entrega tal
 * como queda — con lo que el trigger escribió (monedas, graded_at).
 */
export class CalificacionRespuestaDto {
  mensaje!: string;
  entrega!: EntregaDetalleProfesorDto;
}
