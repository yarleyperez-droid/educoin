/**
 * Fachada de datos de actividades del panel docente (T5.6.2 → T5.6.4, PRO-388).
 *
 * Punto único entre las vistas del editor y el transporte. Desde T5.6.4
 * habla con la **API real de H3.3** (`src/modules/activities/`) mediante
 * `apiPlano`/`api` de `@/lib/api-client`; los mocks de T5.6.2 ya no
 * existen. Las firmas se conservan, salvo {@link obtenerActividad} que
 * pasó a asíncrona (justificado en su docstring).
 *
 * ## Responsabilidades de la fachada
 *
 * 1. **Primera red de validación en cliente** (AGENTS.md §6): normaliza
 *    `position` ({@link normalizarPosiciones}) y valida con
 *    `BorradorActividadSchema` + `PreguntasSchema` antes de tocar el
 *    transporte → cualquier problema sale como `ApiError` 422 con el
 *    mensaje en español de `mensajeDeErroresZod`.
 * 2. **Transiciones de estado**: solo `draft → published`
 *    ({@link publicarActividad}); no existe reversión (CA 3 de H5.6) ni
 *    acciones sobre `deleted`.
 *
 * ## Contrato con H3.3 (verificado en `test/activities.e2e-spec.ts`)
 *
 * Los endpoints **unitarios** devuelven su DTO **en plano** (sin la
 * envoltura `{ data, meta }` de los listados); por eso van por
 * `apiPlano`:
 *
 * - `POST /api/v1/classes/:claseId/activities` → `{ mensaje, actividad }`
 *   (la actividad nace en `draft`; `claseId` sale de la ruta, nunca del body).
 * - `GET /api/v1/activities/:id` → `ActividadRespuestaDto` con el JSONB
 *   `preguntas` completo.
 * - `PATCH /api/v1/activities/:id` → `ActividadRespuestaDto` (en
 *   `published` solo admite `cierraEn`; el resto → 409).
 * - `POST /api/v1/activities/:id/publicar` (`200`) →
 *   `ActividadRespuestaDto` (draft → published; repetir → 409).
 *
 * El listado usa la envoltura estándar `api.get` →
 * `{ data: ActividadListadoDto[], meta }`: **las filas no traen
 * `preguntas`** (solo el detalle), ni `descripcion` ni `actualizadoEn`;
 * {@link listarActividades} completa esos campos con valores neutros.
 *
 * Los errores 404/409 (inexistente, publicada, eliminada) los produce el
 * backend con su mensaje en español, que `ApiError.message` ya transporta:
 * la fachada **no** pre-comprueba estados contra el servidor. La única
 * excepción es {@link obtenerActividad}, que traduce el `404` a `null`
 * para el estado "no encontrada" de la vista.
 */

import { ApiError, api, apiPlano } from "@/lib/api-client";

import type { Actividad, EstadoActividad } from "../tipos";
import {
  BorradorActividadSchema,
  mensajeDeErroresZod,
  normalizarPosiciones,
  PreguntasSchema,
  type Pregunta,
} from "../contrato/actividades";

export type { Actividad };

/**
 * `ActividadRespuestaDto` de H3.3 tal cual sale del backend (detalle).
 *
 * Shape de referencia para el mapper {@link aActividad}, el único punto de
 * traducción al vocabulario del frontend (AGENTS.md §5). `eliminadaEn` se
 * descarta allí: el frontend modela el borrado lógico solo con `estado`.
 */
interface ActividadBackend {
  id: string;
  claseId: string;
  titulo: string;
  descripcion: string | null;
  recompensaMonedas: number;
  estado: EstadoActividad;
  preguntas: Pregunta[];
  publicadaEn: string | null;
  cierraEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
  eliminadaEn: string | null;
}

/**
 * `ActividadListadoDto` de H3.3: filas del listado de una clase, **sin
 * `preguntas`** (el JSONB completo solo viaja en el detalle), sin
 * `descripcion` y sin `actualizadoEn`.
 */
interface ActividadListadoBackend {
  id: string;
  titulo: string;
  estado: EstadoActividad;
  recompensaMonedas: number;
  publicadaEn: string | null;
  cierraEn: string | null;
  creadoEn: string;
}

/** `ActividadCreadaRespuestaDto` de H3.3: `{ mensaje, actividad }` en plano. */
interface ActividadCreadaBackend {
  mensaje: string;
  actividad: ActividadBackend;
}

/**
 * Traduce `ActividadRespuestaDto` al tipo de dominio {@link Actividad}.
 *
 * El backend llama `creadoEn`/`actualizadoEn` a las fechas y el frontend
 * conserva su vocabulario histórico `creadaEn`/`actualizadaEn` (el nombre
 * que ya usan las vistas). `eliminadaEn` no se propaga: el borrado lógico
 * se refleja en `estado === "deleted"`.
 *
 * @param backend DTO plano de H3.3 (IDs pueden llegar numéricos según el
 *   serializador, así que se normalizan a `string`).
 * @returns La actividad con el vocabulario del frontend.
 */
