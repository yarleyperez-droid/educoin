/**
 * Tests de la fachada de organizaciones del panel admin (T5.5.1 /
 * PRO-380, H5.5).
 *
 * La fachada habla con la API real de H2.4, así que estos tests
 * **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados de `OrganizacionRespuestaDto` y cubren:
 *
 * 1. `{ data, meta }` válido → `ListadoOrganizaciones`.
 * 2. Query `?page&limit` con defaults y personalizados.
 * 3. `crearOrganizacion` envía el body correcto (nombre trim, ciudad
 *    omitida cuando está vacía) y devuelve `{ mensaje, organizacion }`.
 * 4. Payload fuera de contrato → `ApiError` 422 con el mensaje de zod.
 * 5. `ApiError` del backend (409 de nombre duplicado) se propaga.
 *
 * Entorno: Vitest en node (sin DOM, ver `vitest.config.mts`).
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
  LIMITE_ORGANIZACIONES,
  crearOrganizacion,
  listarOrganizaciones,
} from "./organizaciones";

/** `OrganizacionRespuestaDto` de H2.4 (id como string). */
const ORG_BACKEND = {
  id: "9",
  nombre: "Institución Demo",
  tipo: "school" as const,
  ciudad: "Buga",
  activa: true,
  creadoEn: "2026-10-20T10:00:00.000Z",
  actualizadoEn: "2026-10-20T10:00:00.000Z",
};

const LISTADO_BACKEND = {
  data: [ORG_BACKEND],
  meta: { total: 1, page: 1, limit: 20 },
};

const CREACION_BACKEND = {
  mensaje: "Organización creada con éxito.",
  organizacion: ORG_BACKEND,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarOrganizaciones", () => {
  it("devuelve { data, meta } validado", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    const resultado = await listarOrganizaciones();

    expect(resultado.data).toHaveLength(1);
    expect(resultado.data[0]).toEqual(ORG_BACKEND);
    expect(resultado.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it("pide la página y el límite por defecto", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    await listarOrganizaciones();

    expect(api.get).toHaveBeenCalledWith(
      `organizations?page=1&limit=${LIMITE_ORGANIZACIONES}`,
    );
  });

  it("pasa página y límite personalizados", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    await listarOrganizaciones(3, 50);

    expect(api.get).toHaveBeenCalledWith("organizations?page=3&limit=50");
  });

  it("payload fuera de contrato lanza ApiError 422 con el mensaje de zod", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [{ ...ORG_BACKEND, tipo: "empresa" }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const rechazo = listarOrganizaciones();

    await expect(rechazo).rejects.toBeInstanceOf(ApiError);
    await expect(rechazo).rejects.toMatchObject({ status: 422 });
    await expect(rechazo).rejects.toThrow(/tipo/);
  });
});

describe("crearOrganizacion", () => {
  it("envía el body correcto con la ciudad incluida", async () => {
    vi.mocked(apiPlano.post).mockResolvedValueOnce(CREACION_BACKEND);

    const resultado = await crearOrganizacion({
      nombre: "  Colegio Nuevo  ",
      tipo: "school",
      ciudad: "Cali",
    });

    expect(apiPlano.post).toHaveBeenCalledWith("organizations", {
      nombre: "Colegio Nuevo",
      tipo: "school",
      ciudad: "Cali",
    });
    expect(resultado.mensaje).toBe(CREACION_BACKEND.mensaje);
    expect(resultado.organizacion.id).toBe("9");
  });

  it("omite la ciudad cuando está vacía o es undefined", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(CREACION_BACKEND);

    await crearOrganizacion({ nombre: "U", tipo: "other", ciudad: "   " });

    expect(apiPlano.post).toHaveBeenCalledWith("organizations", {
      nombre: "U",
      tipo: "other",
    });
  });

  it("propaga el ApiError 409 del backend sin enmascarar", async () => {
    vi.mocked(apiPlano.post).mockRejectedValueOnce(
      new ApiError("Ya existe una organización con ese nombre.", 409),
    );

    await expect(
      crearOrganizacion({ nombre: "Repetida", tipo: "school" }),
    ).rejects.toMatchObject({
      message: "Ya existe una organización con ese nombre.",
      status: 409,
    });
  });

  it("respuesta fuera de contrato lanza ApiError 422", async () => {
    vi.mocked(apiPlano.post).mockResolvedValueOnce({ mensaje: "ok" });

    await expect(
      crearOrganizacion({ nombre: "Sin org", tipo: "school" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
