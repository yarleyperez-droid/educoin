/**
 * Capa de autenticación del frontend EduCoins (T5.4.1, integrada con la API
 * real de H2.1 en T5.4.3 / PRO-381).
 *
 * Responsabilidades de esta versión:
 * - Exponer una interfaz estable de login/logout (`iniciarSesion`,
 *   `cerrarSesion`) y el helper de destino por rol (`rutaPorRol`), de modo
 *   que la vista de login **no conozca** cookies ni tokens.
 * - `iniciarSesion` habla con **`POST auth/login` real** (H2.1, prefijo
 *   `/api/v1`): envía `{ usuarioOEmail, contrasena }`, guarda el access
 *   token en memoria (`setAccessToken`) y escribe la cookie legible
 *   `educoins_sesion` con los claims no sensibles de la sesión para que el
 *   middleware (T5.3.2) y las vistas puedan leerla.
 * - `cerrarSesion` invoca **`POST auth/logout` real** (204) y limpia el
 *   estado local (cookie + token en memoria), siempre sin lanzar.
 * - `cambiarContrasena` (T5.4.2 / H2.2) habla con **`POST
 *   auth/cambiar-contrasena` real** (204) y luego refresca la sesión
 *   (`POST auth/refresh`) para que el access token y la cookie legible
 *   salgan con `debeCambiarContrasena: false`; ver su docstring.
 * - `leerSesionActual` lee la sesión vigente desde la cookie para que las
 *   vistas sigan sin conocer cookies ni tokens.
 *
 * ## Contrato con H2.1 (verificado en `main`)
 *
 * `POST /api/v1/auth/login` recibe `{ usuarioOEmail, contrasena }` y
 * responde `201` con `{ accessToken, tipoToken, expiraEn, usuario }` más una
 * cookie `httpOnly` de refresh (`refresh_token`, `Path=/api/v1/auth`). El
 * `usuario` es `UsuarioRespuestaDto`: `{ id, username, email, role, nombre,
 * apellido, organizacionId, debeCambiarContrasena }`. Credenciales
 * inválidas → `401` con el mensaje único `"El usuario o la contraseña son
 * erróneos."` (el cliente lo muestra tal cual; `apiRequest` no intenta
 * refrescar en el 401 de `auth/login`).
 *
 * `POST /api/v1/auth/logout` responde `204` y expira la cookie de refresh.
 *
 * ## Por qué la cookie `educoins_sesion` sigue existiendo
 *
 * La cookie de refresh es `httpOnly` con `Path=/api/v1/auth`, así que el
 * middleware de Next (Edge) **no puede** leerla en las rutas de panel. La
 * sesión para el middleware viaja por `educoins_sesion` (legible, escrita
 * aquí tras el login real) con claims no sensibles y **sin tokens**. No es
 * seguridad (ver docstrings de `lib/auth.ts`): la validación real la hace el
 * backend en cada petición.
 */

import { ApiError, api, setAccessToken } from "@/lib/api-client";
import {
  crearCookieSesion,
  decodificarSesion,
  type Rol,
  type Sesion,
} from "@/lib/auth";

/**
 * Credenciales de entrada del login.
 *
 * `usuarioOEmail` admite **usuario o correo** (CITEXT en la BD, la
 * comparación es insensible a mayúsculas); el backend decide contra qué
 * campo buscar. Es el nombre exacto del DTO `IniciarSesionDto` de H2.1.
 */
export interface CredencialesLogin {
  /** Usuario o correo electrónico. */
  usuarioOEmail: string;

  /**
   * Contraseña en texto plano: viaja solo por HTTPS hacia `POST auth/login`;
   * el backend la verifica contra `password_hash` (argon2) y jamás la
   * devuelve (AGENTS.md §9.3). La capa la trata como opaca: no se normaliza
   * ni se recorta.
   */
  contrasena: string;
}

/**
 * Datos del cambio de contraseña (T5.4.2 / H2.2).
 *
 * Viajan en texto plano solo dentro de esta capa (HTTPS hacia `POST
 * auth/cambiar-contrasena`); no se normalizan ni se recortan.
 */
