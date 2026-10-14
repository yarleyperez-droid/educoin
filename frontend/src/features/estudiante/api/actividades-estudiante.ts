/**
 * Fachada de actividades para el estudiante (T5.8.1, PRO-394).
 *
 * ## Responsabilidad: sanitizar antes de pintar
 *
 * Lee el catálogo del mock del **profesor**
 * (`features/teacher/api/actividades-mock.ts`), filtra las **publicadas**
 * y **proyecta campo a campo** cada pregunta a la forma segura de
 * `contrato/cuestionario.ts` (sin `is_correct`, sin `expected_answer`).
 *
 * **Andamio documentado:** compartir el catálogo permite la demo "el
 * profesor publica → el estudiante resuelve" en una misma sesión y hace
 * visible la sanitización. Con API real (T5.8.4) esta fachada pasará a
 * `api.get(...)` de **H3.3**, quien será el responsable del filtro por rol
 * y de no filtrar secretos (AGENTS.md §6: la lógica crítica vive en el
 * backend).
 *
 * Regla de implementación: la proyección **nunca hace spread del objeto
 * original** ni `delete` — construye uno nuevo con las claves permitidas,
 * de modo que un secreto no puede colarse por accidente.
 */

import type { Pregunta } from "@/features/teacher/contrato/actividades";
import {
  listarActividadesMock,
  obtenerActividadMock,
} from "@/features/teacher/api/actividades-mock";
import type { Actividad } from "@/features/teacher/tipos";

import type {
  ActividadEstudiante,
  PreguntaEstudiante,
} from "../contrato/cuestionario";

/**
 * Proyecta una pregunta con secretos a su forma segura para el estudiante.
 *
 * Solo copia las claves permitidas (`position`, `type`, `prompt`, `score` y
 * `options` reducida a `{ text }`); `is_correct` y `expected_answer` **no
 * se leen siquiera**.
 *
 * @param pregunta Pregunta del contrato del profesor (con secretos).
 * @returns La misma pregunta sin secretos.
 */
export function proyectarPregunta(pregunta: Pregunta): PreguntaEstudiante {
  const opciones =
    pregunta.options === undefined
      ? undefined
      : pregunta.options.map((opcion) => ({ text: opcion.text }));

  return {
    position: pregunta.position,
    type: pregunta.type,
    prompt: pregunta.prompt,
    score: pregunta.score,
    ...(opciones === undefined ? {} : { options: opciones }),
  };
}

/**
 * Proyecta una actividad completa a la forma del estudiante.
 *
 * @param actividad Actividad del mock del profesor.
 * @returns Actividad con sus preguntas ya sanitizadas.
 */
export function proyectarActividad(actividad: Actividad): ActividadEstudiante {
  return {
    id: actividad.id,
    claseId: actividad.claseId,
    titulo: actividad.titulo,
    descripcion: actividad.descripcion,
    recompensaMonedas: actividad.recompensaMonedas,
    preguntas: actividad.preguntas.map(proyectarPregunta),
    publicadaEn: actividad.publicadaEn,
  };
}

/**
 * Lista las actividades **publicadas** para el estudiante.
 *
 * Solo `estado === "published"`: `draft` y `deleted` jamás llegan a la
 * vista (spec §Contrato 4).
 *
 * **Andamio (mock del profesor):** T5.8.4 la reemplazará por el endpoint
 * de H3.3 sin tocar esta firma.
 *
 * @returns Actividades publicadas con sus preguntas sanitizadas.
 */
export async function listarPublicadas(): Promise<ActividadEstudiante[]> {
  const publicadas = listarActividadesMock().filter(
    (actividad) => actividad.estado === "published",
  );

  return publicadas.map(proyectarActividad);
}

/**
 * Obtiene una actividad publicada por id, ya sanitizada.
 *
 * Devuelve `null` si no existe o si **no está publicada** (un borrador no
 * es accesible por URL: spec §Gherkin "no publicadas no son visibles").
 *
 * **Andamio (mock del profesor):** T5.8.4 la reemplazará por el endpoint
 * de H3.3.
 *
 * @param id Identificador de la actividad.
 * @returns La actividad segura, o `null` si no corresponde al estudiante.
 */
export async function obtenerParaEstudiante(
  id: string,
): Promise<ActividadEstudiante | null> {
  const actividad = obtenerActividadMock(id);

  if (!actividad || actividad.estado !== "published") {
    return null;
  }

  return proyectarActividad(actividad);
}
