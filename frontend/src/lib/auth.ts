/**
 * Capa de lectura de sesión del frontend EduCoins (T5.3.3).
 *
 * Esta capa es la **única fuente de verdad de la sesión** para el middleware
 * de Next (T5.3.2) y para cualquier vista que necesite conocer al usuario
 * autenticado. Hoy lee una **sesión simulada** en la cookie `educoins_sesion`
 * para poder desarrollar el frontend sin backend.
 *
 * ## Contrato con el backend (qué cambiará con H2.1)
 *
 * Cuando H2.1 entregue la sesión real, se cambia **solo el interior** de
 * {@link leerSesion}:
 * - El nombre de la cookie pasará de la simulada a la cookie `httpOnly` real
 *   que setee el backend (constante {@link NOMBRE_COOKIE_SESION}).
 * - El cuerpo se decodificará como JWT (con una librería Edge-compatible,
 *   p. ej. `jose`) en vez de JSON base64 sin firmar.
 *
 * **Las vistas y el middleware NO cambian**: consumen {@link Sesion} y
 * {@link leerSesion}, no el formato crudo de la cookie. Ese es el criterio
 * de aceptación 3 de H5.3.
 *
 * ## Esto NO es seguridad
 *
 * La cookie simulada la puede escribir cualquiera desde DevTools: no está
 * firmada ni firmada. Es solo un andamio de desarrollo. La barrera real de
 * seguridad es el backend (criterio de aceptación 4 de H5.3): el rol
 * validado en el frontend **nunca** sustituye la validación del servidor.
 *
 * Compatible con **Edge runtime** (el middleware de Next corre en Edge):
 * sin `fs`, sin `Buffer`, sin `process.env` fuera de `NEXT_PUBLIC_*`.
 */

import type { NextRequest } from "next/server";

/**
 * Roles de usuario del MVP.
 *
 * Coherentes con `AGENTS.md §8` (tabla única `users` con columna `role`) y
 * con `docs/contexto_mvp.md` (3 roles: admin global, teacher y student en
 * una organización).
 */
export type Rol = "admin" | "teacher" | "student";

/**
 * Sesión del usuario autenticado, tal como la consume el frontend.
 *
 * **Supuesto de contrato:** la forma se basa en `AGENTS.md §8` (el login
 * devuelve el usuario con su `role`) y en el esquema BD (`users.organization_id`).
 * Cuando H1.3 publique el Swagger real, si la forma difiere, se ajusta **solo
 * este tipo y el mapeo dentro de {@link leerSesion}** — las vistas importan
 * `Sesion` de `@/lib/auth`, no el JSON crudo de la cookie.
 *
 * Los IDs se manejan como `string` aunque en la BD sean `bigint`, para
 * evitar pérdida de precisión de Number en JavaScript (convención de
 * `AGENTS.md §8`).
 */
export interface Sesion {
  /** ID del usuario. */
  userId: string;

  /** Rol del usuario. */
  rol: Rol;

  /** Correo electrónico. */
  email: string;

  /** Nombre completo. */
  nombre: string;

  /** ID de la organización a la que pertenece (string por `bigint` de BD). */
  organizationId: string;
}

/**
 * Nombre de la cookie de sesión.
 *
 * **Simulada (hoy):** cookie normal escrita por el frontend en dev/testing;
 * no la setea el backend, no está firmada.
 *
 * **Real (H2.1):** se reemplazará por el nombre de la cookie `httpOnly` que
 * el backend emita al hacer login. El cambio es solo esta constante y el
 * interior de {@link leerSesion}.
 */
const NOMBRE_COOKIE_SESION = "educoins_sesion";

/** Conjunto de roles válidos, para validar el rol leído de la cookie. */
const ROLES_VALIDOS: ReadonlySet<string> = new Set<Rol>([
  "admin",
  "teacher",
  "student",
]);

/**
 * Codifica una sesión en el valor de cookie simulado (Unicode-safe).
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
 * Lee la sesión del usuario desde la cookie simulada.
 *
 * Es la función que consumirá el middleware de Next (T5.3.2) para decidir si
 * redirigir al login o al panel del rol. Con H2.1 se cambia su interior para
 * decodificar la cookie `httpOnly` real; la firma no cambia.
 *
 * Devuelve `null` (no lanza) cuando:
 * - no hay cookie;
 * - la cookie no es base64 válido o su JSON no es un objeto;
 * - falta algún campo obligatorio;
 * - el rol no está en {@link Rol}.
 *
 * @param request Petición de Next (middleware/servidor; Edge-compatible).
 * @returns La sesión tipada, o `null` si no hay sesión válida.
 */
export function leerSesion(request: NextRequest): Sesion | null {
  const valor = request.cookies.get(NOMBRE_COOKIE_SESION)?.value;

  if (!valor) {
    return null;
  }

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
    typeof candidato.userId !== "string" ||
    typeof candidato.rol !== "string" ||
    !ROLES_VALIDOS.has(candidato.rol) ||
    typeof candidato.email !== "string" ||
    typeof candidato.nombre !== "string" ||
    typeof candidato.organizationId !== "string"
  ) {
    return null;
  }

  return {
    userId: candidato.userId,
    rol: candidato.rol as Rol,
    email: candidato.email,
    nombre: candidato.nombre,
    organizationId: candidato.organizationId,
  };
}
