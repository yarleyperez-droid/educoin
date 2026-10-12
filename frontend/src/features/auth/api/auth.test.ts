/**
 * Tests de la capa de autenticación mock (T5.4.1, plan §4).
 *
 * Cubren los 7 escenarios previstos para el mock de `features/auth/api/auth`:
 * login por usuario (teacher), login por correo (student), contraseña
 * incorrecta e identificador inexistente (mismo mensaje genérico, sin
 * enumeración), normalización del identificador, `cerrarSesion` y el flag
 * `mustChangePassword` del estudiante demo. T5.4.2 (PRO-379) añade las
 * suites de `leerSesionActual` y `cambiarContrasena` (plan §5).
 *
 * Entorno: Vitest corre en **node** (sin DOM, ver `vitest.config.mts`), por
 * lo que `document.cookie` se simula con un doble cuyo accessor registra cada
 * asignación (misma técnica que `api-client.test.ts` con `fetch`). Así se
 * prueba la escritura real de la cookie sin jsdom y sin romper el entorno
 * Edge/browser de producción, donde `document` existe de verdad.
 *
 * La suite no depende de un backend: valida el mock de T5.4.1 que T5.4.3
 * (PRO-381) reemplazará por `api.post('auth/login', …)`.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USUARIOS_MOCK } from "@/features/auth/usuarios-mock";
import { ApiError, getAccessToken, setAccessToken } from "@/lib/api-client";
import { crearCookieSesion, leerSesion } from "@/lib/auth";

import {
  cambiarContrasena,
  cerrarSesion,
  iniciarSesion,
  leerSesionActual,
  rutaPorRol,
} from "./auth";

/** Contraseña de desarrollo compartida por los usuarios mock. */
const CONTRASENA_MOCK = "Password123!";

/** Mensaje genérico que deben compartir todos los rechazos de credenciales. */
const MENSAJE_CREDENCIALES_INVALIDAS = "Usuario o contraseña incorrectos.";

/** Mensaje cuando no hay sesión que respalde el cambio de contraseña. */
const MENSAJE_SESION_INVALIDA =
  "No hay una sesión activa. Inicia sesión para continuar.";

/** Mensaje cuando la contraseña actual no coincide (texto de plan §2). */
const MENSAJE_CONTRASENA_ACTUAL_INCORRECTA =
  "La contraseña actual no es correcta.";

/** Mensaje cuando la nueva contraseña no llega a 8 caracteres. */
const MENSAJE_NUEVA_MUY_CORTA =
  "La nueva contraseña debe tener al menos 8 caracteres.";

/** Mensaje cuando la nueva contraseña coincide con la actual. */
const MENSAJE_NUEVA_IGUAL_A_ACTUAL =
  "La nueva contraseña debe ser distinta de la actual.";

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
 * Reproduce la semántica de navegador que usa el mock: cada escritura
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

/** Doble de `document` activo durante el test en curso. */
let stub: DocumentoCookieStub;

