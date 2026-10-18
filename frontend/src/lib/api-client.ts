/**
 * Cliente HTTP único del frontend EduCoins.
 *
 * Responsabilidades de esta versión (T5.1.1 + T5.1.2 + T5.1.3 + T5.4.3 +
 * T5.6.4):
 * - Centralizar la base URL en `process.env.NEXT_PUBLIC_API_URL`.
 * - Tipar las respuestas con el contrato `{ data, meta }` (con las excepciones
 *   documentadas de `auth/*`, que H2.1 devuelve en plano, del `204` sin
 *   cuerpo, y de los endpoints unitarios de H3.1/H3.3, cuyo DTO sale en
 *   plano — ver {@link apiRequestPlano}).
 * - Evitar que vistas usen `fetch` con URLs escritas a mano.
 * - Guardar el access token en memoria y adjuntarlo como `Authorization: Bearer`.
 * - Refrescar el token en `401` con cola de peticiones concurrentes, sin
 *   bucle infinito (sin intentarlo en `auth/login` ni en `auth/refresh`).
 * - Traducir errores HTTP a mensajes de UI en español (409/422 y el resto).
 *
 * Responsabilidades que NO incluye (otras tareas):
 * - Pruebas con mocks (T5.1.4).
 * - Componente de toast / estados de UI (H5.2).
 */

/**
 * Metadatos de paginación devueltos por la API en listados.
 *
 * @see AGENTS.md §8: paginación estándar `?page=1&limit=20`.
 */
export interface ApiMeta {
  /** Total de elementos disponibles en el servidor. */
  total: number;

  /** Página actual solicitada. */
  page: number;

  /** Cantidad de elementos por página. */
  limit: number;
}

/**
 * Envoltorio estándar de respuestas de la API.
 *
 * `meta` es opcional porque, según el contrato documentado en AGENTS.md §8,
 * solo los listados paginados devuelven `{ total, page, limit }`. Las
 * respuestas unitarias (crear, actualizar, eliminar) pueden devolver solo
 * `{ data }`.
 */
export interface ApiEnvelope<T> {
  /** Cuerpo principal de la respuesta. */
  data: T;

  /** Metadatos de paginación, presentes en listados. */
  meta?: ApiMeta;
}

/**
 * Error lanzado por {@link apiRequest} cuando la API responde con un código
 * HTTP no exitoso o cuando falla la comunicación de red.
 *
 * `message` siempre contiene el texto listo para mostrar al usuario en la UI
 * (en español). `status` y `detalles` quedan para logs y depuración; las
 * vistas no deben ramificar por código HTTP, solo mostrar `error.message`.
 */
export class ApiError extends Error {
  /** Código HTTP de la respuesta; `0` para errores de red o abort. */
  readonly status: number;

  /** Cuerpo crudo de la respuesta, sin interpretar. */
  readonly detalles: unknown;

  constructor(mensaje: string, status: number, detalles: unknown = null) {
    super(mensaje);
    this.name = "ApiError";
    this.status = status;
    this.detalles = detalles;
  }
}

/**
 * Mensajes genéricos de UI en español, usados cuando el backend no envía un
 * `message` legible en el cuerpo del error.
 *
 * La clave es el código HTTP; el valor es el texto que ve el usuario.
 */
const MENSAJES_UI_POR_STATUS: Readonly<Record<number, string>> = {
  400: "Los datos enviados no son válidos.",
  401: "Tu sesión ha expirado. Inicia sesión de nuevo.",
  403: "No tienes permisos para realizar esta acción.",
  404: "No se encontró el recurso solicitado.",
  409: "La operación entra en conflicto con el estado actual.",
  422: "No se pudo procesar la solicitud con los datos proporcionados.",
  500: "Error interno del servidor. Intenta de nuevo más tarde.",
};

/** Mensaje genérico para códigos no contemplados en {@link MENSAJES_UI_POR_STATUS}. */
const MENSAJE_UI_GENERICO = "Ocurrió un error inesperado.";

