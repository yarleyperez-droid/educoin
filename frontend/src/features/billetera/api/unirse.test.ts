/**
 * Tests de la fachada de unión a clase (T5.7.3 / PRO-392).
 *
 * Verifican el contrato real de H3.2 (PRO-274): envío de `{ codigo }` a
 * `classes/join` (el ValidationPipe del backend rechaza `code`), retorno
 * del DTO de confirmación y propagación de los errores del backend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import { unirseAClase } from "./unirse";

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
  it("envía { codigo } a classes/join y devuelve la confirmación", async () => {
    const cuerpo = {
      mensaje: "Te has unido a la clase Matemática.",
      clase: { id: "1", nombre: "Matemática" },
      inscripcion: { estado: "active", inscritoEn: "2026-10-20T00:00:00Z" },
    };
    responder(201, cuerpo);

    await expect(unirseAClase("abc123")).resolves.toEqual(cuerpo);

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(`${URL_API}/classes/join`);
    expect(JSON.parse(String(init?.body))).toEqual({ codigo: "abc123" });
  });

  it("propaga el 404 real del backend (código inexistente)", async () => {
    responder(404, {
      statusCode: 404,
      message: "El código de unión no existe.",
    });

    await expect(unirseAClase("NOPE")).rejects.toThrow(ApiError);
    await expect(unirseAClase("NOPE")).rejects.toThrow(
      "El código de unión no existe.",
    );
  });

  it("propaga el mensaje real del backend en otros errores (422)", async () => {
    responder(422, {
      statusCode: 422,
      message: "No puedes unirte de nuevo: tu inscripción no está activa.",
    });

    await expect(unirseAClase("NOPE")).rejects.toThrow(
      "No puedes unirte de nuevo: tu inscripción no está activa.",
    );
  });
});
