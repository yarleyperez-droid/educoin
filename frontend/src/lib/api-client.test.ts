/**
 * Tests del cliente HTTP EduCoins con mocks de `fetch` (T5.1.4).
 *
 * Cubre los criterios de aceptación 2 y 3 de H5.1:
 * - CA 2: el `401` dispara el refresh del token y reintenta la petición.
 * - CA 3: el `409`/`422` se traduce a un mensaje de UI en español.
 *
 * La suite no depende de un backend real: `fetch` se reemplaza con
 * `vi.stubGlobal` y las respuestas se sirven desde una secuencia programada.
 *
 * Nota: `accessToken` y `refreshPromise` son variables de módulo, por lo que
 * `beforeEach` limpia la sesión para que los tests no se contaminen entre sí.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, getAccessToken, setAccessToken } from "./api-client";

/** Cuerpo de una respuesta simulada. */
interface RespuestaMock {
  status: number;
  body?: unknown;
}

/** Opciones de {@link mockFetch}. */
interface OpcionesMock {
  /** Respuesta única para `POST auth/refresh`. Por defecto, `401`. */
  refresh?: RespuestaMock;

  /** Secuencia de respuestas para cualquier otra ruta (se agota en la última). */
  ruta: RespuestaMock[];
}

const URL_API = "https://api.test/api/v1/";
const MENSAJE_FALLBACK_409 =
  "La operación entra en conflicto con el estado actual.";
const MENSAJE_FALLBACK_422 =
  "No se pudo procesar la solicitud con los datos proporcionados.";

/**
 * Construye un objeto `Response` real a partir de un {@link RespuestaMock}.
 *
 * Se crea en cada llamada porque el cuerpo de un `Response` solo puede
 * leerse una vez (`text()` lo consume).
 *
 * @param respuesta Código y cuerpo simulados.
 * @returns Instancia de `Response` lista para leer.
 */
