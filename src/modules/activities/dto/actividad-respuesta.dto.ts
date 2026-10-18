import type { activity_status } from '../../../generated/prisma/client';
import type { Pregunta, PreguntaSinRespuestas } from './preguntas.schema';

/**
 * Datos de la actividad que SALEN hacia el cliente (AGENTS.md §8: nunca
 * se devuelven entidades Prisma crudas). Los IDs viajan como string
 * porque BigInt no se serializa a JSON (AGENTS.md §7).
 *
 * `preguntas` incluye las respuestas correctas (options[].is_correct,
 * expected_answer): estos DTOs son del flujo del PROFESOR dueño de la
 * actividad. Cuando exista la vista del estudiante, deberá usar un DTO
 * propio sin esos campos (AGENTS.md §9.5).
 */
export class ActividadRespuestaDto {
  id!: string;
  claseId!: string;
  titulo!: string;
  descripcion!: string | null;
  recompensaMonedas!: number;
  estado!: activity_status;
  /** questions JSONB tal como quedó guardado (estructura de la seed). */
  preguntas!: Pregunta[];
  publicadaEn!: string | null;
  cierraEn!: string | null;
  creadoEn!: string;
  actualizadoEn!: string;
  eliminadaEn!: string | null;
}

/**
 * Datos de la actividad para el ESTUDIANTE (AGENTS.md §9.5: DTOs
 * distintos por rol). Igual al del profesor pero con `preguntas`
 * sanitizadas: sin `options[].is_correct` ni `expected_answer`. Tampoco
 * expone `eliminadaEn`: el estudiante solo llega aquí a través de la
 * regla 'actividadVisible', que ya garantiza que la actividad está
 * publicada y que su inscripción está activa.
 */
export class ActividadEstudianteRespuestaDto {
  id!: string;
  claseId!: string;
  titulo!: string;
  descripcion!: string | null;
  recompensaMonedas!: number;
  estado!: activity_status;
  /** questions JSONB SANITIZADO: nunca incluye respuestas correctas. */
  preguntas!: PreguntaSinRespuestas[];
  publicadaEn!: string | null;
  cierraEn!: string | null;
  creadoEn!: string;
}

/**
 * Respuesta de POST /api/v1/classes/:claseId/activities: confirma la
 * creación y recuerda el flujo draft → published (la actividad nace
 * como borrador; los estudiantes solo ven actividades publicadas).
 */
export class ActividadCreadaRespuestaDto {
  mensaje!: string;
  actividad!: ActividadRespuestaDto;
}

/**
 * Ítem del listado de actividades: SIN preguntas — el JSONB completo
 * puede ser grande y para la lista basta el resumen; el detalle está en
 * GET /activities/:id.
 */
export class ActividadListadoDto {
  id!: string;
  titulo!: string;
  estado!: activity_status;
  recompensaMonedas!: number;
  publicadaEn!: string | null;
  cierraEn!: string | null;
  creadoEn!: string;
}

/** Meta de la paginación estándar de listados (AGENTS.md §8). */
export class ListadoActividadesMetaDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoActividadesDto {
  data!: ActividadListadoDto[];
  meta!: ListadoActividadesMetaDto;
}
