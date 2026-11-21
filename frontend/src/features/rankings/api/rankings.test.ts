/**
 * Tests de la fachada de rankings (T5.10.1 / PRO-403, H5.10).
 *
 * La fachada habla con la API real de H4.3, así que estos tests
 * **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados de `FilaRankingDto` y cubren:
 *
 * 1. `{ data, meta }` válido → `RankingPaginado` con `estudianteId`
 *    normalizado a `string`.
 * 2. Query correcta `?page&limit` (defaults y personalizados).
 * 3. `obtenerRankingPorClase` apunta a `rankings/classes/:id`.
 * 4. `ApiError` del backend se propaga sin enmascarar.
 * 5. Payload que viola el esquema → `ApiError` 422 con el mensaje de
 *    zod (fila sin `nombres`); meta inválida → 422 también.
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

import { api, ApiError } from "@/lib/api-client";

import {
  LIMITE_RANKING,
  obtenerRankingGlobal,
  obtenerRankingPorClase,
} from "./rankings";

/** Fila `FilaRankingDto` de H4.3 (ids como string). */
const FILA_BACKEND = {
  posicion: 1,
  estudianteId: "3",
  nombres: "Juan Pérez",
  monedasGanadas: 120,
  monedasDisponibles: 120,
};

/** Envoltura `{ data, meta }` del ranking con una fila válida. */
const RANKING_BACKEND = {
  data: [FILA_BACKEND],
  meta: { total: 1, page: 1, limit: 20 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("obtenerRankingGlobal", () => {
  it("mapea { data, meta } válido a RankingPaginado con ids string", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(RANKING_BACKEND);

    const resultado = await obtenerRankingGlobal();

    expect(resultado).toEqual({
      data: [
        {
          posicion: 1,
          estudianteId: "3",
          nombres: "Juan Pérez",
          monedasGanadas: 120,
          monedasDisponibles: 120,
        },
      ],
      meta: { total: 1, page: 1, limit: 20 },
    });
  });

  it("pide la página y el límite por defecto en la query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(RANKING_BACKEND);

    await obtenerRankingGlobal();

    expect(api.get).toHaveBeenCalledWith(
      `rankings?page=1&limit=${LIMITE_RANKING}`,
    );
  });

  it("pasa página y límite personalizados a la query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(RANKING_BACKEND);

    await obtenerRankingGlobal(3, 50);

    expect(api.get).toHaveBeenCalledWith("rankings?page=3&limit=50");
  });

  it("propaga el ApiError del backend sin enmascarar", async () => {
    const Original = (await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    )).ApiError;
    vi.mocked(api.get).mockRejectedValueOnce(
      new Original("No autenticado o sesión expirada.", 401),
    );

    await expect(obtenerRankingGlobal()).rejects.toMatchObject({
      message: "No autenticado o sesión expirada.",
      status: 401,
    });
  });

  it("fila que viola el esquema lanza ApiError 422 con el mensaje de zod", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [{ ...FILA_BACKEND, nombres: undefined }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const rechazo = obtenerRankingGlobal();

    await expect(rechazo).rejects.toBeInstanceOf(ApiError);
    await expect(rechazo).rejects.toMatchObject({ status: 422 });
    await expect(rechazo).rejects.toThrow(/nombres/);
  });

  it("meta inválida lanza ApiError 422", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [FILA_BACKEND],
      meta: { total: "muchas", page: 1, limit: 20 },
    } as never);

    await expect(obtenerRankingGlobal()).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("obtenerRankingPorClase", () => {
  it("apunta a rankings/classes/:id con la query estándar", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(RANKING_BACKEND);

    await obtenerRankingPorClase("7");

    expect(api.get).toHaveBeenCalledWith(
      `rankings/classes/7?page=1&limit=${LIMITE_RANKING}`,
    );
  });

  it("devuelve la página mapeada igual que el global", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(RANKING_BACKEND);

    const resultado = await obtenerRankingPorClase("7", 2, 10);

    expect(resultado.data).toHaveLength(1);
    expect(resultado.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });
});
