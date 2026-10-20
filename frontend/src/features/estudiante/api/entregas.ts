/**
 * Fachada de entregas del estudiante (T5.8.2 → T5.8.4, PRO-397).
 *
 * Punto único entre la vista del cuestionario y el transporte. Desde
 * T5.8.4 habla con la **API real de H3.4** (`src/modules/submissions/`)
 * mediante `apiPlano` de `@/lib/api-client`; los mocks de T5.8.2 ya no
 * existen. Las firmas se conservan, salvo que {@link consultarAutoCalificacion}
 * cambió de semántica (justificado en su docstring).
 *
 * ## Contrato con H3.4 (verificado en `test/submissions.e2e-spec.ts`)
 *
 * Los tres endpoints son **unitarios**: devuelven su DTO **en plano**
 * (sin la envoltura `{ data, meta }` de los listados); por eso van por
 * `apiPlano`. Todos exigen `@Roles('student')` y
 * `@PerteneceA('actividadVisible','id')` (actividad `published` +
 * inscripción ACTIVA); la inscripción la deriva el backend del token.
 *
 * - `GET /api/v1/activities/:id/submissions` → `EntregaBorradorRespuestaDto`
 *   (borrador, sin veredictos) o `EntregaRespuestaDto` (enviada, con el
 *   veredicto de lo que el estudiante envió). **404** si todavía no hay
 *   ninguna entrega — el mismo 404 anti-enumeración de la actividad no
 *   visible.
 * - `PUT /api/v1/activities/:id/submissions` (body `GuardarBorradorDto
 *   { respuestas }`) → `{ mensaje, entrega }` con el borrador
 *   (`in_progress`); admite respuestas parciales o vacías. **409** si la
 *   entrega ya fue enviada (jamás se baja a borrador).
 * - `POST /api/v1/activities/:id/submissions` (body `CrearEntregaDto
 *   { respuestas }`) → `{ mensaje, entrega }` con la entrega enviada y la
 *   **auto-calificación inmediata**: `graded` (y monedas acreditadas por
 *   el trigger) si alcanza el umbral del 80%, `submitted` pendiente del
 *   profesor en caso contrario. **409** en doble envío
 *   (`UNIQUE (activity_id, enrollment_id)`); **400** si el JSONB no cumple
 *   el contrato o falta alguna respuesta.
 *
 * ## Flujo de `enviarRespuestas` (doble capa de protección)
 *
 * 1. **404** si la actividad no existe o no está publicada (traducido a
 *    `null` por `obtenerParaEstudiante`).
 * 2. **422** si el JSONB no cumple el contrato zod o no es coherente con
 *    las preguntas (todas respondidas, posiciones existentes, `option`
 *    dentro de las opciones reales) — primera red en cliente, antes de
 *    tocar el transporte de escritura.
 * 3. El backend re-valida contra las preguntas reales (400) y aplica la
 *    garantía `uq_submission` (409). El cliente **no** pre-comprueba
 *    duplicados: el mensaje real del servidor llega tal cual por
 *    `ApiError`.
 *
 * La vista solo lee `error.message` de `ApiError`.
 */

import { ApiError, apiPlano } from "@/lib/api-client";

import { mensajeDeErroresZod } from "@/features/teacher/contrato/actividades";

import type { ActividadEstudiante } from "../contrato/cuestionario";
import {
  RespuestasParcialesSchema,
  RespuestasSchema,
  type Entrega,
  type Respuesta,
  type ResultadoPregunta,
} from "../contrato/entregas";

import { obtenerParaEstudiante } from "./actividades-estudiante";

export type { Entrega, Respuesta };

/** Mensaje cuando la actividad no existe o no está publicada. */
const MENSAJE_ACTIVIDAD_NO_DISPONIBLE =
  "No se encontró la actividad o todavía no está publicada.";

/** Mensaje cuando no hay entrega que consultar. */
const MENSAJE_ENTREGA_INEXISTENTE =
  "No se encontró ninguna entrega para esta actividad.";

/** Mensaje cuando falta una respuesta por pregunta. */
const MENSAJE_RESPUESTA_FALTANTE =
  "Falta la respuesta de la pregunta ";

/** Mensaje cuando la respuesta no corresponde a una pregunta de la actividad. */
const MENSAJE_POSICION_DESCONOCIDA =
  "Una de las respuestas no corresponde a ninguna pregunta de esta actividad.";