function crearResponse(respuesta: RespuestaMock): Response {
  const cuerpo = respuesta.body === undefined ? null : JSON.stringify(respuesta.body);

  return new Response(cuerpo, {
    status: respuesta.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Reemplaza el `fetch` global por un mock que responde con una secuencia
 * programada.
 *
 * Las llamadas a `auth/refresh` se atienden con `opciones.refresh`; el resto
 * de rutas consumen `opciones.ruta` en orden y se quie­dan en la última
 * respuesta cuando la secuencia se agota.
 *
 * @param opciones Secuencia de respuestas por ruta.
 * @returns El mock de `fetch`, para poder assertear llamadas.
 */
function mockFetch(opciones: OpcionesMock) {
  const refresh = opciones.refresh ?? { status: 401, body: { message: "Unauthorized" } };
  let indice = 0;

  const fetchMock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >((input) => {
    const url = String(input);

    if (url.includes("auth/refresh")) {
      return Promise.resolve(crearResponse(refresh));
    }

    const respuesta =
      opciones.ruta[indice] ?? opciones.ruta[opciones.ruta.length - 1];
    indice += 1;

    return Promise.resolve(crearResponse(respuesta));
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Cuenta cuántas veces se llamó a `fetch` con una URL que contiene el
 * fragmento indicado (p. ej. `"auth/refresh"`).
 *
 * @param fetchMock El mock devuelto por {@link mockFetch}.
 * @param fragmento Subcadena a buscar en la URL.
 * @returns Cantidad de llamadas coincidentes.
 */
function contarLlamadas(fetchMock: ReturnType<typeof mockFetch>, fragmento: string): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(fragmento))
    .length;
}

/**
 * Invoca una operación que debe fallar y devuelve el error capturado.
 *
 * @param operación Promesa que se espera que rechace.
 * @returns El error lanzado por la operación.
 */
async function capturarError(operación: Promise<unknown>): Promise<unknown> {
  try {
    await operación;
  } catch (error) {
    return error;
  }

  throw new Error("La operación debía fallar pero se resolvió con éxito");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", URL_API);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("refresco de token en 401 (CA 2)", () => {
  it("dispara refresh y reintenta la petición con el token nuevo", async () => {
    setAccessToken("token-antiguo");

    const fetchMock = mockFetch({
      refresh: { status: 200, body: { data: { accessToken: "token-nuevo" } } },
      ruta: [
        { status: 401, body: { message: "Token expirado" } },
        { status: 200, body: { data: { id: 7, nombre: "Aula 7" } } },
      ],
    });

    const resultado = await api.get<{ id: number; nombre: string }>("classes");

    expect(resultado.data).toEqual({ id: 7, nombre: "Aula 7" });
    expect(getAccessToken()).toBe("token-nuevo");
    expect(contarLlamadas(fetchMock, "auth/refresh")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const reintento = fetchMock.mock.calls[2][1] as RequestInit;
    expect(new Headers(reintento.headers).get("Authorization")).toBe(
      "Bearer token-nuevo",
    );
  });

  it("con refresh fallido lanza ApiError 401 sin reintentar de nuevo", async () => {
    setAccessToken("token-antiguo");

    const fetchMock = mockFetch({
      refresh: { status: 401, body: { message: "Refresh inválido" } },
      ruta: [{ status: 401, body: { message: "Token expirado" } }],
    });

    const error = await capturarError(api.get("classes"));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(
      "Tu sesión ha expirado. Inicia sesión de nuevo.",
    );
    expect(contarLlamadas(fetchMock, "auth/refresh")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("peticiones concurrentes comparten un único refresh", async () => {
    setAccessToken("token-antiguo");

    const fetchMock = mockFetch({
      refresh: { status: 200, body: { data: { accessToken: "token-nuevo" } } },
      ruta: [
        { status: 401, body: { message: "Token expirado" } },
        { status: 401, body: { message: "Token expirado" } },
        { status: 200, body: { data: { id: 1 } } },
        { status: 200, body: { data: { id: 2 } } },
      ],
    });

    const [primera, segunda] = await Promise.all([
      api.get<{ id: number }>("classes"),
      api.get<{ id: number }>("students"),
    ]);

    expect(primera.data).toEqual({ id: 1 });
    expect(segunda.data).toEqual({ id: 2 });
    expect(contarLlamadas(fetchMock, "auth/refresh")).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("traducción de errores a mensajes de UI (CA 3)", () => {
  it("409 usa el mensaje del backend cuando viene en el cuerpo", async () => {
    mockFetch({
      ruta: [{ status: 409, body: { message: "El correo ya está registrado" } }],
    });

    const error = await capturarError(api.post("students", { correo: "a@b.c" }));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe("El correo ya está registrado");
  });

  it("409 sin message usa el fallback genérico en español", async () => {
    mockFetch({
      ruta: [{ status: 409, body: { statusCode: 409, error: "Conflict" } }],
    });

    const error = await capturarError(api.post("classes", {}));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(MENSAJE_FALLBACK_409);
  });

  it("422 usa el mensaje del backend cuando viene en el cuerpo", async () => {
    mockFetch({
      ruta: [{ status: 422, body: { message: "Saldo insuficiente" } }],
    });

    const error = await capturarError(api.post("redemptions", {}));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe("Saldo insuficiente");
  });

  it("422 sin message usa el fallback genérico en español", async () => {
    mockFetch({
      ruta: [{ status: 422, body: { statusCode: 422 } }],
    });

    const error = await capturarError(api.post("redemptions", {}));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(MENSAJE_FALLBACK_422);
  });

  it("409 con message en formato lista usa el primer elemento", async () => {
    mockFetch({
      ruta: [
        {
          status: 422,
          body: { message: ["El monto debe ser mayor a 0", "Concepto requerido"] },
        },
      ],
    });

    const error = await capturarError(api.post("redemptions", {}));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("El monto debe ser mayor a 0");
  });

  it("mantiene el cuerpo crudo en detalles para depuración", async () => {
    const cuerpo = { statusCode: 409, message: "Duplicado" };

    mockFetch({ ruta: [{ status: 409, body: cuerpo }] });

    const error = await capturarError(api.post("classes", {}));

    expect((error as ApiError).detalles).toEqual(cuerpo);
  });
});

describe("ayudantes y cabeceras", () => {
  it("cada ayudante envía el verbo HTTP correcto", async () => {
    const fetchMock = mockFetch({
      ruta: [{ status: 200, body: { data: null } }],
    });

    await api.get("recurso");
    await api.post("recurso", { a: 1 });
    await api.put("recurso", { a: 2 });
    await api.patch("recurso", { a: 3 });
    await api.delete("recurso");

    const verbos = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).method,
    );

    expect(verbos).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });

  it("adjunta Authorization Bearer solo con sesión activa", async () => {
    const fetchMock = mockFetch({
      ruta: [{ status: 200, body: { data: null } }],
    });

    await api.get("perfil");
    const sinSesion = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Headers;
    expect(sinSesion.get("Authorization")).toBeNull();

    setAccessToken("abc123");
    await api.get("perfil");
    const conSesion = (fetchMock.mock.calls[1][1] as RequestInit)
      .headers as Headers;
    expect(conSesion.get("Authorization")).toBe("Bearer abc123");
  });

  it("serializa el cuerpo como JSON en las peticiones de escritura", async () => {
    const fetchMock = mockFetch({
      ruta: [{ status: 201, body: { data: { id: 1 } } }],
    });

    await api.post("classes", { nombre: "Algebra" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ nombre: "Algebra" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });
});
