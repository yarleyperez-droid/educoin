/**
 * Fachada de actividades para el estudiante (T5.8.1 → T5.8.4, PRO-397).
 *
 * Punto único entre la vista del cuestionario y el transporte. Desde
 * T5.8.4 habla con la **API real de H3.3** (`src/modules/activities/`)
 * mediante `apiPlano` de `@/lib/api-client`; el mock del profesor ya no
 * existe.
 *
 * ## Contrato con H3.3 (verificado en `test/activities.e2e-spec.ts`)
 *
 * - `GET /api/v1/activities/:id` (`@Roles('teacher','student')` +
 *   `@PerteneceA('actividadVisible','id')`) → `ActividadEstudianteRespuestaDto`
 *   **en plano**, con el JSONB `preguntas` ya sanitizado por rol: sin
 *   `options[].is_correct` ni `expected_answer` (AGENTS.md §9.5). La
 *   responsabilidad de no filtrar secretos es del backend; el mapper de
 *   esta fachada solo traduce vocabulario y —defensa en profundidad—
 *   construye objetos nuevos con las claves permitidas, sin hacer spread
 *   del original, de modo que un secreto no puede colarse por accidente.
 * - Si la actividad no existe, no está publicada o el estudiante no tiene
 *   inscripción activa en la clase, `@PerteneceA` responde **404**
 *   (anti-enumeración) antes de llegar al handler.
 *
 * ## Limitación del listado (T5.8.4)
 *
 * El único listado del estudiante es
 * `GET /api/v1/enrollments/:inscripcionId/activities` y exige un
 * `inscripcionId` que el frontend **no tiene a mano** (no hay endpoint
 * que lo devuelva ni viaja en la sesión; ver decisión en el ticket
 * PRO-397). Sin endpoints nuevos (fuera de alcance),
 * {@link listarPublicadas} devuelve `[]` y la vista muestra su estado
 * vacío; el detalle por URL ({@link obtenerParaEstudiante}) sí funciona.
 *
 * Los errores siempre salen como `ApiError` con `message` en español: la
 * vista solo muestra `error.message`. La única excepción es
 * {@link obtenerParaEstudiante}, que traduce el `404` a `null` para el
 * estado "no encontrada" de la vista.
 */

import { ApiError, apiPlano } from "@/lib/api-client";

import type {
  ActividadEstudiante,
  PreguntaEstudiante,
} from "../contrato/cuestionario";

/**
 * `PreguntaSinRespuestas` de H3.3 tal cual sale del backend (ya
 * sanitizada). Existe como tipo aparte para que el mapper
 * {@link aPreguntaEstudiante} sea el único punto de traducción y un
 * cambio del Swagger se absorba aquí.
 */
interface PreguntaEstudianteBackend {
  position: number;
  type: "test" | "completion" | "file" | "minigame";
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
 * Lista las actividades **publicadas** para el estudiante.
 *
 * **Limitación documentada (T5.8.4):** el listado real de H3.3 es
 * `GET /enrollments/:inscripcionId/activities` y el frontend no dispone
 * del `inscripcionId` (ver cabecera del archivo). Hasta que exista una
 * vía para obtenerlo sin endpoints nuevos, esta función devuelve siempre
 * `[]` — sin invocar el transporte — y la vista muestra su estado vacío.
 * El detalle por id ({@link obtenerParaEstudiante}) no tiene esta
 * limitación.
 *
 * @returns Siempre `[]` mientras el listado requiera `inscripcionId`.
 */
export async function listarPublicadas(): Promise<ActividadEstudiante[]> {
  await Promise.resolve();

  return [];
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
