/**
 * Fachada de datos de las entregas del panel docente: cola (T5.9.1,
 * PRO-399) y vista de revisión/calificación (T5.9.2, PRO-400).
 *
 * Punto único entre las vistas y el transporte (`@/lib/api-client`).
 * Habla con la **API real de H3.5** (`src/modules/submissions/`); no hay
 * mocks (spec §Supuestos 1).
 *
 * ## Responsabilidades de la fachada
 *
 * 1. **Primera red de validación en cliente** (AGENTS.md §6): valida lo
 *    que entra y lo que sale con los esquemas de `contrato/entregas.ts`
 *    (`EntregaColaSchema`/`MetaPaginacionSchema` en la cola;
 *    `CalificacionSchema` en la calificación y `EntregaDetalleSchema` en
 *    el detalle) antes de entregarlo a la vista → cualquier problema
 *    sale como `ApiError` 422 con el mensaje en español de
 *    `mensajeDeErroresZod`.
 * 2. **Mapper a dominio**: {@link aFilaCola} y {@link aEntregaDetalle}
 *    normalizan los IDs a `string` (BigInt de la BD, AGENTS.md §7) y
 *    conservan los `null` legítimos sin forzar defaults (plan §3).
 *
 * ## Contrato con H3.5 (verificado en `submissions.controller.ts` y los
 * mappers `aEntregaCola` / `aEntregaDetalleProfesor` de
 * `submissions.service.ts`)
 *
 * - `GET /api/v1/activities/:id/submissions/queue?page&limit&estado` →
 *   `{ data: EntregaColaDto[], meta }` (envoltura estándar de listados →
 *   `api.get`, nunca `apiPlano`). `@Roles('teacher')` + regla de
 *   pertenencia `'actividad'`.
 * - `page` es 1-indexada; `limit` tiene tope 50 en el backend y esta cola
 *   usa 20 (plan §Supuestos 3).
 * - `estado` es **opcional** (`@IsOptional`, enum `submission_status`):
 *   solo se añade a la query cuando el filtro es distinto de `"todas"`
 *   (plan §Transporte).
 * - `GET /api/v1/activities/:id/submissions/:entregaId` →
 *   `EntregaDetalleProfesorDto` **plano** (sin envoltura → `apiPlano.get`).
 *   El `404` se traduce a `null` (patrón de `obtenerActividad`).
 * - `POST /api/v1/activities/:id/submissions/:entregaId/calificar` →
 *   **200** (no 201) con `{ mensaje, entrega }` plano → `apiPlano.post`;
 *   se extrae `entrega`. El `409` (entrega ya no `submitted`) se propaga
 *   como `ApiError` con el mensaje del backend.
 *
 * Los errores del backend (404 anti-enumeración de actividad ajena, 403
 * del rol, 409 de anti-recalificación, 422 de rango de puntaje, 500) los
 * transporta `ApiError.message` tal cual: la fachada **no** pre-comprueba
 * nada contra el servidor. La UI jamás recalcula monedas (el trigger
 * `fn_award_coins` las escribe, AGENTS.md §6).
 */

import { ApiError, api, apiPlano } from "@/lib/api-client";

import { mensajeDeErroresZod } from "../contrato/actividades";
import {
  CalificacionSchema,
  EntregaColaSchema,
  EntregaDetalleSchema,
  MetaPaginacionSchema,
  type ColaEntregas,
  type DatosCalificacion,
  type EstadoEntrega,
  type EstudianteCola,
  type FilaCola,
  type FiltroEstado,
  type RespuestaCalificada,
  type EntregaDetalle,
} from "../contrato/entregas";

/**
 * Opciones de la cola del profesor (query del endpoint).
 *
 * `estado` se tipa como {@link FiltroEstado}: `"todas"` es un valor solo
 * del cliente (no viaja en la query; el backend distingue "sin filtro" por
 * la ausencia del parámetro).
 */
export interface OpcionesListarCola {
  /** Página solicitada (1-indexada). */
  page: number;

  /** Filas por página (la cola usa 20; el backend tope 50). */
  limit: number;

  /** Filtro por estado; `"todas"` no se envía en la query. */
  estado: FiltroEstado;
}

/**
 * `EstudianteColaDto` de H3.5 tal cual sale del backend.
 *
 * Shape de referencia para el mapper {@link aEstudianteCola}. La red de
 * validación en runtime es {@link EntregaColaSchema}; esta interfaz es la
 * vista estática del mismo contrato (mismo criterio que
 * `ActividadBackend` en `api/actividades.ts`).
 */
interface EstudianteColaBackend {
  id: string;
  usuario: string;
  nombre: string;
  apellido: string;
}

/**
 * `EntregaColaDto` de H3.5 tal cual sale del backend (fila de la cola,
 * sin `answers`).
 *
 * El backend ya serializa los IDs como `string` (`toString()` del BigInt)
 * y `puntaje` como `number` (`Number(score.toString())` del `NUMERIC`);
 * los mappers absorben cualquier variante numérica sin romper la vista.
 */
