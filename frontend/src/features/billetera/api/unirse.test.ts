/**
 * Tests de la fachada de unión a clase (T5.7.3 / PRO-392).
 *
 * Verifican el contrato SUPUESTO de H3.2 (PRO-274, no implementada):
 * envío de `{ code }` a `classes/join`, traducción del 404 (endpoint
 * inexistente) al mensaje amable y propagación de otros errores.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import { MENSAJE_UNION_PENDIENTE, unirseAClase } from "./unirse";

/** URL base idéntica a la que usa `api-client` en producción. */
const URL_API = "http://localhost:3000/api/v1";

/** Stub que responde con el status y cuerpo dados. */
function responder(status: number, cuerpo: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(cuerpo),
    })),
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", URL_API);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("unirseAClase", () => {
  it("envía { code } a classes/join y resuelve en 2xx", async () => {
    responder(201, { mensaje: "Unión registrada." });

    await expect(unirseAClase("ABC123")).resolves.toBeUndefined();

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(`${URL_API}/classes/join`);
    expect(JSON.parse(String(init?.body))).toEqual({ code: "ABC123" });
  });

  it("el 404 (H3.2 pendiente) se traduce al mensaje amable", async () => {
    responder(404, {
      statusCode: 404,
      message: 'Cannot POST /api/v1/classes/join',
      error: "Not Found",
    });

    await expect(unirseAClase("ABC123")).rejects.toThrow(ApiError);
    await expect(unirseAClase("ABC123")).rejects.toThrow(
      MENSAJE_UNION_PENDIENTE,
    );
  });

  it("propaga el mensaje real del backend en otros errores (422)", async () => {
    responder(422, {
      statusCode: 422,
      message: "El código de unión no existe.",
    });

    await expect(unirseAClase("NOPE")).rejects.toThrow(
      "El código de unión no existe.",
    );
  });
});