/**
 * Extrae el mensaje legible que el backend envía en el cuerpo del error.
 *
 * Asume el formato estándar de NestJS `{ statusCode, message, error }`, donde
 * `message` puede ser `string` o `string[]`. Si el Swagger de H1.3 define otra
 * forma, se ajusta aquí (único punto).
 *
 * @param cuerpo Cuerpo crudo de la respuesta de error.
 * @returns El mensaje legible, o `null` si el cuerpo no lo trae.
 */
function extraerMensajeBackend(cuerpo: unknown): string | null {
  if (typeof cuerpo !== "object" || cuerpo === null) {
    return null;
  }

  const mensaje = (cuerpo as { message?: unknown }).message;

  if (typeof mensaje === "string" && mensaje.trim() !== "") {
    return mensaje;
  }

  if (Array.isArray(mensaje) && mensaje.length > 0) {
    const primero = mensaje[0];
    if (typeof primero === "string" && primero.trim() !== "") {
      return primero;
    }
  }

  return null;
}

/**
 * Devuelve un mensaje de UI legible en español para un error HTTP.
 *
 * Prioriza el `message` del cuerpo del backend (los `RAISE EXCEPTION` de la BD
 * ya son en español); si no hay, usa un fallback genérico según el código.
 *
 * @param status Código HTTP de la respuesta.
 * @param cuerpo Cuerpo crudo de la respuesta de error.
 * @returns Texto listo para mostrar al usuario.
 */
function mensajeUI(status: number, cuerpo: unknown): string {
  return extraerMensajeBackend(cuerpo) ?? MENSAJES_UI_POR_STATUS[status] ?? MENSAJE_UI_GENERICO;
}

/**
 * Access token JWT en memoria.
 *
 * Se pierde al recargar la página; la cookie `httpOnly` de refresh persiste,
 * por lo que el flujo de sesión (H2.1 / T5.4) puede llamar a `auth/refresh`
 * al arrancar para restaurar la sesión.
 */
let accessToken: string | null = null;

/**
 * Promesa del refresh en curso, compartida por todas las peticiones
 * concurrentes que reciban `401`.
 *
 * `null` cuando no hay refresh activo.
 */
let refreshPromise: Promise<boolean> | null = null;

/**
 * Guarda o limpia el access token en memoria.
 *
 * Lo llama el flujo de login (T5.4.x / H2.1) tras recibir el token, y el
 * logout para limpiar la sesión.
 *
 * @param token Nuevo access token, o `null` para limpiar la sesión.
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Devuelve el access token actual en memoria.
 *
 * @returns El token JWT, o `null` si no hay sesión activa.
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Indica si un valor tiene la forma mínima de una envoltura de API.
 *
 * Es una guarda interna; no se exporta porque el formato exacto lo controla
 * el backend (Swagger H1.3, aún no disponible).
 */
function esEnvelopeValido(valor: unknown): valor is ApiEnvelope<unknown> {
  return typeof valor === "object" && valor !== null && "data" in valor;
}

/**
 * Construye la URL absoluta de un recurso a partir de la variable de entorno
 * `NEXT_PUBLIC_API_URL`.
 *
 * @param ruta Ruta relativa del recurso, sin barra inicial (p. ej. `"classes"`).
 * @returns URL lista para pasar a `fetch`.
 * @throws {ApiError} Si falta la variable de entorno o la URL resultante no es válida.
 */
function construirUrl(ruta: string): URL {
  const base = process.env.NEXT_PUBLIC_API_URL;

  if (!base) {
    throw new ApiError(
      "Falta la variable de entorno NEXT_PUBLIC_API_URL. Verifica frontend/.env.local",
      0,
      null,
    );
  }

  const rutaLimpia = ruta.replace(/^\/+/, "");
  const baseConBarra = base.endsWith("/") ? base : `${base}/`;

  try {
    return new URL(rutaLimpia, baseConBarra);
  } catch (error) {
    const causa = error instanceof Error ? error.message : "URL inválida";
    throw new ApiError(
      `No se pudo construir la URL de la API: ${causa}`,
      0,
      { base, ruta },
    );
  }
}

