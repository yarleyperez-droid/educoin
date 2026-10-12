/**
 * Capa de autenticación del frontend EduCoins (T5.4.1).
 *
 * Responsabilidades de esta versión:
 * - Exponer una interfaz estable de login/logout (`iniciarSesion`,
 *   `cerrarSesion`) y el helper de destino por rol (`rutaPorRol`), de modo
 *   que la vista de login **no conozca** usuarios, cookies ni tokens.
 * - Validar credenciales contra el mock de desarrollo {@link USUARIOS_MOCK}
 *   (T5.4.1), con un mensaje de error genérico que evita la enumeración de
 *   usuarios (spec §Contrato con el backend, punto 3).
 * - Escribir la cookie simulada `educoins_sesion` (vía `crearCookieSesion`
 *   de `@/lib/auth`) y el access token simulado (vía `setAccessToken` de
 *   `@/lib/api-client`) para que el middleware (T5.3.2) y las vistas de
 *   panel funcionen sin backend.
 * - T5.4.2 (PRO-379) amplía la capa con {@link cambiarContrasena} (cambio
 *   obligatorio de contraseña, mock alineado a H2.2) y
 *   {@link leerSesionActual} (lectura de la sesión vigente para que las
 *   vistas sigan sin conocer cookies).
 *
 * Responsabilidades que NO incluye (otras tareas):
 * - Integración con la API real: T5.4.3 (PRO-381), bloqueada por H2.1/H2.2.
 * - Refresh real contra `POST auth/refresh` (H2.1; el mock no emite cookie
 *   de refresh).
 *
 * ## Contrato esperado con H2.1/H2.2 (para no cazar bugs después)
 *
 * `POST auth/login` recibe identificador (usuario o correo) + contraseña y
 * responde `{ data: { accessToken, user } }` más una cookie `httpOnly` de
 * refresh. **MOCK temporal: T5.4.3 (PRO-381) reemplaza el interior de estas
 * funciones por `api.post('auth/login', …)` sin cambiar sus firmas.** Si el
 * Swagger de H2.1 publica otra forma, se ajusta solo el mapeo interno hacia
 * `Sesion`; la vista de login y `rutaPorRol` no cambian.
 *
 * ## Esto NO es seguridad
 *
 * El mock y la cookie simulada son un andamio de desarrollo (mismo disclaimer
 * que `lib/auth.ts`): la barrera real la pone el backend (AGENTS.md §9). Las
 * contraseñas de {@link USUARIOS_MOCK} están en texto plano **solo porque es
 * un mock de desarrollo** que desaparece con T5.4.3/H2.1 (AGENTS.md §9.3).
 */

import { ApiError, setAccessToken } from "@/lib/api-client";
import {
  crearCookieSesion,
  decodificarSesion,
  type Rol,
  type Sesion,
} from "@/lib/auth";
import { USUARIOS_MOCK, type UsuarioMock } from "@/features/auth/usuarios-mock";

/**
 * Credenciales de entrada del login.
 *
 * `identificador` admite **usuario o correo** (spec: "Vista de login (usuario
 * o correo)"); la capa decide contra qué campo comparar.
 */
export interface CredencialesLogin {
  /** Usuario o correo electrónico. */
  identificador: string;

  /**
   * Contraseña en texto plano **solo dentro de este mock de desarrollo**.
   *
   * Con H2.1 viajará solo por HTTPS hacia `POST auth/login`; el backend la
   * verifica contra `password_hash` (argon2) y jamás la devuelve (AGENTS.md
   * §9.3). La capa la trata como opaca: no se normaliza ni se recorta.
   */
  contrasena: string;
}

/**
 * Datos del cambio de contraseña (T5.4.2, PRO-379).
 *
 * Misma semántica "opaca" que {@link CredencialesLogin}: las contraseñas viajan
 * en texto plano **solo dentro de este mock de desarrollo** y no se
 * normalizan ni se recortan en la capa.
 */
