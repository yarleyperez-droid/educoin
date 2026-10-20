/**
 * Tests de la fachada de clases (T5.6.1 → T5.6.4, PRO-388).
 *
 * Desde T5.6.4 la fachada habla con la API real de H3.1, así que estos
 * tests **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados en `test/classes.e2e-spec.ts` y cubren:
 * - la validación de cliente (`ApiError` 422/400) **sin invocar** el
 *   transporte;
 * - el mapeo backend → tipo frontend (incluida la normalización de IDs);
 * - la propagación de errores del backend (`ApiError` tal cual);
 * - `obtenerClase`: `404` → `null`, otros errores se propagan.
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

import { api, apiPlano, ApiError } from "@/lib/api-client";

import type { Clase, EstadoClase } from "../tipos";

import {
  actualizarClase,
  buscarClases,
  crearClase,
  LONGITUD_MAXIMA_NOMBRE,
  LONGITUD_MINIMA_NOMBRE,
  obtenerClase,
} from "./clases";

/** Nombre válido de ejemplo (≥ 8 caracteres). */
const NOMBRE_VALIDO = "Historia Universal 11B";

/** `ClaseRespuestaDto` de H3.1 tal cual sale del backend (e2e). */
const CLASE_BACKEND = {
  id: "5",
  profesorId: "2",
  nombre: NOMBRE_VALIDO,
  codigo: "AB12CD34",
  estado: "active" as EstadoClase,
  creadoEn: "2026-10-12T10:00:00.000Z",
  actualizadoEn: "2026-10-12T10:00:00.000Z",
};

/** `ClaseCreadaRespuestaDto` de H3.1: `{ mensaje, clase }` en plano. */
const CLASE_CREADA_BACKEND = {
  mensaje: "Clase creada con éxito. Comparte el código AB12CD34 con tus estudiantes.",
  clase: CLASE_BACKEND,
};

/** `ClaseListadoDto` de H3.1 (sin `codigo`, decisión del backend). */
const CLASE_LISTADO_BACKEND = {
  id: "5",
  nombre: NOMBRE_VALIDO,
  estado: "active" as EstadoClase,
  profesorNombre: "Ana López",
  creadoEn: "2026-10-12T10:00:00.000Z",
};