interface EntregaColaBackend {
  id: string;
  estudiante: EstudianteColaBackend;
  estado: EstadoEntrega;
  entregadoEn: string | null;
  puntaje: number | null;
  monedasOtorgadas: number;
}

/**
 * Traduce `EstudianteColaDto` al tipo de dominio {@link EstudianteCola}.
 *
 * @param backend DTO de H3.5 (IDs pueden llegar numéricos según el
 *   serializador, así que se normalizan a `string`).
 * @returns El estudiante con ids como `string`.
 */
function aEstudianteCola(backend: EstudianteColaBackend): EstudianteCola {
  return {
    id: String(backend.id),
    usuario: backend.usuario,
    nombre: backend.nombre,
    apellido: backend.apellido,
  };
}

/**
 * Traduce `EntregaColaDto` al tipo de dominio {@link FilaCola}.
 *
 * Normaliza el ID a `string` (BigInt de la BD, AGENTS.md §7) y el puntaje
 * a `number` (defensa ante un `Decimal` sin convertir). Los `null` de
 * `entregadoEn` y `puntaje` se conservan tal cual: son estado real de la
 * entrega (borrador sin envío, entrega sin calificar), no "faltantes"
 * (plan §3, test 3).
 *
 * @param backend Fila validada de {@link EntregaColaSchema}.
 * @returns La fila con el vocabulario del frontend.
 */
function aFilaCola(backend: EntregaColaBackend): FilaCola {
  return {
    id: String(backend.id),
    estudiante: aEstudianteCola(backend.estudiante),
    estado: backend.estado,
    entregadoEn: backend.entregadoEn,
    puntaje: backend.puntaje === null ? null : Number(backend.puntaje),
    monedasOtorgadas: backend.monedasOtorgadas,
  };
}

/**
 * Traduce una entrada del JSONB `answers` al tipo de dominio
 * {@link RespuestaCalificada}.
 *
 * Conserva las variantes reales del JSONB (`option`/`text`/`files`) y los
 * veredictos tal cual llegan (`null` o ausentes = sin evaluar aún). Solo
 * normaliza las cantidades a `number` (defensa ante un `Decimal` sin
 * convertir, mismo criterio que {@link aFilaCola}).
 *
 * @param backend Respuesta validada de {@link RespuestaCalificadaSchema}.
 * @returns La respuesta con el vocabulario del frontend.
 */
function aRespuestaCalificada(backend: RespuestaCalificada): RespuestaCalificada {
  return {
    ...backend,
    question_position: Number(backend.question_position),
    score: backend.score === null || backend.score === undefined
      ? backend.score
      : Number(backend.score),
  };
}

/**
 * Traduce `EntregaDetalleProfesorDto` al tipo de dominio
 * {@link EntregaDetalle}.
 *
 * Mismas normalizaciones que {@link aFilaCola} (IDs a `string`, puntaje a
 * `number`) más `calificadoEn`/`feedback`, conservando todos los `null`
 * legítimos del contrato (borrador sin envío, entrega sin calificar,
 * `rejected` sin `graded_at`).
 *
 * @param backend Detalle validado de {@link EntregaDetalleSchema}.
 * @returns El detalle con el vocabulario del frontend.
 */
function aEntregaDetalle(backend: EntregaDetalle): EntregaDetalle {
  return {
    id: String(backend.id),
    estudiante: aEstudianteCola(backend.estudiante),
    estado: backend.estado,
    entregadoEn: backend.entregadoEn,
    calificadoEn: backend.calificadoEn,
    puntaje: backend.puntaje === null ? null : Number(backend.puntaje),
    monedasOtorgadas: Number(backend.monedasOtorgadas),
    feedback: backend.feedback,
    respuestas: backend.respuestas.map(aRespuestaCalificada),
  };
}

/**
 * Lista una página de la cola de entregas de una actividad
 * (`GET /activities/:id/submissions/queue`).
 *
 * Flujo:
 * 1. Construye la query estándar `?page&limit`; `estado` solo se añade
 *    cuando el filtro es distinto de `"todas"` (el DTO lo marca
 *    `@IsOptional`).
 * 2. Pide la envoltura `{ data, meta }` con `api.get`.
 * 3. Valida filas y meta contra el contrato zod → un payload que viole el
 *    esquema lanza `ApiError` 422 con {@link mensajeDeErroresZod}, sin
 *    invocar la vista con datos corruptos.
 * 4. Mapea a {@link ColaEntregas} (IDs a `string`, `null` preservados).
 *
 * @param actividadId Actividad dueña de la cola (la pertenencia la
 *   verifica el backend: un 404 anti-enumeración llega como `ApiError`).
 * @param opciones Página, límite y filtro por estado.
 * @returns La página de entregas con su meta de paginación.
 * @throws {ApiError} 422 si la respuesta no cumple el contrato zod;
 *   403/404/500 del backend con su mensaje en español.
 */