export interface CambioContrasena {
  /**
   * Contraseña actual del usuario de la sesión vigente.
   *
   * Con H2.2 viajará solo por HTTPS hacia `POST auth/change-password` y el
   * backend la verifica contra `password_hash` (argon2); nunca se devuelve
   * (AGENTS.md §9.3).
   */
  actual: string;

  /** Nueva contraseña (reglas mock: mínimo 8 caracteres y distinta de `actual`). */
  nueva: string;
}

/**
 * Mapa rol → ruta del panel.
 *
 * Coherente con el `PANEL_POR_ROL` del middleware (T5.3.2); duplicado aquí a
 * propósito porque `middleware.ts` no se toca en esta tarea (T5.4.2 lo podrá
 * reutilizar desde esta capa si se decide unificar).
 */
const RUTA_PANEL_POR_ROL: Readonly<Record<Rol, string>> = {
  teacher: "/teacher",
  student: "/student",
  admin: "/admin",
};

/**
 * Nombre de la cookie de sesión simulada.
 *
 * Debe coincidir con `NOMBRE_COOKIE_SESION` de `@/lib/auth` (la constante es
 * privada allí para mantener el middleware Edge-safe; el mismo nombre está
 * literal en `middleware.test.ts`). Con H2.1 se reemplaza por la cookie
 * `httpOnly` real.
 */
const NOMBRE_COOKIE_SESION = "educoins_sesion";

/** Mensaje genérico de credenciales inválidas (evita enumeración de usuarios). */
const MENSAJE_CREDENCIALES_INVALIDAS = "Usuario o contraseña incorrectos.";

/** Mensaje cuando no hay una sesión válida que respalde la operación. */
const MENSAJE_SESION_INVALIDA =
  "No hay una sesión activa. Inicia sesión para continuar.";

/**
 * Mensaje cuando la contraseña actual no coincide con la del usuario.
 *
 * Texto literal exigido por plan §2 de T5.4.2.
 */
const MENSAJE_CONTRASENA_ACTUAL_INCORRECTA =
  "La contraseña actual no es correcta.";

/** Mensaje cuando la nueva contraseña no llega a 8 caracteres (regla mock). */
const MENSAJE_NUEVA_MUY_CORTA =
  "La nueva contraseña debe tener al menos 8 caracteres.";

/** Mensaje cuando la nueva contraseña coincide con la actual (regla mock). */
const MENSAJE_NUEVA_IGUAL_A_ACTUAL =
  "La nueva contraseña debe ser distinta de la actual.";

/**
 * Resuelve el almacén de cookies del navegador, si existe.
 *
 * Vitest corre en entorno `node` (sin DOM), por lo que `document` puede no
 * existir fuera del navegador. En ese caso se devuelve `null` y las
 * escrituras de cookie se omiten con gracia (no se lanza): el token en
 * memoria se setea igual y el mock sigue siendo usable en tests.
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
 * Escribe la cookie de sesión simulada con la sesión indicada.
 *
 * **MOCK temporal: T5.4.3 (PRO-381) desaparece** junto con el resto del
 * mock: con H2.1 la cookie `httpOnly` la setea el backend en la respuesta de
 * `POST auth/login` y el navegador no necesita (ni puede) escribirla desde JS.
 *
 * Usa `crearCookieSesion` de `@/lib/auth` (mismo codificado que espera
 * `leerSesion`, T5.3.3) y `document.cookie` con la semántica de la T5.3.5.
 * Es una función exportada y testeable: los tests la ejercitan con un doble
 * de `document.cookie` (Vitest corre en node, sin DOM). Sin `document` no
 * hace nada (ver {@link obtenerDocumento}).
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
 * Limpia la cookie de sesión simulada (`max-age=0`).
 *
 * **MOCK temporal: T5.4.3 (PRO-381) desaparece** junto con el resto del
 * mock: con H2.1 el logout invoca `POST auth/logout` y el backend expira su
 * cookie `httpOnly`. Exportada y testeable igual que
 * {@link escribirCookieSimulada}.
 */