function aActividad(backend: ActividadBackend): Actividad {
  return {
    id: String(backend.id),
    claseId: String(backend.claseId),
    titulo: backend.titulo,
    descripcion: backend.descripcion,
    recompensaMonedas: backend.recompensaMonedas,
    estado: backend.estado,
    preguntas: backend.preguntas,
    publicadaEn: backend.publicadaEn,
    cierraEn: backend.cierraEn,
    creadaEn: backend.creadoEn,
    actualizadaEn: backend.actualizadoEn,
  };
}

/**
 * Datos de entrada para crear una actividad.
 *
 * Coincide con los campos editables del formulario (spec §Interfaces):
 * `recompensaMonedas` es entero ≥ 0 (CHECK de la BD) y `preguntas` llega
 * sin normalizar — la fachada renumera `position` antes de validar.
 */
export interface DatosCrearActividad {
  /** Clase dueña de la actividad. */
  claseId: string;

  /** Título (1–200 tras `trim`). */
  titulo: string;

  /** Descripción opcional (vacío → `undefined`). */
  descripcion?: string;

  /** Monedas otorgadas al calificar (entero ≥ 0). */
  recompensaMonedas: number;

  /** Preguntas del editor (posición sin normalizar). */
  preguntas: Pregunta[];
}

/**
 * Crea una actividad en `draft` validando contra el contrato zod.
 *
 * Flujo:
 * 1. Normaliza `position` (1..n) — el índice es derivado del orden del
 *    editor, no un dato del usuario.
 * 2. Valida los datos generales (`BorradorActividadSchema`) y el JSONB
 *    `questions` (`PreguntasSchema`). Cualquier problema → `ApiError` 422
 *    con el mensaje legible de {@link mensajeDeErroresZod} (la vista lo
 *    muestra en el resumen `role="alert"` **sin limpiar el formulario**).
 * 3. Persiste en `POST /classes/:claseId/activities`; `descripcion` solo
 *    viaja si quedó definida tras el `trim` (un borrado de la descripción
 *    es cosa de {@link actualizarActividad}, que sí puede enviar `""`).
 *
 * @param datos Datos del formulario (título, recompensa y preguntas).
 * @returns La actividad creada, en estado `draft`.
 * @throws {ApiError} 422 si el JSONB o los datos generales no validan.
 */
export async function crearActividad(
  datos: DatosCrearActividad,
): Promise<Actividad> {
  const preguntasNormalizadas = normalizarPosiciones(datos.preguntas);

  const borrador = BorradorActividadSchema.safeParse({
    titulo: datos.titulo,
    descripcion:
      datos.descripcion === undefined || datos.descripcion.trim() === ""
        ? undefined
        : datos.descripcion,
    recompensaMonedas: datos.recompensaMonedas,
  });

  if (!borrador.success) {
    throw new ApiError(mensajeDeErroresZod(borrador.error.issues), 422);
  }

  const preguntas = PreguntasSchema.safeParse(preguntasNormalizadas);

  if (!preguntas.success) {
    throw new ApiError(mensajeDeErroresZod(preguntas.error.issues), 422);
  }

  const cuerpo: {
    titulo: string;
    descripcion?: string;
    recompensaMonedas: number;
    preguntas: Pregunta[];
  } = {
    titulo: borrador.data.titulo,
    recompensaMonedas: borrador.data.recompensaMonedas,
    preguntas: preguntas.data,
  };

  if (borrador.data.descripcion !== undefined) {
    cuerpo.descripcion = borrador.data.descripcion;
  }

  const respuesta = await apiPlano.post<ActividadCreadaBackend>(
    `classes/${datos.claseId}/activities`,
    cuerpo,
  );

  return aActividad(respuesta.actividad);
}

/**
 * Publica una actividad (`draft → published`) con `POST /activities/:id/publicar`.
 *
 * **No existe reversión** `published → draft` (CA 3 de H5.6): el backend
 * responde `ApiError` 409 con mensaje claro. Las actividades `deleted`
 * tampoco se publican (borrado lógico de la BD → el mutador responde 404).
 * El cuerpo va vacío: la fecha de cierre es opcional en
 * `PublicarActividadDto` y la UI no la ofrece.
 *
 * @param id Identificador de la actividad en `draft`.
 * @returns La actividad publicada (con `publicadaEn`).
 * @throws {ApiError} 404 si no existe; 409 si no está en `draft` (del backend).
 */
export async function publicarActividad(id: string): Promise<Actividad> {
  return aActividad(
    await apiPlano.post<ActividadBackend>(`activities/${id}/publicar`, {}),
  );
}

/**
 * Obtiene una actividad por su id (`GET /activities/:id`, detalle completo).
 *
 * Asíncrona desde T5.6.4 porque antes leía un catálogo local síncrono y
 * ahora hace una petición real (H3.3 expone el detalle desde esta tarea,
 * con el JSONB `preguntas` entero). El `404` (inexistente, eliminada o no
 * visible) se traduce a `null` para que la vista maneje su estado "no
 * encontrada" sin ramificar por código HTTP; el resto de errores se
 * propagan como `ApiError`.
 *
 * @param id Identificador de la actividad.
 * @returns La actividad con sus preguntas, o `null` si no existe.
 */