export interface CambioContrasena {
  /**
   * Contraseña actual del usuario de la sesión vigente.
   *
   * El backend la verifica contra `password_hash` (argon2) y jamás la
   * devuelve (AGENTS.md §9.3).
   */
  actual: string;

  /** Nueva contraseña (reglas de UX: mínimo 8 caracteres y distinta de `actual`). */
  nueva: string;
}

/**
 * `UsuarioRespuestaDto` de H2.1 tal como llega en el cuerpo del login.
 *
 * Espejo de `src/modules/auth/dto/sesion-respuesta.dto.ts` (sin
 * `password_hash` ni `last_login`, que el backend nunca envía).
 */
interface UsuarioBackend {
  id: string;
  username: string;
  email: string;
  role: Rol;
  nombre: string;
  apellido: string;
  organizacionId: string | null;
  debeCambiarContrasena: boolean;
}

/**
 * Cuerpo del `201` de `POST auth/login` y `POST auth/refresh` (H2.1).
 *
 * El refresh token NUNCA va en el cuerpo: viaja en la cookie `httpOnly`.
 */
interface SesionBackend {
  accessToken: string;
  tipoToken: "Bearer";
  expiraEn: string;
  usuario: UsuarioBackend;
}

/**
 * Mapa rol → ruta del panel.
 *
 * Coherente con el `PANEL_POR_ROL` del middleware (T5.3.2); duplicado aquí a
 * propósito porque `middleware.ts` no se toca en esta capa.
 */
const RUTA_PANEL_POR_ROL: Readonly<Record<Rol, string>> = {
  teacher: "/teacher",
  student: "/student",
  admin: "/admin",
};

/**
 * Nombre de la cookie de sesión legible por el middleware.
 *
 * Debe coincidir con `NOMBRE_COOKIE_SESION` de `@/lib/auth` (la constante es
 * privada allí para mantener el middleware Edge-safe; el mismo nombre está
 * literal en `middleware.test.ts`). La cookie `httpOnly` de refresh la gestiona
 * el backend y tiene otro nombre y otro `Path`.
 */
const NOMBRE_COOKIE_SESION = "educoins_sesion";

/** Mensaje cuando no hay una sesión válida que respalde la operación. */
const MENSAJE_SESION_INVALIDA =
  "No hay una sesión activa. Inicia sesión para continuar.";

/**
 * Mensaje cuando la contraseña actual no llega (guarda defensiva de UX).
 *
 * Texto literal exigido por plan §2 de T5.4.2. Con H2.2 el backend será el
 * que verifique la contraseña real.
 */
const MENSAJE_CONTRASENA_ACTUAL_INCORRECTA =
  "La contraseña actual no es correcta.";

/** Mensaje cuando la nueva contraseña no llega a 8 caracteres (regla de UX). */
const MENSAJE_NUEVA_MUY_CORTA =
  "La nueva contraseña debe tener al menos 8 caracteres.";

/** Mensaje cuando la nueva contraseña coincide con la actual (regla de UX). */
const MENSAJE_NUEVA_IGUAL_A_ACTUAL =
  "La nueva contraseña debe ser distinta de la actual.";

/**
 * Resuelve el almacén de cookies del navegador, si existe.
 *
 * Vitest corre en entorno `node` (sin DOM), por lo que `document` puede no
 * existir fuera del navegador. En ese caso se devuelve `null` y las
 * escrituras de cookie se omiten con gracia (no se lanza): el token en
 * memoria se setea igual y la capa sigue siendo usable en tests.
 *
 * @returns `document` en el navegador, o `null` fuera de él.
 */