export function limpiarCookieSimulada(): void {
  const doc = obtenerDocumento();

  if (!doc) {
    return;
  }

  doc.cookie = `${NOMBRE_COOKIE_SESION}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Lee la sesión vigente desde la cookie simulada `educoins_sesion`.
 *
 * Es el punto de lectura de sesión para las **vistas** (T5.4.2): así la
 * vista de cambio de contraseña valida la sesión y muestra al usuario sin
 * conocer cookies ni tokens (mismo criterio de encapsulamiento que
 * `iniciarSesion`).
 *
 * **MOCK temporal: T5.4.3 (PRO-381) reemplaza el interior por la lectura de
 * la sesión real (cookie `httpOnly` + JWT de H2.1) sin cambiar esta firma.**
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
 * Normaliza el identificador y busca el usuario en el mock.
 *
 * Normalización (plan §2): `trim`; si el identificador contiene `@` se
 * compara contra `email`, si no contra `username`. La comparación es
 * insensible a mayúsculas para reflejar el tipo `CITEXT` de la BD
 * (`db/001_schema.sql`), donde ambos campos son únicos sin distinguir
 * mayúsculas.
 *
 * @param identificadorCrudo Identificador tal como lo escribe el usuario.
 * @returns El usuario encontrado, o `null` si no hay coincidencia.
 */
function buscarUsuarioMock(identificadorCrudo: string): UsuarioMock | null {
  const identificador = identificadorCrudo.trim().toLowerCase();

  if (identificador === "") {
    return null;
  }

  const esCorreo = identificador.includes("@");

  return (
    USUARIOS_MOCK.find((usuario) => {
      const candidato = esCorreo ? usuario.email : usuario.username;
      return candidato.toLowerCase() === identificador;
    }) ?? null
  );
}

/**
 * Valida las credenciales y construye la sesión del usuario.
 *
 * **MOCK temporal: T5.4.3 (PRO-381) reemplaza el interior por
 * `api.post('auth/login', …)` sin cambiar esta firma.**
 * Contrato esperado H2.1: `POST auth/login` →
 * `{ data: { accessToken, user } }` + cookie `httpOnly` de refresh.
 *
 * Flujo mock (plan §2):
 * 1. Normaliza el identificador (trim; `@` → email, si no → username) y lo
 *    busca en {@link USUARIOS_MOCK}.
 * 2. Usuario inexistente o contraseña incorrecta → `ApiError` 401 con el
 *    **mismo** mensaje genérico en ambos casos, para no revelar si la cuenta
 *    existe (evita enumeración de usuarios; spec §Contrato, punto 3).
 * 3. Éxito → construye la `Sesion` (incluido `mustChangePassword`, simulando
 *    `users.must_change_password`), escribe la cookie simulada
 *    `educoins_sesion`, setea el token simulado `mock-<userId>` para que
 *    `apiRequest` adjunte `Authorization` en las vistas de panel, y devuelve
 *    la `Sesion`.
 *
 * La contraseña se compara tal cual (sin `trim`): es opaca para la capa.
 *
 * @param cred Identificador (usuario o correo) y contraseña.
 * @returns La sesión del usuario autenticado.
 * @throws {ApiError} 401 con mensaje genérico si las credenciales no valen.
 */
export async function iniciarSesion(cred: CredencialesLogin): Promise<Sesion> {
  const usuario = buscarUsuarioMock(cred.identificador);

  if (!usuario || usuario.contrasena !== cred.contrasena) {
    throw new ApiError(MENSAJE_CREDENCIALES_INVALIDAS, 401);
  }

  const sesion: Sesion = {
    userId: usuario.userId,
    rol: usuario.rol,
    email: usuario.email,
    nombre: usuario.nombre,
    organizationId: usuario.organizationId,
    mustChangePassword: usuario.mustChangePassword,
  };

  escribirCookieSimulada(sesion);
  setAccessToken(`mock-${usuario.userId}`);

  return sesion;
}

/**
 * Cierra la sesión del usuario activo.
 *
 * **MOCK temporal: T5.4.3 (PRO-381) reemplaza el interior por
 * `api.post('auth/logout', …)` (o el endpoint que defina H2.1) sin cambiar
 * esta firma.** Contrato esperado H2.1: el backend expira la cookie
 * `httpOnly` de refresh; aquí solo se limpia el andamio local.
 *
 * Limpia la cookie simulada (`max-age=0`) y el access token en memoria
 * (`setAccessToken(null)`). No lanza: cerrar sesión debe ser siempre
 * posible, aunque la limpieza local ya esté hecha.
 */
export async function cerrarSesion(): Promise<void> {
  limpiarCookieSimulada();
  setAccessToken(null);
}

/**
 * Cambia la contraseña del usuario de la sesión vigente (cambio obligatorio).
 *
 * **MOCK temporal: T5.4.3 (PRO-381) reemplaza el interior por
 * `api.post('auth/change-password', …)` sin cambiar esta firma.**
 * Contrato esperado H2.2: `POST auth/change-password` recibe la contraseña
 * actual y la nueva; el backend verifica la actual contra `password_hash`,
 * aplica sus reglas de seguridad sobre la nueva, la guarda hasheada y pone
 * `users.must_change_password = false`; el frontend refresca la sesión con
 * el flag en `false`. Si el Swagger de H2.2 publica otra forma, se ajusta
 * solo el mapeo interno hacia `Sesion`; esta firma y las vistas no cambian.
 *
 * Flujo mock (plan §2):
 * 1. Lee la sesión vigente ({@link leerSesionActual}); sin sesión válida →
 *    `ApiError` 401.
 * 2. Busca el usuario mock por `userId` en {@link USUARIOS_MOCK}; contraseña
 *    actual incorrecta → `ApiError` 400 "La contraseña actual no es
 *    correcta."
 * 3. Reglas de negocio mock de la nueva contraseña: `nueva.length >= 8` y
 *    `nueva !== actual`; si no se cumplen → `ApiError` 422 con mensaje claro
 *    en español.
 * 4. Éxito: actualiza el usuario mock **en memoria** (contraseña y
 *    `mustChangePassword: false`), reescribe la cookie simulada con el flag
 *    en `false` ({@link escribirCookieSimulada}) y devuelve la `Sesion`
 *    actualizada.
 *
 * **Límite del mock:** el estado de {@link USUARIOS_MOCK} vive solo en la
 * memoria del proceso (dev server o test) y se pierde al recargar: un reload
 * del navegador "olvida" la contraseña cambiada. Aceptable hasta T5.4.3,
 * donde manda la BD (plan §7).
 *
 * Las contraseñas se comparan tal cual (sin `trim`): son opacas para la capa.
 *
 * @param datos Contraseña actual y nueva contraseña.
 * @returns La sesión actualizada, con `mustChangePassword: false`.
 * @throws {ApiError} 401 sin sesión válida; 400 si la contraseña actual no
 * coincide; 422 si la nueva contraseña incumple las reglas mock.
 */
export async function cambiarContrasena(
  datos: CambioContrasena,
): Promise<Sesion> {
  const sesion = leerSesionActual();

  if (!sesion) {
    throw new ApiError(MENSAJE_SESION_INVALIDA, 401);
  }

  const usuario = USUARIOS_MOCK.find(
    (candidato) => candidato.userId === sesion.userId,
  );

  if (!usuario) {
    throw new ApiError(MENSAJE_SESION_INVALIDA, 401);
  }

  if (usuario.contrasena !== datos.actual) {
    throw new ApiError(MENSAJE_CONTRASENA_ACTUAL_INCORRECTA, 400);
  }

  if (datos.nueva.length < 8) {
    throw new ApiError(MENSAJE_NUEVA_MUY_CORTA, 422);
  }

  if (datos.nueva === datos.actual) {
    throw new ApiError(MENSAJE_NUEVA_IGUAL_A_ACTUAL, 422);
  }

  usuario.contrasena = datos.nueva;
  usuario.mustChangePassword = false;

  const sesionActualizada: Sesion = {
    userId: usuario.userId,
    rol: usuario.rol,
    email: usuario.email,
    nombre: usuario.nombre,
    organizationId: usuario.organizationId,
    mustChangePassword: false,
  };

  escribirCookieSimulada(sesionActualizada);

  return sesionActualizada;
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
