/**
 * Tests de la fachada de ítems del profesor (tienda H10.2).
 *
 * La fachada habla con la API real de H4.1 (`items.controller.ts`), así
 * que estos tests **mockean el transporte** (`@/lib/api-client`, mismo
 * criterio que `canjes.test.ts`) con los shapes verificados de
 * `src/modules/items/dto/item.dto.ts` y cubren:
 *
 * 1. `listarItemsClase` → `GET items?classId=…` en plano (`ItemDto[]`).
 * 2. `crearItem` → `POST items` con `classId`, nombres del backend y la
 *    composición por tipo (`gradePoints` solo en `grade_bonus`, `stock`
 *    solo en `fun_activity`).
 * 3. La validación cliente (H4.1 + rango 0.1–0.5 de H10.1) responde 422
 *    con los mensajes en español **sin tocar el transporte**.
 * 4. `actualizarItem` → `PATCH items/:id` solo con los campos enviados.
 * 5. `archivarItem` → `DELETE items/:id` en plano (borrado lógico).
 * 6. Los errores del backend (403/409/422) se propagan como `ApiError`
 *    con su mensaje, sin enmascararlos.
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
    apiPlano: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { ApiError, apiPlano } from "@/lib/api-client";

import {
  archivarItem,
  actualizarItem,
  crearItem,
  DECIMAS_MINIMAS,
  DECIMAS_MAXIMAS,
  listarItemsClase,
  MENSAJES_ITEM,
  OPCIONES_DECIMAS,
  erroresPorTipo,
} from "./items";

/** `ItemDto` de H4.1 tal cual sale del backend (ids string). */
const ITEM_BACKEND = {
  id: "7",
  classId: "1",
  name: "Trivia game in class",
  description: "Minijuego en clase",
  type: "fun_activity",
  costCoins: 50,
  gradePoints: null,
  stock: 5,
  status: "active",
  autoApprove: false,
  creadoEn: "2026-10-16T10:00:00.000Z",
  actualizadoEn: "2026-10-16T10:00:00.000Z",
};

/** `ItemDto` de un bono de nota (grade_bonus). */
const BONUS_BACKEND = {
  ...ITEM_BACKEND,
  id: "8",
  name: "+0.5 on the midterm",
  type: "grade_bonus",
  gradePoints: 0.5,
  stock: null,
};

beforeEach(() => {
  vi.mocked(apiPlano.get).mockReset();
  vi.mocked(apiPlano.post).mockReset();
  vi.mocked(apiPlano.patch).mockReset();
  vi.mocked(apiPlano.delete).mockReset();
});

describe("listarItemsClase", () => {
  it("pide items?classId=… en plano y mapea classId → claseId", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue([ITEM_BACKEND, BONUS_BACKEND]);

    const items = await listarItemsClase("1");

    expect(apiPlano.get).toHaveBeenCalledWith("items?classId=1");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "7",
      claseId: "1",
      name: "Trivia game in class",
      type: "fun_activity",
      costCoins: 50,
      gradePoints: null,
      stock: 5,
      status: "active",
      autoApprove: false,
    });
    expect(items[1]).toMatchObject({
      id: "8",
      type: "grade_bonus",
      gradePoints: 0.5,
      stock: null,
    });
  });

  it("propaga ApiError con el mensaje del backend (403 clase ajena)", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(
      new ApiError("No puedes administrar ítems de esta clase.", 403),
    );

    await expect(listarItemsClase("99")).rejects.toThrow(ApiError);
    await expect(listarItemsClase("99")).rejects.toThrow(
      "No puedes administrar ítems de esta clase.",
    );
  });
});

