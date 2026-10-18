/**
 * Tests de la fachada de actividades (T5.6.2 → T5.6.4, PRO-388).
 *
 * Desde T5.6.4 la fachada habla con la API real de H3.3, así que estos
 * tests **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados en `test/activities.e2e-spec.ts` y cubren:
 * - la validación zod de cliente (`ApiError` 422) **sin invocar** el
 *   transporte (datos generales y JSONB `questions`);
 * - el mapeo backend → tipo frontend (`creadoEn → creadaEn`,
 *   `actualizadoEn → actualizadaEn`, `eliminadaEn` descartado);
 * - la propagación de errores del backend (`ApiError` tal cual, sin
 *   pre-cheques 404/409);
 * - `obtenerActividad`: `404` → `null`, otros errores se propagan;
 * - `listarActividades`: filas sin `preguntas` completadas con neutros y
 *   filtrado de `deleted`.
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

import type { Actividad, EstadoActividad } from "../tipos";
import type { Pregunta } from "../contrato/actividades";

import {
  actualizarActividad,
  crearActividad,
  listarActividades,
  obtenerActividad,
  publicarActividad,
} from "./actividades";

/** Pregunta `test` válida de ejemplo. */
const PREGUNTA_TEST: Pregunta = {
  type: "test",
  position: 1,
  prompt: "¿Cuál es la capital de Colombia?",
  score: 10,
  options: [
    { text: "Bogotá", is_correct: true },
    { text: "Cali", is_correct: false },
  ],
};

/** Datos válidos de ejemplo para crear una actividad. */
const DATOS_VALIDOS = {
  claseId: "5",
  titulo: "Repaso de geografía",
  descripcion: "Cuestionario corto de la unidad 1",
  recompensaMonedas: 120,
  preguntas: [PREGUNTA_TEST],
};

/** `ActividadRespuestaDto` de H3.3 tal cual sale del backend (e2e). */
const ACTIVIDAD_BACKEND = {
  id: "10",
  claseId: "5",
  titulo: "Repaso de geografía",
  descripcion: "Cuestionario corto de la unidad 1",
  recompensaMonedas: 120,
  estado: "draft" as EstadoActividad,
  preguntas: [PREGUNTA_TEST],
  publicadaEn: null,
  cierraEn: null,
  creadoEn: "2026-10-12T10:00:00.000Z",
  actualizadoEn: "2026-10-12T10:00:00.000Z",
  eliminadaEn: null,
};

/** `ActividadCreadaRespuestaDto` de H3.3: `{ mensaje, actividad }` en plano. */
const ACTIVIDAD_CREADA_BACKEND = {
  mensaje:
    "Actividad creada como borrador. Publícala cuando esté lista: los estudiantes solo pueden resolver actividades publicadas.",
  actividad: ACTIVIDAD_BACKEND,
};

/** Traducción esperada de {@link ACTIVIDAD_BACKEND} al tipo `Actividad`. */
const ACTIVIDAD_ESPERADA: Actividad = {
  id: "10",
  claseId: "5",
  titulo: "Repaso de geografía",
  descripcion: "Cuestionario corto de la unidad 1",
  recompensaMonedas: 120,
  estado: "draft",
  preguntas: [PREGUNTA_TEST],
  publicadaEn: null,
  cierraEn: null,
  creadaEn: "2026-10-12T10:00:00.000Z",
  actualizadaEn: "2026-10-12T10:00:00.000Z",
};