export async function obtenerActividad(id: string): Promise<Actividad | null> {
  try {
    return aActividad(await apiPlano.get<ActividadBackend>(`activities/${id}`));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/**
 * Lista las actividades de una clase, **ocultando las eliminadas**.
 *
 * `GET /classes/:claseId/activities` devuelve `{ data, meta }` con
 * `ActividadListadoDto[]`: filas de resumen **sin `preguntas`** (el JSONB
 * completo solo llega en `GET /activities/:id`), sin `descripcion` y sin
 * `actualizadoEn`. Por eso cada fila se completa con `preguntas: []`,
 * `descripcion: null` y `actualizadaEn = creadoEn`: el conteo de preguntas
 * **no** puede mostrarse en la tabla de la vista (solo en el detalle).
 *
 * El borrado lógico (`status = 'deleted'` + `deleted_at`, AGENTS.md §6`)
 * no es visible en el panel: solo `draft` y `published` — el listado del
 * backend puede incluir filas `deleted`, así que se filtran aquí.
 *
 * @param claseId Clase dueña de las actividades.
 * @returns Actividades visibles de la clase (orden del backend: más
 *   recientes primero).
 */
export async function listarActividades(claseId: string): Promise<Actividad[]> {
  const respuesta = await api.get<ActividadListadoBackend[]>(
    `classes/${claseId}/activities`,
  );

  return respuesta.data
    .map(
      (fila): Actividad => ({
        id: String(fila.id),
        claseId,
        titulo: fila.titulo,
        descripcion: null,
        recompensaMonedas: fila.recompensaMonedas,
        estado: fila.estado,
        preguntas: [],
        publicadaEn: fila.publicadaEn,
        cierraEn: fila.cierraEn,
        creadaEn: fila.creadoEn,
        actualizadaEn: fila.creadoEn,
      }),
    )
    .filter((actividad) => actividad.estado !== "deleted");
}

/**
 * Edita una actividad (`PATCH /activities/:id`).
 *
 * Reglas:
 * - Solo los campos **definidos** del parche viajan en el body (el backend
 *   conserva el resto). `descripcion` es la excepción deliberada: un string
 *   vacío **sí** se envía (`""` limpia la descripción; `undefined` no toca
 *   nada).
 * - La primera red de validación (zod) revisa únicamente los campos
 *   presentes — misma reglas y mensajes de {@link crearActividad}: un
 *   `titulo` fuera de 1–200 o un JSONB de preguntas inválido rechazan con
 *   `ApiError` 422 **sin invocar el transporte**.
 * - Los estados los resuelve el backend: `published` solo acepta
 *   `cierraEn` (409 en lo demás, CA 3 de H5.6) y `deleted` no admite
 *   mutaciones (404).
 *
 * @param id Identificador de la actividad.
 * @param parche Campos a cambiar (título, descripción, recompensa, preguntas).
 * @returns La actividad actualizada.
 * @throws {ApiError} 404 inexistente/eliminada; 409 publicada (del backend);
 *   422 si algún campo presente no valida contra el contrato zod.
 */
export async function actualizarActividad(
  id: string,
  parche: {
    titulo?: string;
    descripcion?: string;
    recompensaMonedas?: number;
    preguntas?: Pregunta[];
  },
): Promise<Actividad> {
  const borrador = BorradorActividadSchema.partial().safeParse({
    ...(parche.titulo !== undefined ? { titulo: parche.titulo } : {}),
    ...(parche.descripcion !== undefined
      ? { descripcion: parche.descripcion }
      : {}),
    ...(parche.recompensaMonedas !== undefined
      ? { recompensaMonedas: parche.recompensaMonedas }
      : {}),
  });

  if (!borrador.success) {
    throw new ApiError(mensajeDeErroresZod(borrador.error.issues), 422);
  }

  const cuerpo: {
    titulo?: string;
    descripcion?: string;
    recompensaMonedas?: number;
    preguntas?: Pregunta[];
  } = {};

  if (borrador.data.titulo !== undefined) {
    cuerpo.titulo = borrador.data.titulo;
  }

  if (parche.descripcion !== undefined) {
    // `""` es un valor legítimo: limpia la descripción (el backend lo
    // acepta); el `trim` del esquema lo normaliza antes de enviar.
    cuerpo.descripcion = borrador.data.descripcion ?? "";
  }

  if (borrador.data.recompensaMonedas !== undefined) {
    cuerpo.recompensaMonedas = borrador.data.recompensaMonedas;
  }

  if (parche.preguntas !== undefined) {
    const preguntas = PreguntasSchema.safeParse(
      normalizarPosiciones(parche.preguntas),
    );

    if (!preguntas.success) {
      throw new ApiError(mensajeDeErroresZod(preguntas.error.issues), 422);
    }

    cuerpo.preguntas = preguntas.data;
  }

  return aActividad(
    await apiPlano.patch<ActividadBackend>(`activities/${id}`, cuerpo),
  );
}