describe("crearItem", () => {
  it("fun_activity válido → POST items con classId y stock (sin gradePoints)", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(ITEM_BACKEND);

    const item = await crearItem("1", {
      name: "Trivia extra",
      description: null,
      type: "fun_activity",
      costCoins: 50,
      gradePoints: null,
      stock: 3,
      autoApprove: false,
    });

    expect(apiPlano.post).toHaveBeenCalledWith("items", {
      classId: 1,
      name: "Trivia extra",
      description: null,
      type: "fun_activity",
      costCoins: 50,
      stock: 3,
      autoApprove: false,
    });
    expect(item.id).toBe("7");
    expect(item.claseId).toBe("1");
  });

  it("grade_bonus válido → POST items con gradePoints (sin stock)", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(BONUS_BACKEND);

    await crearItem("1", {
      name: "+0.5 on the midterm",
      description: null,
      type: "grade_bonus",
      costCoins: 100,
      gradePoints: 0.5,
      stock: null,
      autoApprove: true,
    });

    expect(apiPlano.post).toHaveBeenCalledWith("items", {
      classId: 1,
      name: "+0.5 on the midterm",
      description: null,
      type: "grade_bonus",
      costCoins: 100,
      gradePoints: 0.5,
      autoApprove: true,
    });
  });

  it.each([0.09, 0.51])(
    "grade_bonus con décimas %s (fuera del rango H10.1) → 422 sin llamar a la API",
    async (decimas) => {
      await expect(
        crearItem("1", {
          name: "Bono inválido",
          description: null,
          type: "grade_bonus",
          costCoins: 100,
          gradePoints: decimas,
          stock: null,
          autoApprove: false,
        }),
      ).rejects.toThrow(MENSAJES_ITEM.decimasFueraRango);
      expect(apiPlano.post).not.toHaveBeenCalled();
    },
  );

  it("grade_bonus sin décimas → 422 sin llamar a la API", async () => {
    await expect(
      crearItem("1", {
        name: "Bono vacío",
        description: null,
        type: "grade_bonus",
        costCoins: 100,
        gradePoints: null,
        stock: null,
        autoApprove: false,
      }),
    ).rejects.toThrow(MENSAJES_ITEM.decimasRequeridas);
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("nombre vacío y costo 0 → 422 con ambos mensajes", async () => {
    await expect(
      crearItem("1", {
        name: "   ",
        description: null,
        type: "fun_activity",
        costCoins: 0,
        gradePoints: null,
        stock: 1,
        autoApprove: false,
      }),
    ).rejects.toThrow(MENSAJES_ITEM.nombreVacio);
    await expect(
      crearItem("1", {
        name: "Costo cero",
        description: null,
        type: "fun_activity",
        costCoins: 0,
        gradePoints: null,
        stock: 1,
        autoApprove: false,
      }),
    ).rejects.toThrow(MENSAJES_ITEM.costoInvalido);
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("fun_activity sin stock o con stock negativo → 422", async () => {
    await expect(
      crearItem("1", {
        name: "Sin stock",
        description: null,
        type: "fun_activity",
        costCoins: 10,
        gradePoints: null,
        stock: null,
        autoApprove: false,
      }),
    ).rejects.toThrow(MENSAJES_ITEM.stockRequerido);

    await expect(
      crearItem("1", {
        name: "Stock negativo",
        description: null,
        type: "fun_activity",
        costCoins: 10,
        gradePoints: null,
        stock: -1,
        autoApprove: false,
      }),
    ).rejects.toThrow(MENSAJES_ITEM.stockInvalido);
    expect(apiPlano.post).not.toHaveBeenCalled();
  });
});

describe("actualizarItem", () => {
  it("PATCH items/:id con solo los campos enviados", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue({
      ...ITEM_BACKEND,
      name: "Trivia renombrada",
      costCoins: 60,
    });

    const item = await actualizarItem("7", { name: "Trivia renombrada", costCoins: 60 });

    expect(apiPlano.patch).toHaveBeenCalledWith("items/7", {
      name: "Trivia renombrada",
      costCoins: 60,
    });
    expect(item.name).toBe("Trivia renombrada");
    expect(item.costCoins).toBe(60);
  });

  it("trim del nombre en el parche", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue(ITEM_BACKEND);

    await actualizarItem("7", { name: "  Con espacios  " });

    expect(apiPlano.patch).toHaveBeenCalledWith("items/7", {
      name: "Con espacios",
    });
  });

  it("propaga el 422 del merge inválido del backend", async () => {
    vi.mocked(apiPlano.patch).mockRejectedValue(
      new ApiError(MENSAJES_ITEM.decimasFueraRango, 422),
    );

    await expect(actualizarItem("8", { gradePoints: 0.51 })).rejects.toThrow(
      ApiError,
    );
  });
});

describe("archivarItem", () => {
  it("DELETE items/:id en plano y devuelve el ítem archived", async () => {
    vi.mocked(apiPlano.delete).mockResolvedValue({
      ...ITEM_BACKEND,
      status: "deleted",
    });

    const item = await archivarItem("7");

    expect(apiPlano.delete).toHaveBeenCalledWith("items/7");
    expect(item.status).toBe("deleted");
  });

  it("propaga el 403 del backend", async () => {
    vi.mocked(apiPlano.delete).mockRejectedValue(
      new ApiError("No puedes administrar ítems de esta clase.", 403),
    );

    await expect(archivarItem("99")).rejects.toThrow(
      "No puedes administrar ítems de esta clase.",
    );
  });
});

describe("constantes y validación por tipo (H10.1)", () => {
  it("el rango de décimas es 0.1–0.5 con granularidad de una décima", () => {
    expect(DECIMAS_MINIMAS).toBe(0.1);
    expect(DECIMAS_MAXIMAS).toBe(0.5);
    expect(OPCIONES_DECIMAS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it("erroresPorTipo: grade_bonus exige décimas y prohíbe stock", () => {
    expect(erroresPorTipo("grade_bonus", null, null)).toEqual([
      MENSAJES_ITEM.decimasRequeridas,
    ]);
    expect(erroresPorTipo("grade_bonus", 0.3, 5)).toEqual([
      MENSAJES_ITEM.tipoIncompatible,
    ]);
    expect(erroresPorTipo("grade_bonus", 0.3, null)).toEqual([]);
  });

  it("erroresPorTipo: fun_activity exige stock y prohíbe décimas", () => {
    expect(erroresPorTipo("fun_activity", null, null)).toEqual([
      MENSAJES_ITEM.stockRequerido,
    ]);
    expect(erroresPorTipo("fun_activity", 0.3, 5)).toEqual([
      MENSAJES_ITEM.tipoIncompatible,
    ]);
    expect(erroresPorTipo("fun_activity", null, 0)).toEqual([]);
  });
});