/** `ActividadListadoDto` de H3.3: filas sin `preguntas` ni `descripcion`. */
const FILA_LISTADO_BACKEND = {
  id: "10",
  titulo: "Repaso de geografía",
  estado: "draft" as EstadoActividad,
  recompensaMonedas: 120,
  publicadaEn: null,
  cierraEn: null,
  creadoEn: "2026-10-12T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("crearActividad", () => {
  it("rechaza un JSONB inválido con ApiError 422 sin invocar el transporte", async () => {
    const intento = crearActividad({
      ...DATOS_VALIDOS,
      preguntas: [
        {
          type: "test",
          position: 1,
          prompt: "Pregunta con una sola opción",
          score: 10,
          options: [{ text: "Única", is_correct: true }],
        },
      ],
    });

    await expect(intento).rejects.toBeInstanceOf(ApiError);
    await expect(intento).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("rechaza un título vacío con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, titulo: "   " }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("rechaza una recompensa negativa con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, recompensaMonedas: -1 }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("rechaza un array de preguntas vacío con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, preguntas: [] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("crea una actividad: renumera posiciones, envía el body esperado y mapea la respuesta", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(ACTIVIDAD_CREADA_BACKEND);

    const creada = await crearActividad({
      ...DATOS_VALIDOS,
      preguntas: [
        { ...PREGUNTA_TEST, position: 9 },
        {
          type: "completion",
          position: 42,
          prompt: "El agua hierve a ___ °C.",
          score: 5,
          expected_answer: "100",
        },
      ],
    });

    expect(apiPlano.post).toHaveBeenCalledWith("classes/5/activities", {
      titulo: DATOS_VALIDOS.titulo,
      descripcion: DATOS_VALIDOS.descripcion,
      recompensaMonedas: 120,
      preguntas: [
        { ...PREGUNTA_TEST, position: 1 },
        {
          type: "completion",
          position: 2,
          prompt: "El agua hierve a ___ °C.",
          score: 5,
          expected_answer: "100",
        },
      ],
    });
    expect(creada).toEqual(ACTIVIDAD_ESPERADA);
    // El mapper traduce las fechas del backend y descarta `eliminadaEn`.
    expect(creada.creadaEn).toBe(ACTIVIDAD_BACKEND.creadoEn);
    expect(creada.actualizadaEn).toBe(ACTIVIDAD_BACKEND.actualizadoEn);
    expect(creada).not.toHaveProperty("eliminadaEn");
  });

  it("descarta la descripción en blanco: no viaja en el body", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue({
      ...ACTIVIDAD_CREADA_BACKEND,
      actividad: { ...ACTIVIDAD_BACKEND, descripcion: null },
    });

    await crearActividad({
      ...DATOS_VALIDOS,
      titulo: "Actividad sin descripción",
      descripcion: "   ",
    });

    const bodyEnviado = vi.mocked(apiPlano.post).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(bodyEnviado).not.toHaveProperty("descripcion");
  });

  it("propaga el ApiError del backend sin envolverlo", async () => {
    const errorBackend = new ApiError("La clase no existe.", 404);
    vi.mocked(apiPlano.post).mockRejectedValue(errorBackend);

    await expect(crearActividad(DATOS_VALIDOS)).rejects.toBe(errorBackend);
  });
});

describe("publicarActividad", () => {
  it("publica con POST /activities/:id/publicar y mapea la respuesta", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue({
      ...ACTIVIDAD_BACKEND,
      estado: "published",
      publicadaEn: "2026-10-12T11:00:00.000Z",
      actualizadoEn: "2026-10-12T11:00:00.000Z",
    });

    const publicada = await publicarActividad("10");

    expect(apiPlano.post).toHaveBeenCalledWith("activities/10/publicar", {});
    expect(publicada.estado).toBe("published");
    expect(publicada.publicadaEn).toBe("2026-10-12T11:00:00.000Z");
    expect(publicada.id).toBe("10");
    expect(publicada.creadaEn).toBe(ACTIVIDAD_BACKEND.creadoEn);
  });

  it("no pre-comprueba estados: el 409 del backend se propaga como ApiError", async () => {
    const errorBackend = new ApiError(
      "La actividad ya está publicada; no puede volver a borrador.",
      409,
    );
    vi.mocked(apiPlano.post).mockRejectedValue(errorBackend);

    await expect(publicarActividad("10")).rejects.toBe(errorBackend);
    expect(apiPlano.post).toHaveBeenCalledWith("activities/10/publicar", {});
  });

  it("no pre-comprueba existencia: el 404 del backend se propaga como ApiError", async () => {
    const errorBackend = new ApiError(
      "No se encontró el recurso solicitado.",
      404,
    );
    vi.mocked(apiPlano.post).mockRejectedValue(errorBackend);

    await expect(publicarActividad("no-existe")).rejects.toBe(errorBackend);
  });
});

describe("obtenerActividad", () => {
  it("mapea la respuesta del backend (ActividadRespuestaDto → Actividad)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ACTIVIDAD_BACKEND);

    const actividad = await obtenerActividad("10");

    expect(apiPlano.get).toHaveBeenCalledWith("activities/10");
    expect(actividad).toEqual(ACTIVIDAD_ESPERADA);
  });

  it("devuelve null cuando el backend responde 404", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(
      new ApiError("No se encontró el recurso solicitado.", 404),
    );

    await expect(obtenerActividad("no-existe")).resolves.toBeNull();
  });

  it("propaga los errores que no son 404", async () => {
    const errorBackend = new ApiError("Error interno del servidor.", 500);
    vi.mocked(apiPlano.get).mockRejectedValue(errorBackend);

    await expect(obtenerActividad("10")).rejects.toBe(errorBackend);
  });
});

