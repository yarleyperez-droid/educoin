/**
 * Capa de lectura de sesión del frontend EduCoins (T5.3.3, actualizada en
 * T5.4.3 / PRO-381).
 *
 * Esta capa es la **única fuente de verdad de la sesión** para el middleware
 * de Next (T5.3.2) y para cualquier vista que necesite conocer al usuario
 * autenticado. Lee la cookie legible `educoins_sesion` que escribe la capa de
 * auth (`features/auth/api/auth`) tras un login real contra H2.1.
 *
 * ## Vocabulario del backend (T5.4.3)
 *
 * El tipo {@link Sesion} espejea `UsuarioRespuestaDto` del backend
 * (`src/modules/auth/dto/sesion-respuesta.dto.ts`): `id`, `username`,
 * `email`, `role`, `nombre`, `apellido`, `organizacionId` (nullable: el admin
 * no tiene organización) y `debeCambiarContrasena`. Gana el contrato del
 * backend sobre el vocabulario previo del frontend (`userId`/`rol`/…).
 *
 * ## Por qué la cookie sigue siendo legible (no httpOnly)
 *
 * El middleware de Next corre en **Edge** y solo puede leer cookies que el
 * navegador le envía en la petición. La cookie `refresh_token` del backend es
 * `httpOnly` con `Path=/api/v1/auth`, por lo que **nunca** llega a las rutas
 * de panel (`/teacher`, …). Por eso la sesión para el middleware viaja en
 * `educoins_sesion` (legible), con claims no sensibles y **sin tokens**: la
 * cookie de refresh la gestiona el navegador para `auth/refresh` y el access
 * token vive solo en memoria (`lib/api-client`).
 *
 * ## Esto NO es seguridad
 *
 * Cualquiera puede escribir `educoins_sesion` desde DevTools: no está firmada.
 * Es solo andamio de UX (evitar parpadear paneles ajenos). La barrera real de
 * seguridad es el backend (CA 4 de H5.3): el rol validado aquí **nunca**
 * sustituye la validación del servidor.
 *
 * Compatible con **Edge runtime** (el middleware de Next corre en Edge):
 * sin `fs`, sin `Buffer`, sin `process.env` fuera de `NEXT_PUBLIC_*`.
 */

import type { NextRequest } from "next/server";

/**
 * Roles de usuario del MVP.
 *
 * Coherentes con `AGENTS.md §8` (tabla única `users` con columna `role`) y
 * con los valores exactos del enum `user_role` de la BD.
 */
export type Rol = "admin" | "teacher" | "student";

/**
 * Sesión del usuario autenticada, espejo de `UsuarioRespuestaDto` (H2.1).
 *
 * Los IDs se manejan como `string` aunque en la BD sean `bigint`, para
 * evitar pérdida de precisión de Number en JavaScript (convención de
 * `AGENTS.md §8`).
 */
export interface Sesion {
  /** ID del usuario. */
  id: string;

  /** Nombre de usuario (CITEXT en la BD, único). */
  username: string;

  /** Correo electrónico (CITEXT en la BD, único). */
  email: string;

  /** Rol del usuario. */
  role: Rol;

  /** Nombre real del usuario. */
  nombre: string;

  /** Apellido real del usuario. */
  apellido: string;

  /**
   * ID de la organización a la que pertenece (string por `bigint` de BD).
   *
   * `null` para el admin global: no pertenece a ninguna organización
   * (coherente con `UsuarioRespuestaDto.organizacionId: string | null`).
   */
  organizacionId: string | null;

  /**
   * Indica si el usuario debe cambiar su contraseña en el próximo ingreso
   * (columna real `users.must_change_password`; el backend lo publica como
   * `debeCambiarContrasena`).
   *
   * Consumidor: T5.4.2 (PRO-379), para bloquear el panel hasta que el
   * usuario cambie su contraseña inicial.
   */
  debeCambiarContrasena: boolean;
}

/**
 * Nombre de la cookie de sesión legible por el middleware.
 *
 * La escribe la capa de auth tras un login real (claims no sensibles, sin
 * tokens). **No confundir** con la cookie `refresh_token` del backend, que es
 * `httpOnly` y solo viaja a `/api/v1/auth`.
 */
