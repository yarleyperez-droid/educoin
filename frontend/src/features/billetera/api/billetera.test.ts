/**
 * Tests de la fachada de billetera (T5.7.1 / PRO-390).
 *
 * Stubbean `globalThis.fetch` con respuestas shaped como el backend real
 * (verificado contra `wallet.controller.ts` y `test/wallet.e2e-spec.ts`):
 * - `GET /wallet` → `SaldoBilleteraDto` **en plano**;
 * - `GET /wallet/movements` → `{ data, meta }`.
 *
 * Verifican el mapeo a dominio (ids a `string`) y la propagación de
 * `ApiError` sin enmascarar. Entorno Vitest en node (sin DOM).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import { obtenerHistorial, obtenerSaldo } from "./billetera";

/** URL base idéntica a la que usa `api-client` en producción. */
const URL_API = "http://localhost:3000/api/v1";

/** Fila cruda shaped como `MovimientoBilleteraDto` del backend. */
const MOVIMIENTO_BACKEND = {
  id: "7",
  tipo: "earning",
  cantidad: 120,
  descripcion: null,
  claseId: "1",
  claseNombre: "Mathematics 10A",
  creadoEn: "2026-10-18T12:00:00.000Z",
};

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

describe("obtenerSaldo", () => {
  it("lee el DTO plano de GET /wallet", async () => {
    responder(200, {
      monedasGanadas: 120,
      monedasGastadas: 0,
      monedasDisponibles: 120,
    });

    const saldo = await obtenerSaldo();

    expect(saldo).toEqual({
      monedasGanadas: 120,
      monedasGastadas: 0,
      monedasDisponibles: 120,
    });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
      `${URL_API}/wallet`,
    );
  });

  it("propaga ApiError sin enmascarar (500)", async () => {
    responder(500, { statusCode: 500, message: "Error interno." });

    await expect(obtenerSaldo()).rejects.toThrow(ApiError);
    await expect(obtenerSaldo()).rejects.toThrow("Error interno.");
  });
});

describe("obtenerHistorial", () => {
  it("lee { data, meta } y normaliza los ids a string", async () => {
    responder(200, {
      data: [{ ...MOVIMIENTO_BACKEND, id: 7, claseId: 1 }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const historial = await obtenerHistorial(1, 20);

    expect(historial.data).toHaveLength(1);
    expect(historial.data[0]).toEqual({
      id: "7",
      tipo: "earning",
      cantidad: 120,
      descripcion: null,
      claseId: "1",
      claseNombre: "Mathematics 10A",
      creadoEn: "2026-10-18T12:00:00.000Z",
    });
    expect(historial.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it("propaga ApiError del historial", async () => {
    responder(403, { statusCode: 403, message: "No tienes permisos." });

    await expect(obtenerHistorial(1, 20)).rejects.toThrow(ApiError);
  });
});
