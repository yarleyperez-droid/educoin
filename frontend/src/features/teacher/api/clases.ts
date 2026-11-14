/**
 * Fachada de datos de clases del panel docente (T5.6.1 → T5.6.4, PRO-388).
 *
 * Punto único entre las vistas (`app/teacher/clases/...`) y el transporte.
 * Desde T5.6.4 habla con la **API real de H3.1** mediante
 * `apiPlano`/`api` de `@/lib/api-client`; los mocks de T5.6.1 ya no
 * existen. Las firmas de T5.6.1 se conservan, salvo {@link obtenerClase}
 * que pasó a asíncrona (justificado en su docstring).
 *
 * ## Contrato con el backend (H3.1, verificado en `test/classes.e2e-spec.ts`)
 *
 * Los endpoints **unitarios** de H3.1 devuelven su DTO **en plano** (sin
 * la envoltura `{ data, meta }` de los listados); por eso van por
 * `apiPlano`:
 *
 * - `POST /api/v1/classes` (`@Roles('teacher')`): body
 *   `CrearClaseDto { nombre }` (MinLength 8, MaxLength 150) → `201` con
 *   `{ mensaje, clase: ClaseRespuestaDto }`. El **código de unión
 *   solo llega aquí** (lo genera la BD tras el INSERT); el cliente jamás lo
 *   envía (AGENTS.md §7).
 * - `GET /api/v1/classes/:id` (`@Roles('teacher')` + `@PerteneceA`):
 *   `ClaseRespuestaDto` en plano (incluye `codigo`); `404` si la clase no
 *   existe o es ajena.
 * - `PATCH /api/v1/classes/:id` (T5.6.3): `{ nombre?, estado? }`, al menos
 *   uno; `@PerteneceA` devuelve `403` si la clase es ajena y `404` si no
 *   existe — el cliente **no** pre-comprueba la existencia: el 404 real ya
 *   llega como `ApiError`.
 *
 * El único listado, `GET /api/v1/classes?q=&page=&limit=` (T5.6.3), sí usa
 * la envoltura estándar `api.get` → `{ data: ClaseListadoDto[], meta }`
 * (con `q` obligatorio ≥ 3 caracteres, mecánica pg_trgm).
 *
 * Los errores siempre salen como `ApiError` con `message` en español: la
 * vista solo muestra `error.message` y nunca ramifica por código HTTP
 * (spec §Contrato, punto 3). La única excepción es {@link obtenerClase},
 * que traduce el `404` a `null` para el estado "no encontrada" de la vista.
 */

import { ApiError, api, apiPlano } from "@/lib/api-client";

import type { Clase, ClaseListado, EstadoClase, Meta } from "../tipos";

/** Nombre mínimo de la clase (misma regla que `CrearClaseDto`, H3.1). */
export const LONGITUD_MINIMA_NOMBRE = 8;

/** Nombre máximo de la clase (`VARCHAR(150)` de la BD). */
export const LONGITUD_MAXIMA_NOMBRE = 150;

/** Mensaje cuando el nombre viene vacío. */
const MENSAJE_NOMBRE_VACIO = "Ingresa un nombre para la clase.";

/** Mensaje cuando el nombre no llega a 8 caracteres. */
const MENSAJE_NOMBRE_CORTO =
  "El nombre de la clase debe tener al menos 8 caracteres.";

/** Mensaje cuando el nombre supera los 150 caracteres. */
const MENSAJE_NOMBRE_LARGO =
  "El nombre de la clase no puede superar los 150 caracteres.";

/** Mensaje cuando la búsqueda no llega a 3 caracteres (mecánica pg_trgm). */
const MENSAJE_BUSQUEDA_CORTA =
  "La búsqueda debe tener al menos 3 caracteres.";

/** Mensaje cuando el `PATCH` viene sin ningún campo. */
const MENSAJE_SIN_CAMBIOS = "Debes cambiar el nombre o el estado de la clase.";

/** Mensaje cuando el estado no pertenece al enum `class_status`. */
const MENSAJE_ESTADO_INVALIDO =
  'El estado de la clase debe ser "active" o "archived".';

/**
 * `ClaseRespuestaDto` de H3.1 tal cual sale del backend.
 *
 * Shape idéntico a {@link Clase}; existe como tipo aparte para que el
 * mapper {@link aClase} sea el único punto de traducción (AGENTS.md §5) y
 * un cambio del Swagger se absorba aquí.
 */