beforeEach(() => {
  setAccessToken(null);
  stub = crearDocumentoCookieStub();
  vi.stubGlobal("document", stub.documento);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("iniciarSesion — credenciales válidas", () => {
  it("login por usuario válido (teacher): devuelve la sesión y escribe la cookie", async () => {
    const sesion = await iniciarSesion({
      identificador: "profesor.demo",
      contrasena: CONTRASENA_MOCK,
    });

    expect(sesion.rol).toBe("teacher");
    expect(sesion.userId).toBe("1");
    expect(sesion.email).toBe("profesor.demo@demo.com");
    expect(sesion.organizationId).toBe("10");

    // Cookie escrita con el codificado que leerSesion (T5.3.3) lee de vuelta.
    const valorCookie = crearCookieSesion(sesion);
    expect(stub.asignaciones.at(-1)).toBe(
      `educoins_sesion=${valorCookie}; path=/; SameSite=Lax`,
    );

    const request = new NextRequest(new URL("http://localhost/login"), {
      headers: new Headers({ cookie: `educoins_sesion=${valorCookie}` }),
    });
    expect(leerSesion(request)).toEqual(sesion);

    // Token simulado para que apiRequest adjunte Authorization en el panel.
    expect(getAccessToken()).toBe(`mock-${sesion.userId}`);
  });

  it("login por correo válido (student): devuelve la sesión con rol student", async () => {
    const sesion = await iniciarSesion({
      identificador: "estudiante.demo@demo.com",
      contrasena: CONTRASENA_MOCK,
    });

    expect(sesion.rol).toBe("student");
    expect(sesion.userId).toBe("2");
  });

  it("normaliza los espacios alrededor del identificador y hace login", async () => {
    const sesion = await iniciarSesion({
      identificador: "  profesor.demo  ",
      contrasena: CONTRASENA_MOCK,
    });

    expect(sesion.rol).toBe("teacher");

    const porCorreo = await iniciarSesion({
      identificador: "  estudiante.demo@demo.com  ",
      contrasena: CONTRASENA_MOCK,
    });

    expect(porCorreo.rol).toBe("student");
  });

  it("el estudiante demo expone mustChangePassword: true", async () => {
    const sesion = await iniciarSesion({
      identificador: "estudiante.demo",
      contrasena: CONTRASENA_MOCK,
    });

    expect(sesion.mustChangePassword).toBe(true);
  });
});

describe("iniciarSesion — credenciales inválidas (sin enumeración)", () => {
  it("contraseña incorrecta: ApiError 401 con el mensaje genérico", async () => {
    const error = await capturarError(
      iniciarSesion({
        identificador: "profesor.demo",
        contrasena: "contrasena-mala",
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);
  });

  it("identificador inexistente: el mismo mensaje genérico, sin revelar si existe", async () => {
    const error = await capturarError(
      iniciarSesion({
        identificador: "usuario.inexistente",
        contrasena: CONTRASENA_MOCK,
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);
  });

  it("no escribe cookie ni token cuando las credenciales fallan", async () => {
    await capturarError(
      iniciarSesion({
        identificador: "profesor.demo",
        contrasena: "contrasena-mala",
      }),
    );

    expect(stub.asignaciones).toHaveLength(0);
    expect(getAccessToken()).toBeNull();
  });
});

describe("cerrarSesion", () => {
  it("limpia la cookie (max-age=0) y pone el token en null", async () => {
    const sesion = await iniciarSesion({
      identificador: "admin.demo",
      contrasena: CONTRASENA_MOCK,
    });

    expect(getAccessToken()).toBe(`mock-${sesion.userId}`);

    await cerrarSesion();

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

describe("referencia del mock", () => {
  it("los 3 usuarios demo existen con la contraseña de desarrollo compartida", () => {
    expect(USUARIOS_MOCK).toHaveLength(3);

    for (const usuario of USUARIOS_MOCK) {
      expect(usuario.contrasena).toBe(CONTRASENA_MOCK);
    }
  });
});

describe("leerSesionActual", () => {
  it("devuelve la sesión escrita en la cookie simulada, con su flag", async () => {
    await iniciarSesion({
      identificador: "estudiante.demo",
      contrasena: CONTRASENA_MOCK,
    });

    const sesion = leerSesionActual();

    expect(sesion?.userId).toBe("2");
    expect(sesion?.rol).toBe("student");
    expect(sesion?.mustChangePassword).toBe(true);
  });

  it("devuelve null sin cookie de sesión", () => {
    expect(leerSesionActual()).toBeNull();
  });
});

describe("cambiarContrasena", () => {
  /**
   * Restaura el estado del mock mutado en memoria por el test de éxito.
   *
   * `cambiarContrasena` actualiza `contrasena` y `mustChangePassword` de
   * `USUARIOS_MOCK` (límite del mock, plan §7); sin restaurar, los tests
   * preexistentes que asumen la contraseña de desarrollo y el flag original
   * fallarían.
   */
  afterEach(() => {
    const estudiante = USUARIOS_MOCK.find((usuario) => usuario.userId === "2");

    if (estudiante) {
      estudiante.contrasena = CONTRASENA_MOCK;
      estudiante.mustChangePassword = true;
    }
  });

  /** Establece una sesión vigente de estudiante.demo en la cookie simulada. */
  async function iniciarSesionEstudiante(): Promise<void> {
    await iniciarSesion({
      identificador: "estudiante.demo",
      contrasena: CONTRASENA_MOCK,
    });
  }

  it("sin sesión activa: ApiError 401", async () => {
    const error = await capturarError(
      cambiarContrasena({ actual: CONTRASENA_MOCK, nueva: "NuevaClave123!" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe(MENSAJE_SESION_INVALIDA);
  });

  it("contraseña actual incorrecta: ApiError 400 y el mock queda intacto", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({
        actual: "contrasena-mala",
        nueva: "NuevaClave123!",
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe(
      MENSAJE_CONTRASENA_ACTUAL_INCORRECTA,
    );

    const usuario = USUARIOS_MOCK.find((candidato) => candidato.userId === "2");
    expect(usuario?.contrasena).toBe(CONTRASENA_MOCK);
    expect(usuario?.mustChangePassword).toBe(true);
  });

  it("nueva contraseña de menos de 8 caracteres: ApiError 422", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({ actual: CONTRASENA_MOCK, nueva: "Corta1!" }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe(MENSAJE_NUEVA_MUY_CORTA);
  });

  it("nueva contraseña igual a la actual: ApiError 422", async () => {
    await iniciarSesionEstudiante();

    const error = await capturarError(
      cambiarContrasena({ actual: CONTRASENA_MOCK, nueva: CONTRASENA_MOCK }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe(MENSAJE_NUEVA_IGUAL_A_ACTUAL);
  });

  it("éxito: sesión con flag false, mock mutado y cookie reescrita", async () => {
    await iniciarSesionEstudiante();

    const sesion = await cambiarContrasena({
      actual: CONTRASENA_MOCK,
      nueva: "NuevaClave123!",
    });

    expect(sesion.userId).toBe("2");
    expect(sesion.rol).toBe("student");
    expect(sesion.email).toBe("estudiante.demo@demo.com");
    expect(sesion.mustChangePassword).toBe(false);

    // El usuario mock queda actualizado en memoria (plan §2).
    const usuario = USUARIOS_MOCK.find((candidato) => candidato.userId === "2");
    expect(usuario?.contrasena).toBe("NuevaClave123!");
    expect(usuario?.mustChangePassword).toBe(false);

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
