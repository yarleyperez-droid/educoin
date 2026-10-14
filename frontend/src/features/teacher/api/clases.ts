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

import type { Clase } from "../tipos";

import { crearClaseMock } from "./clases-mock";

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
