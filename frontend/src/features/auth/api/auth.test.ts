/**
 * Tests de la capa de autenticación (T5.4.1 + T5.4.3 / PRO-381).
 *
 * Desde T5.4.3 `iniciarSesion` y `cerrarSesion` hablan con la **API real de
 * H2.1** (`POST auth/login`, `POST auth/logout`); estos tests stubbean
 * `globalThis.fetch` con respuestas shaped como el backend (ver
 * `src/modules/auth/dto/sesion-respuesta.dto.ts`) y verifican:
 * - mapeo del payload a `Sesion` (vocabulario del backend) y escritura de la
 *   cookie legible `educoins_sesion`;
 * - `setAccessToken` con el JWT real;
 * - `ApiError` 401 con el mensaje real del backend, **sin** intento de
 *   refresh (un 401 en `auth/login` son credenciales malas, no sesión
 *   vencida);
 * - logout que limpia el estado local aunque el backend falle;
 * - el mock documentado de `cambiarContrasena` (H2.2 pendiente).
 *
 * Entorno: Vitest corre en **node** (sin DOM, ver `vitest.config.mts`), por
 * lo que `document.cookie` se simula con un doble cuyo accessor registra cada
 * asignación (misma técnica que `api-client.test.ts` con `fetch`). Así se
 * prueba la escritura real de la cookie sin jsdom y sin romper el entorno
 * Edge/browser de producción, donde `document` existe de verdad.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getAccessToken, setAccessToken } from "@/lib/api-client";
import { crearCookieSesion, leerSesion } from "@/lib/auth";

import {
  cambiarContrasena,
  cerrarSesion,
  iniciarSesion,
  leerSesionActual,
  rutaPorRol,
} from "./auth";

/** URL base de la API, igual que la que usa `api-client` en producción. */
const URL_API = "http://localhost:3000/api/v1";

/** Mensaje real de credenciales inválidas (constante del backend, H2.1). */
const MENSAJE_CREDENCIALES_INVALIDAS = "El usuario o la contraseña son erróneos.";

/** Mensaje cuando no hay sesión que respalde el cambio de contraseña. */
const MENSAJE_SESION_INVALIDA =
  "No hay una sesión activa. Inicia sesión para continuar.";

/** Mensaje cuando falta la contraseña actual (regla defensiva del mock). */
const MENSAJE_CONTRASENA_ACTUAL_INCORRECTA =
  "La contraseña actual no es correcta.";

/** Mensaje cuando la nueva contraseña no llega a 8 caracteres. */
const MENSAJE_NUEVA_MUY_CORTA =
  "La nueva contraseña debe tener al menos 8 caracteres.";

/** Mensaje cuando la nueva contraseña coincide con la actual. */
const MENSAJE_NUEVA_IGUAL_A_ACTUAL =
  "La nueva contraseña debe ser distinta de la actual.";

/** Usuario profesor del seed, shaped como `UsuarioRespuestaDto`. */
const USUARIO_PROFESOR_BACKEND = {
  id: "2",
  username: "prof.lopez",
  email: "lopez@educoins.test",
  role: "teacher" as const,
  nombre: "Laura",
  apellido: "García",
  organizacionId: "10",
  debeCambiarContrasena: false,
};

/** Usuario estudiante del seed con cambio pendiente, shaped como el backend. */
const USUARIO_ESTUDIANTE_BACKEND = {
  id: "3",
  username: "est.perez",
  email: "perez@educoins.test",
  role: "student" as const,
  nombre: "Ana",
  apellido: "López",
  organizacionId: "10",
  debeCambiarContrasena: true,
};

/** Cuerpo del `201` de login para el profesor. */
const SESION_BACKEND_PROFESOR = {
  accessToken: "jwt-acceso-profesor",
  tipoToken: "Bearer" as const,
  expiraEn: "15m",
  usuario: USUARIO_PROFESOR_BACKEND,
};

/** Cuerpo del `201` de login para el estudiante (flag en true). */
const SESION_BACKEND_ESTUDIANTE = {
  accessToken: "jwt-acceso-estudiante",
  tipoToken: "Bearer" as const,
  expiraEn: "15m",
  usuario: USUARIO_ESTUDIANTE_BACKEND,
};

/** Cuerpo del `401` de credenciales inválidas (formato Nest estándar). */
const CUERPO_401 = {
  statusCode: 401,
  message: MENSAJE_CREDENCIALES_INVALIDAS,
  error: "Unauthorized",
};

/** Doble de `document` que registra las asignaciones a `document.cookie`. */
interface DocumentoCookieStub {
  /** Objeto `document` mínimo con el accessor `cookie`. */
  documento: { cookie: string };

  /** Todas las cadenas asignadas a `document.cookie`, en orden. */
  asignaciones: string[];
}

