/**
 * Fachada de actividades para el estudiante (T5.8.1 → T5.8.4, PRO-397).
 *
 * Punto único entre la vista del cuestionario y el transporte. Habla con
 * la API real de H3.3 (`src/modules/activities/`):
 *
 * - `GET /api/v1/activities/:id` → detalle en plano
 *   (`ActividadEstudianteRespuestaDto`, preguntas sanitizadas).
 * - `GET /api/v1/enrollments/:inscripcionId/activities` → listado publicado
 *   de una de sus clases (respuesta `{ data, meta }`).
 *
 * La responsabilidad de no filtrar secretos es del backend; los mappers de
 * esta fachada traducen vocabulario y construyen objetos nuevos con las
 * claves permitidas, sin hacer spread del original (defensa en profundidad).
 */

import { ApiError, api, apiPlano } from '@/lib/api-client';
import type { ApiMeta } from '@/lib/api-client';

import type {
  ActividadEstudiante,
  ActividadResumen,
  PreguntaEstudiante,
} from '../contrato/cuestionario';

/**
 * `PreguntaSinRespuestas` de H3.3 tal cual sale del backend (ya
 * sanitizada). Existe como tipo aparte para que el mapper
 * {@link aPreguntaEstudiante} sea el único punto de traducción y un
 * cambio del Swagger se absorba aquí.
 */
interface PreguntaEstudianteBackend {
  position: number;
  type: 'test' | 'completion' | 'file' | 'minigame';
  prompt: string;
  score: number;
  /** Solo los tipos que la usan la traen; nunca con `is_correct`. */
  options?: { text: string }[];
}

/**
 * `ActividadEstudianteRespuestaDto` de H3.3 tal cual sale del backend.
 * Trae además `estado`, `cierraEn` y `creadoEn`, que el contrato del
 * estudiante no necesita (solo llegan actividades `published`).
 */
interface ActividadEstudianteBackend {
  id: string;
  claseId: string;
  titulo: string;
  descripcion: string | null;
  recompensaMonedas: number;
  preguntas: PreguntaEstudianteBackend[];
  publicadaEn: string | null;
}

/**
 * Ítem de `ListadoActividadesDto` (`ActividadListadoDto`). No incluye
 * preguntas: para resolverlas se va al detalle.
 */
interface ActividadListadoBackend {
  id: string;
  titulo: string;
  estado: string;
  recompensaMonedas: number;
  publicadaEn: string | null;
  cierraEn: string | null;
  creadoEn: string;
}

/**
 * Traduce una pregunta del DTO del estudiante a la forma del contrato.
 *
 * Copia **solo** las claves permitidas (`position`, `type`, `prompt`,
 * `score` y `options` reducida a `{ text }`): nunca hace spread del
 * objeto original, así que aunque el backend llegara a filtrar un secreto
 * no pasaría a la vista.
 *
 * @param backend Pregunta del DTO de H3.3 (ya sanitizada por rol).
 * @returns La pregunta en la forma segura del contrato.
 */
function aPreguntaEstudiante(
  backend: PreguntaEstudianteBackend,
): PreguntaEstudiante {
  const opciones =
    backend.options === undefined
      ? undefined
      : backend.options.map((opcion) => ({ text: opcion.text }));

  return {
    position: backend.position,
    type: backend.type,
    prompt: backend.prompt,
    score: backend.score,
    ...(opciones === undefined ? {} : { options: opciones }),
  };
}

/**
 * Traduce `ActividadEstudianteRespuestaDto` al tipo de dominio
 * {@link ActividadEstudiante}.
 *
 * @param backend DTO plano de H3.3 (los IDs se normalizan a `string`).
 * @returns La actividad con el vocabulario del frontend y preguntas seguras.
 */
function aActividadEstudiante(
  backend: ActividadEstudianteBackend,
): ActividadEstudiante {
  return {
    id: String(backend.id),
    claseId: String(backend.claseId),
    titulo: backend.titulo,
    descripcion: backend.descripcion,
    recompensaMonedas: backend.recompensaMonedas,
    preguntas: backend.preguntas.map(aPreguntaEstudiante),
    publicadaEn: backend.publicadaEn,
  };
}

/**
 * Traduce `ActividadListadoDto` al resumen del dominio.
 *
 * @param backend Ítem del listado publicado del estudiante.
 * @returns Resumen seguro para pintar en la lista.
 */
function aActividadResumen(backend: ActividadListadoBackend): ActividadResumen {
  return {
    id: String(backend.id),
    titulo: backend.titulo,
    recompensaMonedas: backend.recompensaMonedas,
    publicadaEn: backend.publicadaEn,
    cierraEn: backend.cierraEn,
    creadoEn: backend.creadoEn,
  };
}

/**
 * Lista las actividades **publicadas** de una inscripción del estudiante.
 *
 * @param inscripcionId Id de la inscripción (`enrollments.id`), obtenido
 *   vía {@link listarInscripciones}.
 * @param page Página 1-indexada (default 1).
 * @param limit Filas por página (default 50).
 * @returns Actividades publicadas de esa clase con paginación.
 */
export async function listarPublicadas(
  inscripcionId: string,
  page = 1,
  limit = 50,
): Promise<{ data: ActividadResumen[]; meta: ApiMeta }> {
  const respuesta = await api.get<ActividadListadoBackend[]>(
    `enrollments/${encodeURIComponent(inscripcionId)}/activities?page=${page}&limit=${limit}`,
  );

  return {
    data: respuesta.data.map(aActividadResumen),
    meta: respuesta.meta ?? {
      total: respuesta.data.length,
      page,
      limit,
    },
  };
}

/**
 * Obtiene una actividad publicada por id, ya sanitizada
 * (`GET /activities/:id` de H3.3).
 *
 * Devuelve `null` si no existe, **no está publicada** o el estudiante no
 * está inscrito en su clase: los tres casos los resuelve el backend con
 * el mismo `404` anti-enumeración (spec §Gherkin "no publicadas no son
 * visibles"), que aquí se traduce al estado "no encontrada" de la vista.
 *
 * @param id Identificador de la actividad.
 * @returns La actividad segura, o `null` si no corresponde al estudiante.
 */
export async function obtenerParaEstudiante(
  id: string,
): Promise<ActividadEstudiante | null> {
  try {
    return aActividadEstudiante(
      await apiPlano.get<ActividadEstudianteBackend>(`activities/${id}`),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}
