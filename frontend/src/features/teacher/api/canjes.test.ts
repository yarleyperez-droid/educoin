/**
 * Tests de la fachada de canjes del profesor (cola revisable H7.4 /
 * T7.2.3-T7.2.4).
 *
 * La fachada habla con la API real de H7.2
 * (`redemptions.controller.ts`), así que estos tests **mockean el
 * transporte** (`@/lib/api-client`, mismo criterio que
 * `entregas.test.ts`) con los shapes verificados de
 * `src/modules/redemptions/dto/canje-respuesta.dto.ts` y cubren:
 *
 * 1. `listarPendientes` → `GET redemptions/pending?page&limit` con
 *    envoltura `{ data, meta }` (`ListadoCanjesDto`).
 * 2. Normalización de `meta` si el backend no la enviara.
 * 3. `aprobarCanje` → `POST redemptions/:id/approve` plano
 *    (`ResolucionCanjeDto`, 200).
 * 4. `rechazarCanje` y `entregarCanje` → sus rutas `reject`/`deliver`.
 * 5. El `409` ("El canje ya fue resuelto") se propaga como `ApiError`
 *    con el mensaje del backend, sin enmascararlo.
 *
 * `ApiError` se conserva real (`importOriginal`) para que `instanceof`
 * funcione igual en la fachada y en las aserciones. Entorno: Vitest en
 * **node** (sin DOM, ver `vitest.config.mts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();

  return {
    ...original,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    apiPlano: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

import { api, ApiError, apiPlano } from "@/lib/api-client";

import {
  aprobarCanje,
  entregarCanje,
  listarPendientes,
  rechazarCanje,
} from "./canjes";

/** `CanjeListadoDto` de H7.2 tal cual sale del backend (ids string). */
const FILA_BACKEND = {
  id: "9",
  nombreEstudiante: "Ana Pérez",
  nombreItem: "Trivia game in class",
  costoMonedas: 50,
  estado: "pending",
  solicitadoEn: "2026-10-18T12:00:00.000Z",
};

/** `ResolucionCanjeDto` de H7.2 tras una resolución del profesor. */
const RESOLUCION_BACKEND = {
  id: "9",
  estado: "approved",
  resueltoEn: "2026-10-19T09:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(apiPlano.post).mockReset();
});

describe("listarPendientes", () => {
  it("pide redemptions/pending con la paginación y devuelve { data, meta }", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [FILA_BACKEND],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const cola = await listarPendientes(1, 20);

    expect(api.get).toHaveBeenCalledWith("redemptions/pending?page=1&limit=20");
    expect(cola.data).toEqual([
      {
        id: "9",
        nombreEstudiante: "Ana Pérez",
        nombreItem: "Trivia game in class",
        costoMonedas: 50,
        estado: "pending",
        solicitadoEn: "2026-10-18T12:00:00.000Z",
      },
    ]);
    expect(cola.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it("normaliza la meta cuando el backend no la envía", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [FILA_BACKEND] });

    const cola = await listarPendientes(2, 10);

    expect(cola.meta).toEqual({ total: 1, page: 2, limit: 10 });
  });

  it("propaga ApiError con el mensaje del backend", async () => {
    vi.mocked(api.get).mockRejectedValue(
      new ApiError("No tienes permisos para realizar esta acción.", 403),
    );

    await expect(listarPendientes(1, 20)).rejects.toThrow(ApiError);
    await expect(listarPendientes(1, 20)).rejects.toThrow(
      "No tienes permisos para realizar esta acción.",
    );
  });
});

describe("aprobarCanje", () => {
  it("llama a POST redemptions/:id/approve y devuelve la resolución", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(RESOLUCION_BACKEND);

    const resolucion = await aprobarCanje("9");

    expect(apiPlano.post).toHaveBeenCalledWith(
      "redemptions/9/approve",
      {},
    );
    expect(resolucion).toEqual({
      id: "9",
      estado: "approved",
      resueltoEn: "2026-10-19T09:00:00.000Z",
    });
  });

  it("propaga el 409 de canje ya resuelto con el mensaje del backend", async () => {
    vi.mocked(apiPlano.post).mockRejectedValue(
      new ApiError("El canje ya fue resuelto", 409),
    );

    await expect(aprobarCanje("9")).rejects.toThrow(ApiError);
    await expect(aprobarCanje("9")).rejects.toThrow(
      "El canje ya fue resuelto",
    );
  });
});

describe("rechazarCanje", () => {
  it("llama a POST redemptions/:id/reject", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue({
      id: "9",
      estado: "rejected",
      resueltoEn: "2026-10-19T09:00:00.000Z",
    });

    const resolucion = await rechazarCanje("9");

    expect(apiPlano.post).toHaveBeenCalledWith("redemptions/9/reject", {});
    expect(resolucion.estado).toBe("rejected");
  });
});

describe("entregarCanje", () => {
  it("llama a POST redemptions/:id/deliver", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue({
      id: "9",
      estado: "delivered",
      resueltoEn: "2026-10-19T09:00:00.000Z",
    });

    const resolucion = await entregarCanje("9");

    expect(apiPlano.post).toHaveBeenCalledWith("redemptions/9/deliver", {});
    expect(resolucion.estado).toBe("delivered");
  });

  it("propaga el 403 sin permiso con el mensaje del backend", async () => {
    vi.mocked(apiPlano.post).mockRejectedValue(
      new ApiError("No tienes permiso para resolver este canje", 403),
    );

    await expect(entregarCanje("9")).rejects.toThrow(
      "No tienes permiso para resolver este canje",
    );
  });
});