/**
 * Crea un doble de `document.cookie` para el entorno node de Vitest.
 *
 * Reproduce la semántica de navegador que usa la capa: cada escritura
 * (`document.cookie = "...";`) se registra como una asignación completa
 * (nombre, valor y atributos), y la lectura devuelve las cookies vivias
 * (nombre=valor) unidas por `"; "`.
 *
 * @returns El doble con su `documento` y el registro de asignaciones.
 */
function crearDocumentoCookieStub(): DocumentoCookieStub {
  const asignaciones: string[] = [];

  return {
    asignaciones,
    documento: {
      get cookie(): string {
        return asignaciones
          .map((asignacion) => asignacion.split(";")[0])
          .join("; ");
      },
      set cookie(valor: string) {
        asignaciones.push(valor);
      },
    },
  };
}

/**
 * Construye una `Response` de fetch con cuerpo JSON (o vacía para 204).
 *
 * @param status Código HTTP.
 * @param cuerpo Cuerpo JSON; omitir para respuestas sin contenido.
 * @returns `Response` lista para resolver el stub de `fetch`.
 */
function respuestaJson(status: number, cuerpo?: unknown): Response {
  return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Invoca una operación que debe fallar y devuelve el error capturado.
 *
 * @param operacion Promesa que se espera que rechace.
 * @returns El error lanzado por la operación.
 */
async function capturarError(operacion: Promise<unknown>): Promise<unknown> {
  try {
    await operacion;
  } catch (error) {
    return error;
  }

  throw new Error("La operación debía fallar pero se resolvió con éxito");
}

/** Stub de `fetch` activo durante el test en curso. */
const fetchStub = vi.fn();

/** Doble de `document` activo durante el test en curso. */
let stub: DocumentoCookieStub;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", URL_API);
  fetchStub.mockReset();
  vi.stubGlobal("fetch", fetchStub);
  setAccessToken(null);
  stub = crearDocumentoCookieStub();
  vi.stubGlobal("document", stub.documento);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("iniciarSesion — credenciales válidas (login real)", () => {
  it("login por usuario (teacher): mapea el payload, escribe cookie y token", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_PROFESOR));

    const sesion = await iniciarSesion({
      usuarioOEmail: "prof.lopez",
      contrasena: "Prof123!",
    });

    expect(sesion).toEqual({
      id: "2",
      username: "prof.lopez",
      email: "lopez@educoins.test",
      role: "teacher",
      nombre: "Laura",
      apellido: "García",
      organizacionId: "10",
      debeCambiarContrasena: false,
    });

    // Llamada real a POST auth/login con el DTO del backend y credenciales.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${URL_API}/auth/login`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      usuarioOEmail: "prof.lopez",
      contrasena: "Prof123!",
    });

    // Cookie legible escrita con el codificado que leerSesion lee de vuelta.
    const valorCookie = crearCookieSesion(sesion);
    expect(stub.asignaciones.at(-1)).toBe(
      `educoins_sesion=${valorCookie}; path=/; SameSite=Lax`,
    );

    const request = new NextRequest(new URL("http://localhost/login"), {
      headers: new Headers({ cookie: `educoins_sesion=${valorCookie}` }),
    });
    expect(leerSesion(request)).toEqual(sesion);

    // Access token real (JWT) en memoria para que apiRequest adjunte Bearer.
    expect(getAccessToken()).toBe("jwt-acceso-profesor");
  });

  it("login por correo (student): mapea el payload con el flag en true", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_ESTUDIANTE));

    const sesion = await iniciarSesion({
      usuarioOEmail: "perez@educoins.test",
      contrasena: "Estudiante123!",
    });

    expect(sesion.role).toBe("student");
    expect(sesion.id).toBe("3");
    expect(sesion.debeCambiarContrasena).toBe(true);
    expect(getAccessToken()).toBe("jwt-acceso-estudiante");
  });

  it("normaliza los espacios alrededor del usuarioOEmail antes de enviar", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_PROFESOR));

    await iniciarSesion({
      usuarioOEmail: "  prof.lopez  ",
      contrasena: "Prof123!",
    });

    const [, init] = fetchStub.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      usuarioOEmail: "prof.lopez",
      contrasena: "Prof123!",
    });
  });
});

describe("iniciarSesion — credenciales inválidas (401 real)", () => {
  it("ApiError 401 con el mensaje real del backend, sin intentar refresh", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(401, CUERPO_401));

    const error = await capturarError(
      iniciarSesion({
        usuarioOEmail: "prof.lopez",
        contrasena: "clave-mala",
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);

    // Un 401 en auth/login NO dispara auth/refresh: una sola llamada.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("no escribe cookie ni token cuando las credenciales fallan", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(401, CUERPO_401));

    await capturarError(
      iniciarSesion({
        usuarioOEmail: "prof.lopez",
        contrasena: "clave-mala",
      }),
    );

    expect(stub.asignaciones).toHaveLength(0);
    expect(getAccessToken()).toBeNull();
  });
});

