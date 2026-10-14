/**
 * Fachada de datos de clases del panel docente (T5.6.1, PRO-385).
 *
 * Punto único entre las vistas (`app/teacher/clases/...`) y el transporte.
 * **Hoy el interior es un mock del contrato de H3.1** (ver
 * `clases-mock.ts`); **T5.6.4 (PRO-388) reemplaza solo el cuerpo** de estas
 * funciones por `api.post/api.get/api.patch` sin cambiar las firmas, con el
 * mismo criterio que T5.4.3 aplicó a `features/auth/api/auth.ts`.
 *
 * ## Contrato con el backend (H3.1, verificado en `main`)
 *
 * - `POST /api/v1/classes` (`@Roles('teacher')`): body
 *   `CrearClaseDto { nombre }` (MinLength 8, MaxLength 150) → `201` con
 *   `{ data: { mensaje, clase: ClaseRespuestaDto } }`. El **código de unión
 *   solo llega aquí** (lo genera la BD tras el INSERT); el cliente jamás lo
 *   envía (AGENTS.md §7).
 * - `GET /api/v1/classes?q=&page=&limit=` (T5.6.3): `q` obligatorio (≥ 3
 *   caracteres, mecánica pg_trgm) → `{ data: ClaseListadoDto[], meta }`.
 * - `PATCH /api/v1/classes/:id` (T5.6.3): `{ nombre?, estado? }`, al menos
 *   uno; `@PerteneceA` devuelve `403` si la clase es ajena.
 *
 * Los errores siempre salen como `ApiError` con `message` en español: la
 * vista solo muestra `error.message` y nunca ramifica por código HTTP
 * (spec §Contrato, punto 3).
 */

import { ApiError } from "@/lib/api-client";

import type { Clase, ClaseListado, EstadoClase, Meta } from "../tipos";

import {
  actualizarClaseMock,
  buscarClasesMock,
  crearClaseMock,
  obtenerClaseMock,
} from "./clases-mock";

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

/** Mensaje cuando la clase pedida no existe. */
const MENSAJE_CLASE_NO_ENCONTRADA = "No se encontró la clase solicitada.";

/**
 * Crea una clase y devuelve su código de unión.
 *
 * Valida el nombre con las mismas reglas que `CrearClaseDto` (8–150 tras
 * `trim`) **antes** de llamar al transporte, para que la vista muestre el
 * error sin una ida y vuelta — la BD y el backend vuelven a validar por su
 * parte (doble validación, AGENTS.md §6).
 *
 * **MOCK temporal:** el cuerpo llama a `crearClaseMock`; T5.6.4 (PRO-388)
 * lo sustituirá por `api.post<ClaseCreadaRespuestaDto>("classes", …)` y el
 * mapeo `env.data.clase → Clase`, sin tocar esta firma ni las vistas.
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

  return crearClaseMock({ nombre });
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
 * Busca clases del profesor por nombre (simula `GET /classes`).
 *
 * Reproduce `BuscarClasesQueryDto` (H3.1): **`q` obligatorio con ≥ 3
 * caracteres** (mecánica pg_trgm: los trigramas se extraen de 3
 * caracteres) y `limit` acotado a 1..50; `page` se normaliza a ≥ 1.
 *
 * **MOCK temporal:** el cuerpo llama a `buscarClasesMock`; T5.6.4 lo
 * sustituirá por `api.get("classes?q=…")`, sin tocar esta firma.
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

  return buscarClasesMock(texto, Math.max(page, 1), limit);
}

/**
 * Obtiene una clase por su id (andamio del detalle, T5.6.3).
 *
 * ⚠️ **Límite del contrato actual:** H3.1 **no** expone `GET
 * `/classes/:id`` (solo colección con `q`), por lo que hoy esta función
 * lee el catálogo mock. T5.6.4 deberá resolverlo con el API real (o el
 * backend deberá añadir el endpoint) — decisión registrada en los
 * riesgos del plan de T5.6.3.
 *
 * @param id Identificador de la clase.
 * @returns La clase, o `null` si no existe en la sesión actual.
 */
export function obtenerClase(id: string): Clase | null {
  return obtenerClaseMock(id);
}

/**
 * Edita una clase (simula `PATCH /classes/:id`).
 *
 * Réplica de `ActualizarClaseDto` (H3.1): al menos un campo, `nombre` de
 * 8–150 tras `trim` y `estado ∈ { active, archived }`. El código de unión
 * y el profesor **no** son editables (prevención de IDOR: el profesor sale
 * del token en el backend real).
 *
 * **MOCK temporal:** T5.6.4 lo sustituirá por `api.patch(...)`.
 *
 * @param id Identificador de la clase a editar.
 * @param parche Campos a cambiar (`nombre` y/o `estado`).
 * @returns La clase actualizada.
 * @throws {ApiError} 400 sin campos; 422 por nombre/estado inválidos;
 *   404 si la clase no existe.
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

  if (!obtenerClaseMock(id)) {
    throw new ApiError(MENSAJE_CLASE_NO_ENCONTRADA, 404);
  }

  return actualizarClaseMock(id, parcheValidado);
}