function obtenerDocumento(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Extrae el valor de una cookie de una cadena tipo `document.cookie`.
 *
 * Reproduce la semántica de navegador: las cookies se listan como
 * `nombre=valor` separadas por `;`, y **la última asignación gana** (el doble
 * de `document.cookie` de los tests, a diferencia de un navegador real,
 * conserva el historial de escrituras; por eso se recorren todas y se queda
 * con la última coincidencia). El valor se parte en el **primer** `=` porque
 * el codificado base64 de {@link crearCookieSesion} puede contener `=`.
 *
 * @param cadenaCookies Cadena de cookies (p. ej. `document.cookie`).
 * @param nombre Nombre de la cookie buscada.
 * @returns El valor de la cookie, o `null` si no está presente.
 */
function extraerValorCookie(
  cadenaCookies: string,
  nombre: string,
): string | null {
  let valor: string | null = null;

  for (const parte of cadenaCookies.split(";")) {
    const par = parte.trim();
    const indiceIgual = par.indexOf("=");

    if (indiceIgual === -1) {
      continue;
    }

    if (par.slice(0, indiceIgual) === nombre) {
      valor = par.slice(indiceIgual + 1);
    }
  }

  return valor;
}

/**
 * Escribe la cookie de sesión legible con la sesión indicada.
 *
 * Se llama tras un login real (o tras un cambio de contraseña exitoso) y
 * guarda **solo claims no sensibles** (sin tokens): es lo que el middleware
 * de Next lee en las rutas de panel. Usa `crearCookieSesion` de `@/lib/auth`
 * (mismo codificado que espera `leerSesion`, T5.3.3) y `document.cookie` con
 * la semántica de la T5.3.5. Es una función exportada y testeable: los tests
 * la ejercitan con un doble de `document.cookie` (Vitest corre en node, sin
 * DOM). Sin `document` no hace nada (ver {@link obtenerDocumento}).
 *
 * @param sesion Sesión a codificar en la cookie.
 */
export function escribirCookieSimulada(sesion: Sesion): void {
  const doc = obtenerDocumento();

  if (!doc) {
    return;
  }

  doc.cookie = `${NOMBRE_COOKIE_SESION}=${crearCookieSesion(sesion)}; path=/; SameSite=Lax`;
}

/**
 * Limpia la cookie de sesión legible (`max-age=0`).
 *
 * Se llama en el logout (junto con `setAccessToken(null)`). Exportada y
 * testeable igual que {@link escribirCookieSimulada}.
 */
export function limpiarCookieSimulada(): void {
  const doc = obtenerDocumento();

  if (!doc) {
    return;
  }

  doc.cookie = `${NOMBRE_COOKIE_SESION}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Lee la sesión vigente desde la cookie de sesión legible `educoins_sesion`.
 *
 * Es el punto de lectura de sesión para las **vistas** (T5.4.2): así la
 * vista de cambio de contraseña valida la sesión y muestra al usuario sin
 * conocer cookies ni tokens (mismo criterio de encapsulamiento que
 * `iniciarSesion`).
 *
 * Misma técnica testeable que {@link escribirCookieSimulada}: se lee
 * `document.cookie` vía {@link obtenerDocumento} (Vitest corre en node, sin
 * DOM; los tests doblan `document`) y se extrae el valor de la cookie. Sin
 * `document` o sin cookie válida devuelve `null` (no lanza).
 *
 * La decodificación del valor la hace `decodificarSesion` de `@/lib/auth`
 * (sin duplicar lógica). **No se construye un `NextRequest` aquí**: en
 * navegador la Fetch API descarta en silencio la cabecera `cookie` al crear
 * un `Request` (*forbidden request header*), así que `request.cookies.get()`
 * nunca devolvía la sesión y la vista de cambio de contraseña quedaba
 * atascada en "Cargando…" (bug real detectado con los E2E de T5.4.4).
 *
 * @returns La sesión vigente, o `null` si no hay cookie válida.
 */
export function leerSesionActual(): Sesion | null {
  const doc = obtenerDocumento();

  if (!doc) {
    return null;
  }

  const valor = extraerValorCookie(doc.cookie, NOMBRE_COOKIE_SESION);

  if (valor === null) {
    return null;
  }

  return decodificarSesion(valor);
}

/**
 * Mapea el `usuario` de la respuesta del backend a la {@link Sesion} del
 * frontend.
 *
 * Hoy el shape es idéntico (el tipo `Sesion` espejea `UsuarioRespuestaDto`,
 * T5.4.3); la función existe como **único punto de traducción** por si el
 * Swagger de H2.x cambia la forma del payload, sin tocar las vistas.
 *
 * @param usuario Usuario devuelto por `POST auth/login`.
 * @returns La sesión del frontend lista para la cookie y las vistas.
 */
function aSesion(usuario: UsuarioBackend): Sesion {
  return {
    id: usuario.id,
    username: usuario.username,
    email: usuario.email,
    role: usuario.role,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    organizacionId: usuario.organizacionId,
    debeCambiarContrasena: usuario.debeCambiarContrasena,
  };
}

/**
 * Inicia sesión contra la API real de H2.1 (`POST auth/login`).
 *
 * Flujo (T5.4.3):
 * 1. Envía `{ usuarioOEmail, contrasena }` (con `trim` del identificador,
 *    igual que validaba la vista) vía `api.post`, que adjunta
 *    `credentials: "include"` para que el navegador guarde la cookie
 *    `httpOnly` de refresh que setea el backend.
 * 2. Éxito (`201`): setea el access token en memoria
 *    ({@link setAccessToken}), escribe la cookie legible `educoins_sesion`
 *    con los claims no sensibles de {@link aSesion} y devuelve la sesión.
 * 3. Credenciales inválidas (`401`): `apiRequest` **no** intenta refrescar
 *    (excluye `auth/login`) y propaga el `ApiError` con el mensaje real del
 *    backend ("El usuario o la contraseña son erróneos.").
 *
 * @param cred Usuario o correo y contraseña.
 * @returns La sesión del usuario autenticado.
 * @throws {ApiError} 401 con el mensaje del backend si las credenciales no
 *   valen; otros errores HTTP según el backend.
 */
export async function iniciarSesion(cred: CredencialesLogin): Promise<Sesion> {
  const respuesta = await api.post<SesionBackend>("auth/login", {
    usuarioOEmail: cred.usuarioOEmail.trim(),
    contrasena: cred.contrasena,
  });

  const sesion = aSesion(respuesta.data.usuario);

  setAccessToken(respuesta.data.accessToken);
  escribirCookieSimulada(sesion);

  return sesion;
}

/**
 * Cierra la sesión del usuario activo.
 *
 * Invoca `POST auth/logout` real (H2.1 → `204`, expira la cookie `httpOnly`
 * de refresh en el navegador) y **siempre** limpia el estado local: la cookie
 * de sesión legible ({@link limpiarCookieSimulada}) y el access token en
 * memoria (`setAccessToken(null)`).
 *
 * No lanza: cerrar sesión debe ser siempre posible, aunque el backend falle
 * o ya no haya sesión (la limpieza local se hace igualmente).
 */
export async function cerrarSesion(): Promise<void> {
  try {
    await api.post<null>("auth/logout", undefined);
  } catch {
    // El logout es best-effort: sin backend (o sin sesión) basta con limpiar
    // el estado local para que el usuario quede deslogueado en la UI.
  }

  limpiarCookieSimulada();
  setAccessToken(null);
}

/**
 * Refresca la sesión tras un cambio de contraseña exitoso (`204`).
 *
 * El access token en memoria y la cookie legible aún traen
 * `debeCambiarContrasena: true` (el flag se firma al hacer login): sin un
 * `POST auth/refresh` el guard del backend seguiría bloqueando todo el panel
 * ("Debes cambiar tu contraseña inicial antes de continuar.") y el middleware
 * seguiría devolviendo a `/cambiar-contrasena`. El refresh canjea la cookie
 * `httpOnly` por un access token nuevo firmado con
 * `must_change_password = false` (ya leído de la BD) y devuelve el
 * `usuario` fresco, con el que se reescribe la cookie legible.
 *
 * Si el refresh falla (red caída o cookie de refresh vencida), el cambio en
 * la BD **sí** quedó hecho, así que de todos modos se marca la cookie local
 * con `debeCambiarContrasena: false` (para no dejar al usuario atascado en
 * `/cambiar-contrasena`) y se limpia el access token en memoria: la
 * siguiente petición del panel reintentará el refresh y, si tampoco llega,
 * la vista mostrará el error y podrá volver a entrar con la contraseña nueva.
 *
 * @param sesionPrevia Sesión leída antes del cambio (respaldo local).
 * @returns La sesión vigente con `debeCambiarContrasena: false`.
 */
async function refrescarSesionTrasCambio(
  sesionPrevia: Sesion,
): Promise<Sesion> {
  try {
    const refresco = await api.post<SesionBackend>("auth/refresh", undefined);
    const sesionActualizada = aSesion(refresco.data.usuario);

    setAccessToken(refresco.data.accessToken);
    escribirCookieSimulada(sesionActualizada);

    return sesionActualizada;
  } catch {
    const sesionLocal: Sesion = {
      ...sesionPrevia,
      debeCambiarContrasena: false,
    };

    escribirCookieSimulada(sesionLocal);
    setAccessToken(null);

    return sesionLocal;
  }
}

/**
 * Cambia la contraseña del usuario de la sesión vigente (cambio obligatorio).
 *
 * **H2.2 real:** `POST auth/cambiar-contrasena` (204 sin cuerpo) recibe
 * `{ contrasenaActual, contrasenaNueva }`; el backend verifica la actual
 * contra `password_hash` (argon2), guarda la nueva hasheada y pone
 * `users.must_change_password = false`. Acto seguido la sesión se refresca
 * con {@link refrescarSesionTrasCambio} para que el access token y la cookie
 * legible salgan con el flag en `false` (si no, el `JwtAuthGuard` seguiría
 * bloqueando el panel).
 *
 * Flujo:
 * 1. Lee la sesión vigente ({@link leerSesionActual}); sin sesión válida →
 *    `ApiError` 401.
 * 2. Guardas de UX previas (la vista ya las valida; aquí son defensivas):
 *    contraseña actual vacía → `ApiError` 400; `nueva.length < 8` o
 *    `nueva === actual` → `ApiError` 422 con mensaje en español. El backend
 *    también valida (`MinLength(8)`, hasta 128), pero estas guardas evitan
 *    la ida y vuelta con mensajes genéricos.
 * 3. `POST auth/cambiar-contrasena`. Un `401` del backend (p. ej. "La
 *    contraseña actual es incorrecta." o sesión vencida) se propaga como
 *    `ApiError` con su mensaje; un `401` por token vencido dispara el refresh
 *    normal de `api-client` y la petición se reintenta una sola vez.
 * 4. Éxito → refresh de sesión y cookie legible con
 *    `debeCambiarContrasena: false`.
 *
 * @param datos Contraseña actual y nueva contraseña.
 * @returns La sesión actualizada, con `debeCambiarContrasena: false`.
 * @throws {ApiError} 401 sin sesión válida o con credenciales rechazadas por
 *   el backend; 400 si falta la contraseña actual; 422 si la nueva
 *   contraseña incumple las reglas de UX.
 */
export async function cambiarContrasena(
  datos: CambioContrasena,
): Promise<Sesion> {
  const sesion = leerSesionActual();

  if (!sesion) {
    throw new ApiError(MENSAJE_SESION_INVALIDA, 401);
  }

  if (datos.actual === "") {
    throw new ApiError(MENSAJE_CONTRASENA_ACTUAL_INCORRECTA, 400);
  }

  if (datos.nueva.length < 8) {
    throw new ApiError(MENSAJE_NUEVA_MUY_CORTA, 422);
  }

  if (datos.nueva === datos.actual) {
    throw new ApiError(MENSAJE_NUEVA_IGUAL_A_ACTUAL, 422);
  }

  await api.post<null>("auth/cambiar-contrasena", {
    contrasenaActual: datos.actual,
    contrasenaNueva: datos.nueva,
  });

  return refrescarSesionTrasCambio(sesion);
}

/**
 * Devuelve la ruta del panel correspondiente a un rol.
 *
 * Helper reutilizable por la vista de login (T5.4.1) y por T5.4.2
 * (PRO-379), para que la redirección post-login viva en un solo lugar y no
 * se ramifique en cada vista.
 *
 * @param rol Rol de la sesión autenticada.
 * @returns Ruta absoluta del panel: `/teacher`, `/student` o `/admin`.
 */
export function rutaPorRol(rol: Rol): string {
  return RUTA_PANEL_POR_ROL[rol];
}