/** Mensaje cuando la opción elegida no existe en la pregunta. */
const MENSAJE_OPCION_INVALIDA =
  "Elegiste una opción que no pertenece a la pregunta ";

/**
 * Respuesta individual tal como la envía el estudiante (subconjunto de
 * `RespuestaCalificada` de H3.4 sin el veredicto: `is_correct`/`score`
 * solo existen tras calificar y el cliente jamás los envía).
 */
interface RespuestaEntregaBackend {
  question_position: number;
  text?: string;
  option?: string;
}

/**
 * `RespuestaCalificada` de H3.4: lo enviado más el veredicto del backend
 * (`is_correct`/`score` en `null` = pregunta pendiente de calificación
 * manual).
 */
interface RespuestaCalificadaBackend extends RespuestaEntregaBackend {
  is_correct: boolean | null;
  score: number | null;
}

/**
 * `EntregaBorradorRespuestaDto` de H3.4 (estado `in_progress`): sale de
 * GET/PUT con `respuestas` **sin** veredictos.
 */
interface EntregaBorradorBackend {
  id: string;
  actividadId: string;
  estado: "in_progress";
  entregadoEn: null;
  puntaje: null;
  monedasOtorgadas: number;
  respuestas: RespuestaEntregaBackend[];
}

/**
 * `EntregaRespuestaDto` de H3.4 (enviada: `submitted`/`graded`/`rejected`):
 * sale de GET/POST con `respuestas` **con** veredicto.
 */
interface EntregaEnviadaBackend {
  id: string;
  actividadId: string;
  estado: Exclude<Entrega["estado"], "in_progress">;
  entregadoEn: string;
  puntaje: number | null;
  monedasOtorgadas: number;
  /** Retroalimentación del profesor (`submissions.feedback`); null sin calificar. */
  feedback?: string | null;
  respuestas: RespuestaCalificadaBackend[];
}

/** Unión que devuelve `GET /activities/:id/submissions`. */
type EntregaBackend = EntregaBorradorBackend | EntregaEnviadaBackend;

/** `BorradorGuardadoRespuestaDto` de H3.4: `{ mensaje, entrega }` en plano. */
interface BorradorGuardadoBackend {
  mensaje: string;
  entrega: EntregaBorradorBackend;
}

/** `EntregaCreadaRespuestaDto` de H3.4: `{ mensaje, entrega }` en plano. */
interface EntregaCreadaBackend {
  mensaje: string;
  entrega: EntregaEnviadaBackend;
}

/**
 * Sanea una respuesta de la entrega a lo que el estudiante envió.
 *
 * Copia **solo** `question_position` y `text`/`option`: `is_correct` y
 * `score` del veredicto del backend no pasan a `Entrega.respuestas` (el
 * veredicto viaja aparte, en {@link aResultado}).
 *
 * @param backend Respuesta del JSONB `answers` (con o sin veredicto).
 * @returns La respuesta en la forma del contrato.
 */
function aRespuesta(backend: RespuestaEntregaBackend): Respuesta {
  return {
    question_position: backend.question_position,
    ...(backend.text === undefined ? {} : { text: backend.text }),
    ...(backend.option === undefined ? {} : { option: backend.option }),
  };
}

/**
 * Traduce los veredictos del backend a `resultado` por pregunta.
 *
 * Las respuestas pendientes de calificación manual (`is_correct: null`,
 * minigame) se **omiten**: sin veredicto no hay acierto que mostrar y
 * falsearlos (`correcta: false`) mentiría en el marcador.
 *
 * @param respuestas Respuestas calificadas del JSONB `answers`.
 * @returns Resultado por pregunta, en el orden del backend.
 */
function aResultado(
  respuestas: RespuestaCalificadaBackend[],
): ResultadoPregunta[] {
  const resultados: ResultadoPregunta[] = [];

  for (const respuesta of respuestas) {
    if (respuesta.is_correct !== null && respuesta.score !== null) {
      resultados.push({
        question_position: respuesta.question_position,
        correcta: respuesta.is_correct,
        puntos: respuesta.score,
      });
    }
  }

  return resultados;
}