export async function listarCola(
  actividadId: string,
  opciones: OpcionesListarCola,
): Promise<ColaEntregas> {
  const parametros = new URLSearchParams({
    page: String(opciones.page),
    limit: String(opciones.limit),
  });

  if (opciones.estado !== "todas") {
    parametros.set("estado", opciones.estado);
  }

  const respuesta = await api.get<unknown>(
    `activities/${actividadId}/submissions/queue?${parametros.toString()}`,
  );

  const filas = EntregaColaSchema.array().safeParse(respuesta.data);

  if (!filas.success) {
    throw new ApiError(mensajeDeErroresZod(filas.error.issues), 422);
  }

  const meta = MetaPaginacionSchema.safeParse(respuesta.meta);

  if (!meta.success) {
    throw new ApiError(mensajeDeErroresZod(meta.error.issues), 422);
  }

  return {
    data: filas.data.map(aFilaCola),
    meta: meta.data,
  };
}

/**
 * Obtiene el detalle de revisión de una entrega
 * (`GET /activities/:id/submissions/:entregaId`).
 *
 * Flujo:
 * 1. Pide el DTO **plano** `EntregaDetalleProfesorDto` con `apiPlano.get`
 *    (sin envoltura `{ data, meta }`).
 * 2. Valida la respuesta contra `EntregaDetalleSchema` → un payload que
 *    viole el contrato lanza `ApiError` 422 con {@link mensajeDeErroresZod}
 *    (misma doble red que {@link listarCola}).
 * 3. Mapea a {@link EntregaDetalle} (IDs a `string`, `null` preservados).
 *
 * El `404` (entrega inexistente, de otra actividad o actividad ajena)
 * se traduce a `null`, igual que `obtenerActividad`, para que la vista
 * muestre su estado "no encontrada" sin ramificar por código HTTP.
 *
 * @param actividadId Actividad dueña de la entrega.
 * @param entregaId Entrega a revisar.
 * @returns El detalle con respuestas y veredictos, o `null` si no existe.
 * @throws {ApiError} 422 si la respuesta no cumple el contrato zod;
 *   403/500 del backend con su mensaje en español.
 */
export async function obtenerEntrega(
  actividadId: string,
  entregaId: string,
): Promise<EntregaDetalle | null> {
  try {
    const respuesta = await apiPlano.get<unknown>(
      `activities/${actividadId}/submissions/${entregaId}`,
    );

    const detalle = EntregaDetalleSchema.safeParse(respuesta);

    if (!detalle.success) {
      throw new ApiError(mensajeDeErroresZod(detalle.error.issues), 422);
    }

    return aEntregaDetalle(detalle.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/**
 * Califica una entrega `submitted` (`POST …/submissions/:entregaId/calificar`).
 *
 * Flujo:
 * 1. Valida los datos con `CalificacionSchema` **antes de tocar el
 *    transporte**: `graded` sin `puntaje`, `rejected` con `puntaje` o un
 *    `feedback` fuera de 1..2000 se rechazan aquí como `ApiError` 422 con
 *    {@link mensajeDeErroresZod} (plan §3, test 4).
 * 2. Envía el body ya saneado (`rejected` jamás lleva `puntaje`; un
 *    `feedback` vacío se omite, porque el DTO del backend lo rechaza).
 * 3. Extrae `entrega` de `{ mensaje, entrega }` (responde **200**, no
 *    201), la valida con `EntregaDetalleSchema` y la mapea a
 *    {@link EntregaDetalle} (lo que el trigger `fn_award_coins` escribió:
 *    monedas y `calificadoEn`).
 *
 * El `409` (la entrega ya no está `submitted`: reenvío o carrera) **se
 * propaga** como `ApiError` con el mensaje en español del backend — la
 * vista lo muestra y recarga. La UI jamás recalcula monedas.
 *
 * @param actividadId Actividad dueña de la entrega.
 * @param entregaId Entrega a calificar (debe estar `submitted`).
 * @param datos Decisión (`graded`/`rejected`), puntaje y feedback.
 * @returns La entrega tal como queda tras la transición.
 * @throws {ApiError} 422 si `datos` no validan o el puntaje queda fuera
 *   del total (del backend); 404 inexistente; 409 si ya no está
 *   `submitted`; 400/403/500 del backend con su mensaje en español.
 */
export async function calificarEntrega(
  actividadId: string,
  entregaId: string,
  datos: DatosCalificacion,
): Promise<EntregaDetalle> {
  const calificacion = CalificacionSchema.safeParse(datos);

  if (!calificacion.success) {
    throw new ApiError(mensajeDeErroresZod(calificacion.error.issues), 422);
  }

  const respuesta = await apiPlano.post<unknown>(
    `activities/${actividadId}/submissions/${entregaId}/calificar`,
    calificacion.data,
  );

  const cuerpo = respuesta as { entrega?: unknown } | null;
  const detalle = EntregaDetalleSchema.safeParse(cuerpo?.entrega);

  if (!detalle.success) {
    throw new ApiError(mensajeDeErroresZod(detalle.error.issues), 422);
  }

  return aEntregaDetalle(detalle.data);
}