interface ClaseBackend {
  id: string;
  profesorId: string;
  nombre: string;
  codigo: string;
  estado: EstadoClase;
  creadoEn: string;
  actualizadoEn: string;
}

/** `ClaseCreadaRespuestaDto` de H3.1: `{ mensaje, clase }` en plano. */
interface ClaseCreadaBackend {
  mensaje: string;
  clase: ClaseBackend;
}

/**
 * Traduce `ClaseRespuestaDto` al tipo de dominio {@link Clase}.
 *
 * @param backend DTO plano de H3.1 (puede llegar con IDs numéricos según
 *   el serializador, así que se normalizan a `string`).
 * @returns La clase con el vocabulario del frontend.
 */
function aClase(backend: ClaseBackend): Clase {
  return {
    id: String(backend.id),
    profesorId: String(backend.profesorId),
    nombre: backend.nombre,
    codigo: backend.codigo,
    estado: backend.estado,
    creadoEn: backend.creadoEn,
    actualizadoEn: backend.actualizadoEn,
  };
}

/**
 * Crea una clase y devuelve su código de unión.
 *
 * Valida el nombre con las mismas reglas que `CrearClaseDto` (8–150 tras
 * `trim`) **antes** de llamar al transporte, para que la vista muestre el
 * error sin una ida y vuelta — la BD y el backend vuelven a validar por su
 * parte (doble validación, AGENTS.md §6).
 *
 * @param datos Nombre de la clase (se normaliza con `trim`).
 * @returns La clase creada: incluye `codigo` de 8 caracteres y estado
 *   `active`.
 * @throws {ApiError} 422 si el nombre no cumple 8–150 caracteres.
 */
export async function crearClase(datos: { nombre: string }): Promise<Clase> {
  const nombre = datos.nombre.trim();

  if (nombre === "") {
    throw new ApiError(MENSAJE_NOMBRE_VACIO, 422);
  }

  if (nombre.length < LONGITUD_MINIMA_NOMBRE) {
    throw new ApiError(MENSAJE_NOMBRE_CORTO, 422);
  }

  if (nombre.length > LONGITUD_MAXIMA_NOMBRE) {
    throw new ApiError(MENSAJE_NOMBRE_LARGO, 422);
  }

  const respuesta = await apiPlano.post<ClaseCreadaBackend>("classes", {
    nombre,
  });

  return aClase(respuesta.clase);
}

/**
 * Resultado paginado de la búsqueda de clases (`{ data, meta }`).
 */
export interface ResultadoBusquedaClases {
  /** Ítems de la página actual (sin `codigo`, decisión del backend). */
  data: ClaseListado[];

  /** Meta de paginación estándar. */
  meta: Meta;
}

/**
 * Lista las clases del profesor autenticado sin texto de búsqueda
 * (`GET /classes` sin `q`).
 *
 * El backend admite `q` opcional: cuando se omite lista todas las clases
 * visibles para el rol (para `teacher`, las suyas propias), ordenadas por
 * fecha de creación descendente. Esto permite al dashboard y a "Mis
 * Clases" mostrar el resumen completo sin depender de un término de
 * búsqueda.
 *
 * @param page Página 1-indexada (por defecto 1).
 * @param limit Filas por página (por defecto 20, tope 50).
 * @returns Página de resultados con su `meta`.
 */
export async function listarMisClases(
  page = 1,
  limit = 20,
): Promise<ResultadoBusquedaClases> {
  const pagina = Math.max(page, 1);
  const parametros = new URLSearchParams({
    page: String(pagina),
    limit: String(limit),
  });

  const respuesta = await api.get<ClaseListado[]>(`classes?${parametros}`);

  return {
    data: respuesta.data,
    meta: respuesta.meta ?? {
      total: respuesta.data.length,
      page: pagina,
      limit,
    },
  };
}

/**
 * Busca clases del profesor por nombre (`GET /classes`).
 *
 * Reproduce `BuscarClasesQueryDto` (H3.1): **`q` obligatorio con ≥ 3
 * caracteres** (mecánica pg_trgm: los trigramas se extraen de 3
 * caracteres) y `limit` acotado a 1..50; `page` se normaliza a ≥ 1. El
 * backend ya devuelve `ClaseListadoDto` con el vocabulario del frontend,
 * así que el resultado viaja tal cual (la envoltura `{ data, meta }` de
 * los listados es la estándar de `api.get`).
 *
 * @param q Texto de búsqueda (se normaliza con `trim`).
 * @param page Página 1-indexada (por defecto 1).
 * @param limit Filas por página (por defecto 20, tope 50).
 * @returns Página de resultados con su `meta`.
 * @throws {ApiError} 422 si `q` tiene menos de 3 caracteres.
 */