/**
 * Traduce un DTO de H3.4 al tipo de dominio {@link Entrega}.
 *
 * Mapeo (ver cabecera de `contrato/entregas.ts`): `entregadoEn` →
 * `enviadaEn`; `resultado` se deriva de los veredictos de las respuestas
 * calificadas; `feedback` → `retroalimentacion` (H3.5 lo expone desde el
 * primer día en `EntregaRespuestaDto`; T5.9.3 corrigió el mapeo que lo
 * dejaba siempre `null`); `estudianteId`/`iniciadaEn`/`calificadaEn` ya no
 * existen en el tipo porque el backend no los expone.
 *
 * @param backend Borrador o entrega enviada de H3.4.
 * @returns La entrega con el vocabulario del frontend.
 */
function aEntrega(backend: EntregaBackend): Entrega {
  if (backend.entregadoEn === null) {
    return {
      id: String(backend.id),
      actividadId: String(backend.actividadId),
      estado: backend.estado,
      respuestas: backend.respuestas.map(aRespuesta),
      enviadaEn: null,
      puntaje: null,
      monedasOtorgadas: backend.monedasOtorgadas,
      retroalimentacion: null,
      resultado: null,
    };
  }

  return {
    id: String(backend.id),
    actividadId: String(backend.actividadId),
    estado: backend.estado,
    respuestas: backend.respuestas.map(aRespuesta),
    enviadaEn: backend.entregadoEn,
    puntaje: backend.puntaje,
    monedasOtorgadas: backend.monedasOtorgadas,
    retroalimentacion: backend.feedback ?? null,
    resultado: aResultado(backend.respuestas),
  };
}

/**
 * Verifica que las respuestas cubran exactamente las preguntas de la
 * actividad (coherencia con el JSONB `questions`).
 *
 * @param actividad Actividad publicada (forma segura del estudiante).
 * @param respuestas Respuestas ya validadas por el contrato zod.
 * @throws {ApiError} 422 si falta, sobra o no corresponde alguna respuesta.
 */
function validarCoherencia(
  actividad: ActividadEstudiante,
  respuestas: Respuesta[],
): void {
  const posicionesRespondidas = new Set(
    respuestas.map((respuesta) => respuesta.question_position),
  );

  // Toda pregunta de la actividad debe tener respuesta.
  for (const pregunta of actividad.preguntas) {
    if (!posicionesRespondidas.has(pregunta.position)) {
      throw new ApiError(
        `${MENSAJE_RESPUESTA_FALTANTE}${pregunta.position}.`,
        422,
      );
    }
  }

  for (const respuesta of respuestas) {
    const pregunta = actividad.preguntas.find(
      (item) => item.position === respuesta.question_position,
    );

    if (!pregunta) {
      throw new ApiError(MENSAJE_POSICION_DESCONOCIDA, 422);
    }

    if (
      pregunta.type === "test" &&
      respuesta.option !== undefined &&
      !(pregunta.options ?? []).some(
        (opcion) => opcion.text === respuesta.option,
      )
    ) {
      throw new ApiError(`${MENSAJE_OPCION_INVALIDA}${pregunta.position}.`, 422);
    }
  }
}

/**
 * Envía las respuestas de una actividad y crea la entrega
 * (`POST /activities/:id/submissions`).
 *
 * La validación zod y de coherencia corre **antes** del transporte
 * (primera red en cliente); el backend vuelve a validar contra las
 * preguntas reales y decide el estado final. La auto-calificación es
 * **inmediata**: la entrega que devuelve esta función ya puede estar
 * `graded` (umbral alcanzado, monedas acreditadas) o `submitted`
 * (pendiente del profesor).
 *
 * @param actividadId Actividad a responder.
 * @param respuestas Respuestas del estudiante (`answers` sin secretos).
 * @returns La entrega creada (`submitted` o `graded` según el umbral).
 * @throws {ApiError} 404 actividad no disponible; 422 JSONB o coherencia
 *   inválida; 400/409 del backend (respuestas inválidas o envío duplicado,
 *   `uq_submission`) con su mensaje en español.
 */