const NOMBRE_COOKIE_SESION = "educoins_sesion";

/** Conjunto de roles válidos, para validar el rol leído de la cookie. */
const ROLES_VALIDOS: ReadonlySet<string> = new Set<Rol>([
  "admin",
  "teacher",
  "student",
]);

/**
 * Codifica una sesión en el valor de cookie (Unicode-safe).
 *
 * Usa `encodeURIComponent` + `btoa` para que nombres con acentos o ñ no
 * rompan `btoa` (que solo soporta Latin-1).
 *
 * @param sesion Sesión a codificar.
 * @returns Valor listo para escribir en la cookie `educoins_sesion`.
 */
export function crearCookieSesion(sesion: Sesion): string {
  return btoa(encodeURIComponent(JSON.stringify(sesion)));
}

/**
 * Decodifica el valor crudo de la cookie de sesión.
 *
 * Función pura compartida por {@link leerSesion} (middleware/servidor) y por
 * `leerSesionActual` de `features/auth/api/auth` (vistas en el navegador),
 * para que la decodificación viva en un solo lugar.
 *
 * **Por qué no basta con `leerSesion` en el navegador (bug real, T5.4.4):**
 * `leerSesion` recibe un `NextRequest` y lee su cabecera `cookie`; pero la
 * Fetch API de los navegadores **descarta en silencio la cabecera `cookie`**
 * al construir un `Request` (*forbidden request header*), por lo que
 * `request.cookies.get(...)` siempre devuelve `undefined` en el cliente y la
 * sesión se leía como `null` (la vista de cambio de contraseña quedaba
 * atascada en "Cargando…"). Por eso el valor ya extraído de `document.cookie`
 * se decodifica aquí directamente, sin pasar por `NextRequest`.
 *
 * Devuelve `null` (no lanza) ante cualquier entrada inválida: base64/JSON
 * rotos, campos obligatorios ausentes, rol desconocido o
 * `organizacionId` que no sea `string` ni `null`.
 *
 * @param valor Valor crudo de la cookie (payload base64 de {@link crearCookieSesion}).
 * @returns La sesión tipada, o `null` si el valor no es una sesión válida.
 */
export function decodificarSesion(valor: string): Sesion | null {
  let crudo: unknown;

  try {
    crudo = JSON.parse(decodeURIComponent(atob(valor)));
  } catch {
    return null;
  }

  if (typeof crudo !== "object" || crudo === null) {
    return null;
  }

  const candidato = crudo as Record<string, unknown>;

  if (
    typeof candidato.id !== "string" ||
    typeof candidato.username !== "string" ||
    typeof candidato.email !== "string" ||
    typeof candidato.role !== "string" ||
    !ROLES_VALIDOS.has(candidato.role) ||
    typeof candidato.nombre !== "string" ||
    typeof candidato.apellido !== "string" ||
    !(typeof candidato.organizacionId === "string" ||
      candidato.organizacionId === null) ||
    typeof candidato.debeCambiarContrasena !== "boolean"
  ) {
    return null;
  }

  return {
    id: candidato.id,
    username: candidato.username,
    email: candidato.email,
    role: candidato.role as Rol,
    nombre: candidato.nombre,
    apellido: candidato.apellido,
    organizacionId: candidato.organizacionId,
    debeCambiarContrasena: candidato.debeCambiarContrasena,
  };
}

/**
 * Lee la sesión del usuario desde la cookie `educoins_sesion`.
 *
 * Es la función que consume el middleware de Next (T5.3.2) para decidir si
 * redirigir al login o al panel del rol. Delgada a propósito: extrae la
 * cookie de la petición y delega la decodificación en {@link decodificarSesion}.
 * Devuelve `null` (no lanza) cuando no hay cookie o su contenido no es una
 * sesión válida.
 *
 * @param request Petición de Next (middleware/servidor; Edge-compatible).
 * @returns La sesión tipada, o `null` si no hay sesión válida.
 */
export function leerSesion(request: NextRequest): Sesion | null {
  const valor = request.cookies.get(NOMBRE_COOKIE_SESION)?.value;

  if (!valor) {
    return null;
  }

  return decodificarSesion(valor);
}