export async function buscarClases(
  q: string,
  page = 1,
  limit = 20,
): Promise<ResultadoBusquedaClases> {
  const texto = q.trim();

  if (texto.length < 3) {
    throw new ApiError(MENSAJE_BUSQUEDA_CORTA, 422);
  }

  const pagina = Math.max(page, 1);
  const parametros = new URLSearchParams({
    q: texto,
    page: String(pagina),
    limit: String(limit),
  });

  const respuesta = await api.get<ClaseListado[]>(`classes?${parametros}`);

  return {
    data: respuesta.data,
    // `meta` es opcional solo en el tipado de `ApiEnvelope`; el listado de
    // H3.1 siempre lo trae (e2e). El fallback mantiene el shape coherente
    // si el backend llegara a omitirlo.
    meta: respuesta.meta ?? { total: respuesta.data.length, page: pagina, limit },
  };
}

/**
 * Obtiene una clase por su id (`GET /classes/:id`, T5.6.4).
 *
 * Asíncrona desde T5.6.4 porque antes leía un catálogo local síncrono y
 * ahora hace una petición real (H3.1 expone el detalle desde esta tarea).
 * El `404` (clase inexistente o ajena) se traduce a `null` para que la
 * vista maneje su estado "no encontrada" sin ramificar por código HTTP;
 * el resto de errores se propagan como `ApiError`.
 *
 * @param id Identificador de la clase.
 * @returns La clase (con `codigo` de unión), o `null` si no existe o no
 *   pertenece al profesor autenticado.
 */
export async function obtenerClase(id: string): Promise<Clase | null> {
  try {
    return aClase(await apiPlano.get<ClaseBackend>(`classes/${id}`));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/**
 * Edita una clase (`PATCH /classes/:id`).
 *
 * Réplica de `ActualizarClaseDto` (H3.1): al menos un campo, `nombre` de
 * 8–150 tras `trim` y `estado ∈ { active, archived }`. El código de unión
 * y el profesor **no** son editables (prevención de IDOR: el profesor sale
 * del token en el backend real). La existencia **no** se pre-comprueba:
 * el backend responde `404` (clase inexistente o ajena) con su mensaje en
 * español, que `ApiError.message` ya transporta.
 *
 * @param id Identificador de la clase a editar.
 * @param parche Campos a cambiar (`nombre` y/o `estado`).
 * @returns La clase actualizada.
 * @throws {ApiError} 400 sin campos; 422 por nombre/estado inválidos;
 *   404 si la clase no existe (del backend).
 */
export async function actualizarClase(
  id: string,
  parche: { nombre?: string; estado?: EstadoClase },
): Promise<Clase> {
  const hayNombre = parche.nombre !== undefined;
  const hayEstado = parche.estado !== undefined;

  if (!hayNombre && !hayEstado) {
    throw new ApiError(MENSAJE_SIN_CAMBIOS, 400);
  }

  const parcheValidado: { nombre?: string; estado?: EstadoClase } = {};

  if (hayNombre) {
    const nombre = parche.nombre?.trim() ?? "";

    if (nombre === "") {
      throw new ApiError(MENSAJE_NOMBRE_VACIO, 422);
    }

    if (nombre.length < LONGITUD_MINIMA_NOMBRE) {
      throw new ApiError(MENSAJE_NOMBRE_CORTO, 422);
    }

    if (nombre.length > LONGITUD_MAXIMA_NOMBRE) {
      throw new ApiError(MENSAJE_NOMBRE_LARGO, 422);
    }

    parcheValidado.nombre = nombre;
  }

  if (hayEstado) {
    if (parche.estado !== "active" && parche.estado !== "archived") {
      throw new ApiError(MENSAJE_ESTADO_INVALIDO, 422);
    }

    parcheValidado.estado = parche.estado;
  }

  return aClase(
    await apiPlano.patch<ClaseBackend>(`classes/${id}`, parcheValidado),
  );
}
