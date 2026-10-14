/**
 * Fachada de entregas del estudiante (T5.8.2, PRO-395).
 *
 * Punto único entre la vista del cuestionario y el transporte. **Hoy el
 * interior es un mock** porque H3.4 (PRO-276) está en Backlog; T5.8.4
 * sustituirá solo el cuerpo de estas funciones por `api.post/api.get` sin
 * cambiar las firmas (mismo criterio que T5.4.3/T5.6.x).
 *
 * ## Flujo de `enviarRespuestas` (doble capa de protección)
 *
 * 1. **404** si la actividad no existe o no está publicada.
 * 2. **422** si el JSONB no cumple el contrato zod o no es coherente con
 *    las preguntas (todas respondidas, posiciones existentes, `option`
 *    dentro de las opciones reales).
 * 3. **409** si ya existe una entrega (réplica del
 *    `UNIQUE (activity_id, enrollment_id)` de la BD — la garantía real la
 *    pone la BD; aquí y en la UI son defensa en profundidad).
 * 4. Crea la entrega en `submitted`.
 *
 * La vista solo lee `error.message` de `ApiError`.
 */

import { ApiError } from "@/lib/api-client";

import { mensajeDeErroresZod } from "@/features/teacher/contrato/actividades";

import type { ActividadEstudiante } from "../contrato/cuestionario";
import {
  RespuestasSchema,
  type Entrega,
  type Respuesta,
} from "../contrato/entregas";

import { obtenerParaEstudiante } from "./actividades-estudiante";
import {
  calificarMock,
  crearEntregaMock,
  lanzarDuplicada,
  obtenerEntregaMock,
} from "./entregas-mock";

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
 * Envía las respuestas de una actividad y crea la entrega (`submitted`).
 *
 * **MOCK temporal (H3.4 pendiente):** ver cabecera del archivo.
 *
 * @param actividadId Actividad a responder.
 * @param respuestas Respuestas del estudiante (`answers` sin secretos).
 * @returns La entrega creada en estado `submitted`.
 * @throws {ApiError} 404 actividad no disponible; 422 JSONB o coherencia
 *   inválida; **409 si ya existe una entrega** (UNIQUE de la BD).
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

  // Réplica del UNIQUE (activity_id, enrollment_id): el segundo intento
  // es un conflicto, igual que el que devolvería la BD a H3.4.
  if (obtenerEntregaMock(actividadId)) {
    lanzarDuplicada();
  }

  return crearEntregaMock(actividadId, parseadas.data);
}

/**
 * Obtiene la entrega del estudiante para una actividad (o `null`).
 *
 * La vista la consulta al montar para arrancar **ya bloqueada** si el
 * envío ocurrió antes (recarga o segunda visita).
 *
 * **MOCK temporal (H3.4 pendiente):** ver cabecera del archivo.
 *
 * @param actividadId Actividad consultada.
 * @returns La entrega, o `null` si aún no se envió.
 */
export async function obtenerEntrega(
  actividadId: string,
): Promise<Entrega | null> {
  await Promise.resolve();

  return obtenerEntregaMock(actividadId);
}

/**
 * Consulta/actualiza el estado de la entrega con la auto-calificación.
 *
 * Simula el job asíncrono de **H3.4** (T5.8.3):
 * - Sin entrega → `ApiError` 404.
 * - `submitted` → dispara la auto-calificación del mock (latencia de
 *   servidor) y devuelve la entrega `graded` con `resultado`, `puntaje`,
 *   `monedasOtorgadas` y `retroalimentacion`.
 * - `graded` / `rejected` / `in_progress` → **idempotente**: devuelve la
 *   entrega tal cual, sin recalcular ni tocar fechas.
 *
 * **MOCK temporal (H3.4 pendiente):** con API real, T5.8.4 la sustituirá
 * por `api.get(...)` — el servidor será quien califique.
 *
 * @param actividadId Actividad de la entrega.
 * @returns La entrega en su estado actual (posiblemente ya `graded`).
 * @throws {ApiError} 404 si no hay entrega.
 */
export async function consultarAutoCalificacion(
  actividadId: string,
): Promise<Entrega> {
  const entrega = obtenerEntregaMock(actividadId);

  if (!entrega) {
    throw new ApiError(MENSAJE_ENTREGA_INEXISTENTE, 404);
  }

  if (entrega.estado === "submitted") {
    return calificarMock(actividadId);
  }

  // Idempotencia: nada que recalcular fuera del estado "submitted".
  await Promise.resolve();

  return entrega;
}