describe("listarActividades", () => {
  it("mapea filas del listado sin preguntas y filtra las eliminadas", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        FILA_LISTADO_BACKEND,
        {
          ...FILA_LISTADO_BACKEND,
          id: "11",
          titulo: "Actividad borrada",
          estado: "deleted" as EstadoActividad,
        },
      ],
      meta: { total: 2, page: 1, limit: 20 },
    });

    const lista = await listarActividades("5");

    expect(api.get).toHaveBeenCalledWith("classes/5/activities");
    expect(lista).toEqual([
      {
        id: "10",
        claseId: "5",
        titulo: "Repaso de geografía",
        descripcion: null,
        recompensaMonedas: 120,
        estado: "draft",
        preguntas: [],
        publicadaEn: null,
        cierraEn: null,
        creadaEn: FILA_LISTADO_BACKEND.creadoEn,
        actualizadaEn: FILA_LISTADO_BACKEND.creadoEn,
      },
    ]);
  });

  it("devuelve [] cuando todas las filas están eliminadas", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ ...FILA_LISTADO_BACKEND, estado: "deleted" as EstadoActividad }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    await expect(listarActividades("5")).resolves.toEqual([]);
  });

  it("propaga el ApiError del backend sin envolverlo", async () => {
    const errorBackend = new ApiError(
      "No se encontró el recurso solicitado.",
      404,
    );
    vi.mocked(api.get).mockRejectedValue(errorBackend);

    await expect(listarActividades("no-existe")).rejects.toBe(errorBackend);
  });
});

describe("actualizarActividad", () => {
  it("rechaza un JSONB inválido con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      actualizarActividad("10", {
        preguntas: [
          {
            type: "test",
            position: 1,
            prompt: "Solo una opción",
            score: 5,
            options: [{ text: "Única", is_correct: true }],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.patch).not.toHaveBeenCalled();
  });

  it("rechaza un título inválido con ApiError 422 sin invocar el transporte", async () => {
    await expect(
      actualizarActividad("10", { titulo: "   " }),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.patch).not.toHaveBeenCalled();
  });

  it("envía solo los campos definidos y mapea la respuesta", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue({
      ...ACTIVIDAD_BACKEND,
      titulo: "Título corregido",
      recompensaMonedas: 50,
      actualizadoEn: "2026-10-12T12:00:00.000Z",
    });

    const actualizada = await actualizarActividad("10", {
      titulo: "Título corregido",
      recompensaMonedas: 50,
    });

    expect(apiPlano.patch).toHaveBeenCalledWith("activities/10", {
      titulo: "Título corregido",
      recompensaMonedas: 50,
    });
    expect(actualizada.titulo).toBe("Título corregido");
    expect(actualizada.recompensaMonedas).toBe(50);
    expect(actualizada.creadaEn).toBe(ACTIVIDAD_BACKEND.creadoEn);
  });

  it("las preguntas del parche se renumeran 1..n antes de enviarlas", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue(ACTIVIDAD_BACKEND);

    await actualizarActividad("10", {
      preguntas: [
        {
          type: "completion",
          position: 5,
          prompt: "2 + 2 = ___",
          score: 3,
          expected_answer: "4",
        },
      ],
    });

    expect(apiPlano.patch).toHaveBeenCalledWith("activities/10", {
      preguntas: [
        {
          type: "completion",
          position: 1,
          prompt: "2 + 2 = ___",
          score: 3,
          expected_answer: "4",
        },
      ],
    });
  });

  it("una descripción vacía SÍ viaja como \"\" (limpia la descripción)", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue({
      ...ACTIVIDAD_BACKEND,
      descripcion: null,
    });

    await actualizarActividad("10", { descripcion: "   " });

    expect(apiPlano.patch).toHaveBeenCalledWith("activities/10", {
      descripcion: "",
    });
  });

  it("sin descripción en el parche, el body no toca ese campo", async () => {
    vi.mocked(apiPlano.patch).mockResolvedValue(ACTIVIDAD_BACKEND);

    await actualizarActividad("10", { titulo: "Solo el título" });

    const bodyEnviado = vi.mocked(apiPlano.patch).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(bodyEnviado).not.toHaveProperty("descripcion");
  });

  it("no pre-comprueba estados: el 409 del backend se propaga como ApiError", async () => {
    const errorBackend = new ApiError(
      "La actividad ya está publicada y no se puede editar.",
      409,
    );
    vi.mocked(apiPlano.patch).mockRejectedValue(errorBackend);

    await expect(
      actualizarActividad("10", { titulo: "Intento de edición" }),
    ).rejects.toBe(errorBackend);
  });

  it("no pre-comprueba existencia: el 404 del backend se propaga como ApiError", async () => {
    const errorBackend = new ApiError(
      "No se encontró el recurso solicitado.",
      404,
    );
    vi.mocked(apiPlano.patch).mockRejectedValue(errorBackend);

    await expect(
      actualizarActividad("no-existe", { titulo: "Nada" }),
    ).rejects.toBe(errorBackend);
  });
});