/**
 * Refresca el access token llamando a `POST auth/refresh`.
 *
 * Usa `fetch` directamente (sin `apiRequest`) para evitar recursión. La
 * cookie `httpOnly` del refresh token se envía automáticamente por
 * `credentials: "include"`.
 *
 * Contrato real de H2.1: la respuesta es **plana** (sin envoltura
 * `{ data, meta }`): `{ accessToken, tipoToken, expiraEn, usuario }`, el
 * mismo shape que el login.
 *
 * Si ya hay un refresh en curso, reutiliza la promesa existente: todas las
 * peticiones concurrentes esperan el mismo resultado y luego reintantan con
 * el token nuevo.
 *
 * @returns `true` si se obtuvo un nuevo token; `false` si el refresh falló
 *   (en cuyo caso se limpia el access token en memoria).
 */
async function refrescarToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const respuesta = await fetch(construirUrl("auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!respuesta.ok) {
        setAccessToken(null);
        return false;
      }

      let cuerpo: unknown;

      try {
        const texto = await respuesta.text();
        cuerpo = texto ? (JSON.parse(texto) as unknown) : null;
      } catch {
        cuerpo = null;
      }

      if (
        typeof cuerpo !== "object" ||
        cuerpo === null ||
        !("accessToken" in cuerpo) ||
        typeof (cuerpo as { accessToken: unknown }).accessToken !== "string"
      ) {
        setAccessToken(null);
        return false;
      }

      setAccessToken((cuerpo as { accessToken: string }).accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Resultado crudo de una petición HTTP ya ejecutada (transporte resuelto).
 *
 * `cuerpo` es el JSON parseado de la respuesta, o `null` si la respuesta
 * venía vacía (p. ej. `204`). La interpretación del cuerpo (envelope
 * `{ data, meta }` vs. DTO en plano) corresponde a {@link apiRequest} y
 * {@link apiRequestPlano}, no a esta capa.
 */
interface RespuestaHttp {
  /** Código HTTP de la respuesta. */
  status: number;

  /** Cuerpo JSON parseado, o `null` si no había cuerpo. */
  cuerpo: unknown;
}

/**
 * Ejecuta el transporte HTTP compartido por {@link apiRequest} y
 * {@link apiRequestPlano}.
 *
 * Concentra lo común a ambas formas de respuesta: construir headers,
 * llamar a `fetch`, parsear el cuerpo, el `204` sin contenido, el
 * refresh en `401` (con cola y un único reintento) y la traducción de
 * errores HTTP a {@link ApiError}. Lo único que no hace es interpretar
 * el cuerpo de éxito.
 *
 * @param ruta Ruta relativa del recurso (p. ej. `"classes"`).
 * @param init Opciones adicionales de `fetch`.
 * @param reintentado Marcador interno: `true` cuando la petición ya fue
 *   reintentada tras un refresh; evita bucles infinitos.
 * @returns Status y cuerpo crudo de la respuesta.
 * @throws {ApiError} Si falla la red o la API responde con código no 2xx.
 */
async function ejecutarPeticion(
  ruta: string,
  init?: RequestInit,
  reintentado = false,
): Promise<RespuestaHttp> {
  const headersFinales = new Headers(init?.headers);

  if (accessToken && !headersFinales.has("Authorization")) {
    headersFinales.set("Authorization", `Bearer ${accessToken}`);
  }

  if (!headersFinales.has("Accept")) {
    headersFinales.set("Accept", "application/json");
  }

  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headersFinales.has("Content-Type")
  ) {
    headersFinales.set("Content-Type", "application/json");
  }

  let respuesta: Response;

  try {
    respuesta = await fetch(construirUrl(ruta), {
      ...init,
      credentials: "include",
      headers: headersFinales,
    });
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : "Error de conexión con la API";
    throw new ApiError(mensaje, 0, error);
  }

  let cuerpo: unknown;

  try {
    const texto = await respuesta.text();
    cuerpo = texto ? (JSON.parse(texto) as unknown) : null;
  } catch {
    cuerpo = null;
  }

  // 204 No Content (p. ej. `POST auth/logout`): no hay cuerpo que interpretar.
  if (respuesta.status === 204) {
    return { status: 204, cuerpo: null };
  }

  // 401 con sesión activa y sin refresh previo → refrescar y reintentar una vez.
  // Excepciones: `auth/refresh` (evita recursión) y `auth/login` (un 401 ahí
  // son credenciales erróneas, no una sesión vencida: no hay nada que
  // refrescar y el mensaje del backend debe llegar tal cual).
  if (
    respuesta.status === 401 &&
    !reintentado &&
    ruta !== "auth/refresh" &&
    ruta !== "auth/login"
  ) {
    const refrescado = await refrescarToken();

    if (refrescado) {
      return ejecutarPeticion(ruta, init, true);
    }

    throw new ApiError(
      MENSAJES_UI_POR_STATUS[401],
      401,
      cuerpo,
    );
  }

  if (!respuesta.ok) {
    throw new ApiError(
      mensajeUI(respuesta.status, cuerpo),
      respuesta.status,
      cuerpo,
    );
  }

  return { status: respuesta.status, cuerpo };
}

/**
 * Realiza una petición HTTP contra la API EduCoins y exige la envoltura
 * `{ data, meta }` del contrato estándar.
 *
 * Es la función que deben usar las vistas y hooks para los listados y el
 * resto de endpoints con envelope. Para los endpoints unitarios cuyo DTO
 * sale **en plano** (H3.1/H3.3: crear/actualizar clases y actividades),
 * usa {@link apiRequestPlano}.
 *
 * Si la API responde `401` y hay sesión activa, dispara el refresh del token
 * (con cola para peticiones concurrentes) y reintenta la petición original
 * **una sola vez**. Si el refresh falla o el reintento vuelve a dar `401`,
 * lanza {@link ApiError} sin reintentar de nuevo.
 *
 * @typeParam T Tipo del cuerpo principal (`data`) de la respuesta.
 * @param ruta Ruta relativa del recurso (p. ej. `"classes"`).
 * @param init Opciones adicionales de `fetch`. No debe contener `method` ni `body`
 *   cuando se usan los ayudantes {@link api}; úsalo para headers, signal, etc.
 * @param reintentado Marcador interno: `true` cuando la petición ya fue
 *   reintentada tras un refresh; evita bucles infinitos. No se expone en los
 *   ayudantes {@link api}.
 * @returns Promesa con la envoltura `{ data, meta }` tipada.
 * @throws {ApiError} Si falla la red, la API responde con código no 2xx o el
 *   cuerpo no trae la envoltura esperada.
 */
export async function apiRequest<T>(
  ruta: string,
  init?: RequestInit,
  reintentado = false,
): Promise<ApiEnvelope<T>> {
  const { status, cuerpo } = await ejecutarPeticion(ruta, init, reintentado);

  // 204 No Content (p. ej. `POST auth/logout`): no hay envoltura que validar.
  if (status === 204) {
    return { data: null as T };
  }

  // Excepción de contrato (H2.1): los endpoints de `auth/*` devuelven el
  // cuerpo **en plano** (p. ej. `{ accessToken, usuario, … }`), sin la
  // envoltura `{ data, meta }` de los recursos. Se normaliza aquí para que
  // las vistas y la capa de auth consuman siempre `respuesta.data`.
  if (!esEnvelopeValido(cuerpo)) {
    if (
      ruta.startsWith("auth/") &&
      typeof cuerpo === "object" &&
      cuerpo !== null
    ) {
      return { data: cuerpo as T };
    }

    throw new ApiError(
      "La respuesta de la API no tiene el formato { data, meta } esperado",
      status,
      cuerpo,
    );
  }

  return cuerpo as ApiEnvelope<T>;
}

/**
 * Realiza una petición HTTP y devuelve el cuerpo **tal cual**, sin exigir
 * la envoltura `{ data, meta }`.
 *
 * Es la puerta de los endpoints **unitarios** de H3.1/H3.3, cuyo DTO sale
 * en plano (p. ej. `POST /classes` → `{ mensaje, clase }`,
 * `PATCH /classes/:id` → `ClaseRespuestaDto`,
 * `POST /classes/:claseId/activities` → `{ mensaje, actividad }`,
 * `GET|PATCH /activities/:id` y `POST /activities/:id/publicar` →
 * `ActividadRespuestaDto`): validarlo como envelope lanzaría el error
 * "La respuesta de la API no tiene el formato { data, meta } esperado".
 *
 * Comparte con {@link apiRequest} todo el transporte (headers, token,
 * refresh en `401`, errores y `204` → `null`); solo cambia la
 * interpretación del cuerpo de éxito.
 *
 * @typeParam T Tipo del cuerpo de la respuesta.
 * @param ruta Ruta relativa del recurso (p. ej. `"classes"`).
 * @param init Opciones adicionales de `fetch`.
 * @returns El cuerpo de la respuesta, sin envoltura.
 * @throws {ApiError} Si falla la red o la API responde con código no 2xx.
 */
export async function apiRequestPlano<T>(ruta: string, init?: RequestInit): Promise<T> {
  const { status, cuerpo } = await ejecutarPeticion(ruta, init);

  return (status === 204 ? null : cuerpo) as T;
}

/**
 * Ayudantes tipados para los métodos HTTP más comunes.
 *
 * Cada método fuerza el verbo HTTP y, en los casos de escritura, serializa el
 * cuerpo como JSON automáticamente. La URL siempre se construye dentro de
 * {@link apiRequest}, evitando URLs escritas a mano.
 */
export const api = {
  /**
   * Realiza una petición GET.
   *
   * @typeParam T Tipo de `data` en la respuesta.
   */
  get: <T>(ruta: string, init?: Omit<RequestInit, "method" | "body">) =>
    apiRequest<T>(ruta, { ...init, method: "GET" }),

  /**
   * Realiza una petición POST enviando el cuerpo como JSON.
   *
   * @typeParam T Tipo de `data` en la respuesta.
   */
  post: <T>(
    ruta: string,
    cuerpo: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ) => apiRequest<T>(ruta, { ...init, method: "POST", body: JSON.stringify(cuerpo) }),

  /**
   * Realiza una petición PUT enviando el cuerpo como JSON.
   *
   * @typeParam T Tipo de `data` en la respuesta.
   */
  put: <T>(
    ruta: string,
    cuerpo: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ) => apiRequest<T>(ruta, { ...init, method: "PUT", body: JSON.stringify(cuerpo) }),

  /**
   * Realiza una petición PATCH enviando el cuerpo como JSON.
   *
   * @typeParam T Tipo de `data` en la respuesta.
   */
  patch: <T>(
    ruta: string,
    cuerpo: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ) => apiRequest<T>(ruta, { ...init, method: "PATCH", body: JSON.stringify(cuerpo) }),

  /**
   * Realiza una petición DELETE.
   *
   * @typeParam T Tipo de `data` en la respuesta.
   */
  delete: <T>(ruta: string, init?: Omit<RequestInit, "method" | "body">) =>
    apiRequest<T>(ruta, { ...init, method: "DELETE" }),
};

/**
 * Ayudantes tipados para los endpoints unitarios que devuelven su DTO
 * **en plano** (H3.1/H3.3): mismos verbos y serialización JSON que
 * {@link api}, pero sobre {@link apiRequestPlano} (sin exigir envelope).
 *
 * Cobertura deliberada: `get`, `post` y `patch` — los verbos que usan las
 * fachadas de clases y actividades. El borrado (`DELETE /activities/:id`)
 * responde `204` y va por {@link api}.delete, que ya normaliza ese caso.
 */
export const apiPlano = {
  /**
   * Realiza una petición GET que devuelve el cuerpo en plano.
   *
   * @typeParam T Tipo del cuerpo de la respuesta.
   */
  get: <T>(ruta: string, init?: Omit<RequestInit, "method" | "body">) =>
    apiRequestPlano<T>(ruta, { ...init, method: "GET" }),

  /**
   * Realiza una petición POST enviando el cuerpo como JSON y devolviendo
   * la respuesta en plano.
   *
   * @typeParam T Tipo del cuerpo de la respuesta.
   */
  post: <T>(
    ruta: string,
    cuerpo: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ) => apiRequestPlano<T>(ruta, { ...init, method: "POST", body: JSON.stringify(cuerpo) }),

  /**
   * Realiza una petición PATCH enviando el cuerpo como JSON y devolviendo
   * la respuesta en plano.
   *
   * @typeParam T Tipo del cuerpo de la respuesta.
   */
  patch: <T>(
    ruta: string,
    cuerpo: unknown,
    init?: Omit<RequestInit, "method" | "body">,
  ) => apiRequestPlano<T>(ruta, { ...init, method: "PATCH", body: JSON.stringify(cuerpo) }),
};