export async function enviarRespuestas(
  actividadId: string,
  respuestas: Respuesta[],
): Promise<Entrega> {
  const actividad = await obtenerParaEstudiante(actividadId);

  if (!actividad) {
    throw new ApiError(MENSAJE_ACTIVIDAD_NO_DISPONIBLE, 404);
  }

  const parseadas = RespuestasSchema.safeParse(respuestas);

  if (!parseadas.success) {
    throw new ApiError(mensajeDeErroresZod(parseadas.error.issues), 422);
  }

  validarCoherencia(actividad, parseadas.data);

  const creada = await apiPlano.post<EntregaCreadaBackend>(
    `activities/${actividadId}/submissions`,
    { respuestas: parseadas.data },
  );

  return aEntrega(creada.entrega);
}

/**
 * Guarda el borrador de la entrega (`PUT /activities/:id/submissions`),
 * el autosave del estudiante.
 *
 * A diferencia del envío, admite respuestas **parciales e incluso
 * vacías** (el estudiante recién abre la actividad) y nunca exige
 * coherencia completa: eso solo se exige al enviar. El backend re-valida
 * cada respuesta contra las preguntas reales (400) y responde 409 si la
 * entrega ya fue enviada (no se baja de `submitted` a borrador).
 *
 * **Sin vista que la invoque todavía** (el cuestionario de T5.8.x solo
 * envía); se integra porque es la tercera operación de H3.4 y esta
 * fachada es su único punto de contacto.
 *
 * @param actividadId Actividad cuyo borrador se guarda.
 * @param respuestas Respuestas parciales (puede ser `[]`).
 * @returns El borrador actualizado (`in_progress`).
 * @throws {ApiError} 422 si una respuesta individual no cumple el contrato;
 *   400/404/409 del backend con su mensaje en español.
 */
export async function guardarBorrador(
  actividadId: string,
  respuestas: Respuesta[],
): Promise<Entrega> {
  const parseadas = RespuestasParcialesSchema.safeParse(respuestas);

  if (!parseadas.success) {
    throw new ApiError(mensajeDeErroresZod(parseadas.error.issues), 422);
  }

  const guardada = await apiPlano.put<BorradorGuardadoBackend>(
    `activities/${actividadId}/submissions`,
    { respuestas: parseadas.data },
  );

  return aEntrega(guardada.entrega);
}

/**
 * Obtiene la entrega del estudiante para una actividad (o `null`)
 * (`GET /activities/:id/submissions`).
 *
 * La vista la consulta al montar para arrancar **ya bloqueada** si el
 * envío ocurrió antes (recarga o segunda visita). El borrador también
 * sale por aquí (para retomarlo), con `estado: "in_progress"` y
 * `respuestas` sin veredictos.
 *
 * El `404` se traduce a `null`: es el mismo que devuelve el backend sin
 * entrega **y** cuando la actividad no es visible para el estudiante
 * (anti-enumeración) — en ambos casos la vista lo trata como "sin
 * entrega" y la actividad, si no corresponde, ya la descartó
 * `obtenerParaEstudiante`.
 *
 * @param actividadId Actividad consultada.
 * @returns La entrega (borrador o enviada), o `null` si aún no existe.
 */
export async function obtenerEntrega(
  actividadId: string,
): Promise<Entrega | null> {
  try {
    return aEntrega(
      await apiPlano.get<EntregaBackend>(
        `activities/${actividadId}/submissions`,
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/**
 * Lee el estado actual de la entrega y su auto-calificación
 * (`GET /activities/:id/submissions`).
 *
 * **Cambio de semántica en T5.8.4:** con el mock simulaba un job
 * asíncrono (disparaba la calificación al consultar); con la API real la
 * auto-calificación ocurre **en el propio POST** (inmediata), así que
 * esta función es una **lectura idempotente** del estado actual — útil
 * para que la vista re-sinconice tras la espera o al recargar. No muta
 * nada ni recalcula: repetirla devuelve siempre la misma entrega.
 *
 * @param actividadId Actividad de la entrega.
 * @returns La entrega en su estado actual (`in_progress`, `submitted` o
 *   `graded` según cómo se resolvió).
 * @throws {ApiError} 404 si no hay entrega.
 */
export async function consultarAutoCalificacion(
  actividadId: string,
): Promise<Entrega> {
  try {
    return aEntrega(
      await apiPlano.get<EntregaBackend>(
        `activities/${actividadId}/submissions`,
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(MENSAJE_ENTREGA_INEXISTENTE, 404);
    }

    throw error;
  }
}