/** Traducción esperada de {@link CLASE_BACKEND} al tipo `Clase`. */
const CLASE_ESPERADA: Clase = {
  id: "5",
  profesorId: "2",
  nombre: NOMBRE_VALIDO,
  codigo: "AB12CD34",
  estado: "active",
  creadoEn: "2026-10-12T10:00:00.000Z",
  actualizadoEn: "2026-10-12T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("crearClase", () => {
  it("rechaza un nombre con menos de 8 caracteres con ApiError 422 sin invocar el transporte", async () => {
    const nombreCorto = "A".repeat(LONGITUD_MINIMA_NOMBRE - 1);

    await expect(crearClase({ nombre: nombreCorto })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(crearClase({ nombre: nombreCorto })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("rechaza un nombre vacío con ApiError 422 sin invocar el transporte", async () => {
    await expect(crearClase({ nombre: "   " })).rejects.toMatchObject({
      status: 422,
    });
    await expect(crearClase({ nombre: "" })).rejects.toMatchObject({
      status: 422,
    });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("rechaza un nombre con más de 150 caracteres con ApiError 422 sin invocar el transporte", async () => {
    const nombreLargo = "A".repeat(LONGITUD_MAXIMA_NOMBRE + 1);

    await expect(crearClase({ nombre: nombreLargo })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("crea una clase válida: envía solo { nombre } y mapea la respuesta del backend", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(CLASE_CREADA_BACKEND);

    const clase = await crearClase({ nombre: NOMBRE_VALIDO });

    expect(apiPlano.post).toHaveBeenCalledWith("classes", {
      nombre: NOMBRE_VALIDO,
    });
    expect(clase).toEqual(CLASE_ESPERADA);
  });

  it("normaliza el nombre con trim antes de crear", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(CLASE_CREADA_BACKEND);

    await crearClase({ nombre: `   ${NOMBRE_VALIDO}   ` });

    expect(apiPlano.post).toHaveBeenCalledWith("classes", {
      nombre: NOMBRE_VALIDO,
    });
  });

  it("propaga el ApiError del backend sin envolverlo", async () => {
    const errorBackend = new ApiError(
      "Ya existe una clase con ese nombre.",
      409,
    );
    vi.mocked(apiPlano.post).mockRejectedValue(errorBackend);

    await expect(crearClase({ nombre: NOMBRE_VALIDO })).rejects.toBe(
      errorBackend,
    );
  });
});

describe("buscarClases", () => {
  it("rechaza búsquedas de menos de 3 caracteres con ApiError 422 sin invocar el transporte", async () => {
    await expect(buscarClases("ma")).rejects.toBeInstanceOf(ApiError);
    await expect(buscarClases("ma")).rejects.toMatchObject({ status: 422 });
    await expect(buscarClases("   ")).rejects.toMatchObject({ status: 422 });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("pide GET /classes?q=…&page=…&limit=… y devuelve { data, meta } tal cual", async () => {
    const respuestaBackend = {
      data: [CLASE_LISTADO_BACKEND],
      meta: { total: 1, page: 1, limit: 20 },
    };
    vi.mocked(api.get).mockResolvedValue(respuestaBackend);

    const resultado = await buscarClases("Historia");

    expect(api.get).toHaveBeenCalledWith(
      "classes?q=Historia&page=1&limit=20",
    );
    expect(resultado).toEqual(respuestaBackend);
    // ClaseListadoDto no expone el código de unión (decisión del backend).
    expect(resultado.data[0]).not.toHaveProperty("codigo");
  });

  it("normaliza la página a ≥ 1 y viaja el límite pedido", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 50 },
    });

    const resultado = await buscarClases("Universal", 0, 50);

    expect(api.get).toHaveBeenCalledWith(
      "classes?q=Universal&page=1&limit=50",
    );
    expect(resultado.meta.page).toBe(1);
  });

  it("propaga el ApiError del backend sin envolverlo", async () => {
    const errorBackend = new ApiError("Error interno del servidor.", 500);
    vi.mocked(api.get).mockRejectedValue(errorBackend);

    await expect(buscarClases("Historia")).rejects.toBe(errorBackend);
  });
});

describe("obtenerClase", () => {
  it("mapea la respuesta del backend (ClaseRespuestaDto → Clase)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(CLASE_BACKEND);

    const clase = await obtenerClase("5");

    expect(apiPlano.get).toHaveBeenCalledWith("classes/5");
    expect(clase).toEqual(CLASE_ESPERADA);
  });

  it("devuelve null cuando el backend responde 404", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(
      new ApiError("No se encontró el recurso solicitado.", 404),
    );

    await expect(obtenerClase("no-existe")).resolves.toBeNull();
  });

  it("propaga los errores que no son 404", async () => {
    const errorBackend = new ApiError("Error interno del servidor.", 500);
    vi.mocked(apiPlano.get).mockRejectedValue(errorBackend);

    await expect(obtenerClase("5")).rejects.toBe(errorBackend);
  });
});

describe("actualizarClase", () => {
  it("rechaza un parche sin ningún campo con ApiError 400 sin invocar el transporte", async () => {
    await expect(actualizarClase("5", {})).rejects.toBeInstanceOf(ApiError);
    await expect(actualizarClase("5", {})).rejects.toMatchObject({ status: 400 });
    expect(apiPlano.patch).not.toHaveBeenCalled();
  });

  it("rechaza un nombre corto al editar con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      actualizarClase("5", { nombre: "corto" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.patch).not.toHaveBeenCalled();
  });

  it("rechaza un estado fuera del enum con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      actualizarClase("5", { estado: "borrador" as EstadoClase }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.patch).not.toHaveBeenCalled();
  });

  it("archiva una clase enviando solo { estado } y mapea la respuesta", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue({
      ...CLASE_BACKEND,
      estado: "archived",
    });

    const archivada = await actualizarClase("5", { estado: "archived" });

    expect(apiPlano.patch).toHaveBeenCalledWith("classes/5", {
      estado: "archived",
    });
    expect(archivada.estado).toBe("archived");
    expect(archivada.nombre).toBe(CLASE_BACKEND.nombre);
  });

  it("renombra una clase normalizando el nombre con trim", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue({
      ...CLASE_BACKEND,
      nombre: "Deporte Escolar 9A",
    });

    const renombrada = await actualizarClase("5", {
      nombre: "   Deporte Escolar 9A   ",
    });

    expect(apiPlano.patch).toHaveBeenCalledWith("classes/5", {
      nombre: "Deporte Escolar 9A",
    });
    expect(renombrada.nombre).toBe("Deporte Escolar 9A");
  });

  it("no pre-comprueba la existencia: el 404 del backend se propaga como ApiError", async () => {
    const errorBackend = new ApiError(
      "No se encontró el recurso solicitado.",
      404,
    );
    vi.mocked(apiPlano.patch).mockRejectedValue(errorBackend);

    await expect(
      actualizarClase("no-existe", { estado: "archived" }),
    ).rejects.toBe(errorBackend);
    expect(apiPlano.patch).toHaveBeenCalledWith("classes/no-existe", {
      estado: "archived",
    });
  });
});
