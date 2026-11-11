/**
 * Tests de la fachada de canje (T5.7.2 / PRO-391 + canje revisable H7.3).
 *
 * Stubbean `globalThis.fetch` shaped como los controllers reales
 * (`items.controller.ts`, `redemptions.controller.ts`):
 * - `GET /items` → `ItemDto[]` en plano;
 * - `GET /redemptions/preview` → `PrevisualizacionCanjeDto` en plano;
 * - `POST /redemptions` → `CanjeRespuestaDto` en plano (201), ahora con
 *   `resueltoEn` y `aprobacionAutomatica` (H7.2);
 * - `GET /redemptions/mine?page&limit` → `ListadoCanjesDto` con
 *   `{ data, meta }` (T7.2.5).
 *
 * Verifican mapeo a dominio, la URL de preview con `itemId`, la
 * paginación de `mine` y la propagación de `ApiError` (422 de saldo
 * insuficiente).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  canjear,
  listarItems,
  listarMisCanjes,
  previsualizarCanje,
} from "./canje";

/** URL base idéntica a la que usa `api-client` en producción. */
const URL_API = "http://localhost:3000/api/v1";

/** `ItemDto` del backend (con campos de gestión que el dominio omite). */
const ITEM_BACKEND = {
  id: "2",
  classId: "1",
  name: "Trivia game in class",
  description: "Fun minigame session during class",
  type: "fun_activity",
  costCoins: 50,
  gradePoints: null,
  stock: 5,
  status: "active",
  creadoEn: "2026-10-18T10:00:00.000Z",
  actualizadoEn: "2026-10-18T10:00:00.000Z",
};

/** `PrevisualizacionCanjeDto` real. */
const PREVIEW_BACKEND = {
  item: {
    id: "2",
    nombre: "Trivia game in class",
    tipo: "fun_activity",
    costoMonedas: 50,
    stock: 5,
    puntosNota: null,
    disponible: true,
  },
  saldo: { monedasDisponibles: 120 },
  puedeCanjear: true,
  motivo: null,
};

/** `CanjeRespuestaDto` real de un canje recién solicitado (H7.2). */
const CANJE_BACKEND = {
  id: "9",
  itemId: "2",
  nombreItem: "Trivia game in class",
  costoMonedas: 50,
  puntosNota: null,
  estado: "pending",
  canjeadoEn: "2026-10-18T12:00:00.000Z",
  reversadoEn: null,
  resueltoEn: null,
  aprobacionAutomatica: false,
};

/** `CanjeListadoDto` real (fila de `GET /redemptions/mine`). */
const CANJE_LISTADO_BACKEND = {
  id: "9",
  nombreEstudiante: "Ana Pérez",
  nombreItem: "Trivia game in class",
  costoMonedas: 50,
  estado: "pending",
  solicitadoEn: "2026-10-18T12:00:00.000Z",
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

describe("listarItems", () => {
  it("mapea el array plano de GET /items al dominio", async () => {
    responder(200, [ITEM_BACKEND]);

    const items = await listarItems();

    expect(items).toEqual([
      {
        id: "2",
        claseId: "1",
        name: "Trivia game in class",
        description: "Fun minigame session during class",
        type: "fun_activity",
        costCoins: 50,
        gradePoints: null,
        stock: 5,
      },
    ]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(`${URL_API}/items`);
  });

  it("propaga ApiError (403 de clase sin inscripción)", async () => {
    responder(403, {
      statusCode: 403,
      message: "No puedes administrar ítems de esta clase.",
    });

    await expect(listarItems()).rejects.toThrow(ApiError);
    await expect(listarItems()).rejects.toThrow(
      "No puedes administrar ítems de esta clase.",
    );
  });
});

describe("previsualizarCanje", () => {
  it("llama a redemptions/preview con el itemId y devuelve costo/saldo/stock", async () => {
    responder(200, PREVIEW_BACKEND);

    const preview = await previsualizarCanje("2");

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
      `${URL_API}/redemptions/preview?itemId=2`,
    );
    expect(preview.item.costoMonedas).toBe(50);
    expect(preview.saldo.monedasDisponibles).toBe(120);
    expect(preview.puedeCanjear).toBe(true);
    expect(preview.motivo).toBeNull();
  });

  it("devuelve puedeCanjear=false con el motivo del backend", async () => {
    responder(200, {
      ...PREVIEW_BACKEND,
      puedeCanjear: false,
      motivo: "Saldo insuficiente para este canje.",
    });

    const preview = await previsualizarCanje("2");

    expect(preview.puedeCanjear).toBe(false);
    expect(preview.motivo).toBe("Saldo insuficiente para este canje.");
  });
});

describe("canjear", () => {
  it("envía solo { itemId } y devuelve el canje pending del canje revisable", async () => {
    responder(201, CANJE_BACKEND);

    const canje = await canjear("2");

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(`${URL_API}/redemptions`);
    expect(JSON.parse(String(init?.body))).toEqual({ itemId: "2" });
    expect(canje.estado).toBe("pending");
    expect(canje.costoMonedas).toBe(50);
    expect(canje.resueltoEn).toBeNull();
    expect(canje.aprobacionAutomatica).toBe(false);
  });

  it("devuelve approved con aprobacionAutomatica cuando el ítem auto-aprueba", async () => {
    responder(201, {
      ...CANJE_BACKEND,
      estado: "approved",
      resueltoEn: "2026-10-18T12:00:01.000Z",
      aprobacionAutomatica: true,
    });

    const canje = await canjear("2");

    expect(canje.estado).toBe("approved");
    expect(canje.aprobacionAutomatica).toBe(true);
    expect(canje.resueltoEn).toBe("2026-10-18T12:00:01.000Z");
  });

  it("propaga el 422 de saldo insuficiente con el mensaje del backend", async () => {
    responder(422, {
      statusCode: 422,
      message: "Saldo insuficiente para completar el canje.",
    });

    await expect(canjear("2")).rejects.toThrow(ApiError);
    await expect(canjear("2")).rejects.toThrow(
      "Saldo insuficiente para completar el canje.",
    );
  });
});

describe("listarMisCanjes", () => {
  it("pide redemptions/mine con la paginación y devuelve { data, meta }", async () => {
    responder(200, {
      data: [CANJE_LISTADO_BACKEND],
      meta: { total: 1, page: 2, limit: 10 },
    });

    const listado = await listarMisCanjes(2, 10);

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
      `${URL_API}/redemptions/mine?page=2&limit=10`,
    );
    expect(listado.data).toEqual([
      {
        id: "9",
        nombreEstudiante: "Ana Pérez",
        nombreItem: "Trivia game in class",
        costoMonedas: 50,
        estado: "pending",
        solicitadoEn: "2026-10-18T12:00:00.000Z",
      },
    ]);
    expect(listado.meta).toEqual({ total: 1, page: 2, limit: 10 });
  });

  it("normaliza la meta cuando el backend no la envía", async () => {
    responder(200, { data: [CANJE_LISTADO_BACKEND] });

    const listado = await listarMisCanjes(1, 20);

    expect(listado.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it("propaga ApiError con el mensaje del backend", async () => {
    responder(403, {
      statusCode: 403,
      message: "No tienes permisos para realizar esta acción.",
    });

    await expect(listarMisCanjes(1, 20)).rejects.toThrow(ApiError);
  });
});