describe("cerrarSesion (logout real)", () => {
  it("llama a POST auth/logout y limpia la cookie (max-age=0) y el token", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_PROFESOR));
    await iniciarSesion({
      usuarioOEmail: "prof.lopez",
      contrasena: "Prof123!",
    });
    expect(getAccessToken()).toBe("jwt-acceso-profesor");

    fetchStub.mockResolvedValueOnce(respuestaJson(204));
    await cerrarSesion();

    const [url, init] = fetchStub.mock.calls[1] as [URL, RequestInit];
    expect(url.href).toBe(`${URL_API}/auth/logout`);
    expect(init.method).toBe("POST");

    expect(getAccessToken()).toBeNull();
    expect(stub.asignaciones.at(-1)).toBe(
      "educoins_sesion=; path=/; max-age=0; SameSite=Lax",
    );
  });

  it("limpia el estado local aunque el backend falle (no lanza)", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_PROFESOR));
    await iniciarSesion({
      usuarioOEmail: "prof.lopez",
      contrasena: "Prof123!",
    });

    fetchStub.mockRejectedValueOnce(new Error("red caída"));
    await expect(cerrarSesion()).resolves.toBeUndefined();

    expect(getAccessToken()).toBeNull();
    expect(stub.asignaciones.at(-1)).toBe(
      "educoins_sesion=; path=/; max-age=0; SameSite=Lax",
    );
  });
});

describe("rutaPorRol", () => {
  it("mapea cada rol a su panel", () => {
    expect(rutaPorRol("teacher")).toBe("/teacher");
    expect(rutaPorRol("student")).toBe("/student");
    expect(rutaPorRol("admin")).toBe("/admin");
  });
});

describe("leerSesionActual", () => {
  it("devuelve la sesión escrita en la cookie, con su flag", async () => {
    fetchStub.mockResolvedValueOnce(respuestaJson(201, SESION_BACKEND_ESTUDIANTE));
    await iniciarSesion({
      usuarioOEmail: "est.perez",
      contrasena: "Estudiante123!",
    });

    const sesion = leerSesionActual();

    expect(sesion?.id).toBe("3");
    expect(sesion?.role).toBe("student");
    expect(sesion?.debeCambiarContrasena).toBe(true);
  });

  it("devuelve null sin cookie de sesión", () => {
    expect(leerSesionActual()).toBeNull();
  });
});

describe("cambiarContrasena (MOCK documentado: H2.2 pendiente)", () => {
  /** Establece una sesión vigente de est.perez en la cookie (vía login stub). */
  async function iniciarSesionEstudiante(): Promise<void> {
    fetchStub.mockResolvedValueOnce(
      respuestaJson(201, SESION_BACKEND_ESTUDIANTE),
    );
    await iniciarSesion({
      usuarioOEmail: "est.perez",
      contrasena: "Estudiante123!",
    });
  }

  it("sin sesión activa: ApiError 401", async () => {
    const error = await capturarError(
      cambiarContrasena({ actual: "Estudiante123!", nueva: "NuevaClave123!" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(MENSAJE_SESION_INVALIDA);
  });

  it("contraseña actual vacía: ApiError 400 (guarda defensiva del mock)", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({ actual: "", nueva: "NuevaClave123!" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe(
      MENSAJE_CONTRASENA_ACTUAL_INCORRECTA,
    );
  });

  it("nueva contraseña de menos de 8 caracteres: ApiError 422", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({ actual: "Estudiante123!", nueva: "Corta1!" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe(MENSAJE_NUEVA_MUY_CORTA);
  });

  it("nueva contraseña igual a la actual: ApiError 422", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({
        actual: "Estudiante123!",
        nueva: "Estudiante123!",
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe(MENSAJE_NUEVA_IGUAL_A_ACTUAL);
  });

  it("éxito: sesión con flag false y cookie reescrita (sin llamar al backend)", async () => {
    await iniciarSesionEstudiante();
    const llamadasPrevias = fetchStub.mock.calls.length;

    const sesion = await cambiarContrasena({
      actual: "Estudiante123!",
      nueva: "NuevaClave2026!",
    });

    expect(sesion.id).toBe("3");
    expect(sesion.role).toBe("student");
    expect(sesion.debeCambiarContrasena).toBe(false);

    // El mock NO llama al backend (H2.2 no existe): solo reescribe la cookie.
    expect(fetchStub.mock.calls.length).toBe(llamadasPrevias);

    // Cookie reescrita con el flag en false (última asignación)…
    const valorCookie = crearCookieSesion(sesion);
    expect(stub.asignaciones.at(-1)).toBe(
      `educoins_sesion=${valorCookie}; path=/; SameSite=Lax`,
    );

    // …y legible de vuelta por leerSesion con el flag en false.
    const request = new NextRequest(
      new URL("http://localhost/cambiar-contrasena"),
      { headers: new Headers({ cookie: `educoins_sesion=${valorCookie}` }) },
    );
    expect(leerSesion(request)).toEqual(sesion);

    // La sesión vigente (lectura de la vista) también refleja el cambio.
    expect(leerSesionActual()).toEqual(sesion);
  });
});
