/**
 * Tests de la fachada de entregas del profesor: cola (T5.9.1, PRO-399)
 * y vista de revisión/calificación (T5.9.2, PRO-400).
 *
 * La fachada habla con la API real de H3.5, así que estos tests
 * **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados de H3.5 (`aEntregaCola` + `ListadoEntregasDto` para la
 * cola; `EntregaDetalleProfesorDto` + `CalificacionRespuestaDto` para la
 * revisión) y cubren:
 *
 * Cola — tests 1–5 del plan §3 de 035:
 * 1. `{ data, meta }` válido → `ColaEntregas` con IDs `string`.
 * 2. Query con `estado` cuando el filtro ≠ `"todas"`; sin `estado` con `"todas"`.
 * 3. Fila con `puntaje: null` y `entregadoEn: null` pasa el zod sin forzar defaults.
 * 4. `ApiError` del backend se propaga sin enmascarar.
 * 5. Payload que viola el esquema → `ApiError` 422 con `mensajeDeErroresZod`.
 *
 * Revisión — tests 1–5 del plan §3 de 036:
 * 1. Detalle plano con `null` → `EntregaDetalle` con ids `string`.
 * 2. `obtenerEntrega` 404 → `null`.
 * 3. `calificarEntrega` `graded` envía el body correcto y devuelve `entrega`.
 * 4. `CalificacionSchema` rechaza `graded` sin puntaje y `rejected` con
 *    puntaje (422 de zod, **sin invocar el transporte**).
 * 5. `calificarEntrega` 409 propaga el `ApiError` con el mensaje del backend.
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

import type { EntregaDetalle, FilaCola } from "../contrato/entregas";

import { calificarEntrega, listarCola, obtenerEntrega } from "./entregas";

/** `EntregaColaDto` de H3.5 tal cual sale del backend (ids string). */
const FILA_BACKEND = {
  id: "71",
  estudiante: {
    id: "13",
    usuario: "ana.garcia",
    nombre: "Ana",
    apellido: "García",
  },
  estado: "submitted" as FilaCola["estado"],
  entregadoEn: "2026-10-18T15:30:00.000Z",
  puntaje: 8.5,
  monedasOtorgadas: 0,
};

/** Traducción esperada de {@link FILA_BACKEND} al tipo `FilaCola`. */
const FILA_ESPERADA: FilaCola = {
  id: "71",
  estudiante: {
    id: "13",
    usuario: "ana.garcia",
    nombre: "Ana",
    apellido: "García",
  },
  estado: "submitted",
  entregadoEn: "2026-10-18T15:30:00.000Z",
  puntaje: 8.5,
  monedasOtorgadas: 0,
};

/** Envoltura `{ data, meta }` de la cola con una fila válida. */
const COLA_BACKEND = {
  data: [FILA_BACKEND],
  meta: { total: 1, page: 1, limit: 20 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarCola", () => {
  it("mapea { data, meta } válido a ColaEntregas con ids string", async () => {
    vi.mocked(api.get).mockResolvedValue(COLA_BACKEND);

    const cola = await listarCola("7", { page: 1, limit: 20, estado: "todas" });

    expect(cola).toEqual({
      data: [FILA_ESPERADA],
      meta: { total: 1, page: 1, limit: 20 },
    });
    expect(typeof cola.data[0].id).toBe("string");
    expect(typeof cola.data[0].estudiante.id).toBe("string");
  });

  it("añade estado a la query solo cuando el filtro no es \"todas\"", async () => {
    vi.mocked(api.get).mockResolvedValue(COLA_BACKEND);

    await listarCola("7", { page: 2, limit: 20, estado: "submitted" });

    expect(api.get).toHaveBeenCalledWith(
      "activities/7/submissions/queue?page=2&limit=20&estado=submitted",
    );

    vi.mocked(api.get).mockClear();

    await listarCola("7", { page: 1, limit: 20, estado: "todas" });

    expect(api.get).toHaveBeenCalledWith(
      "activities/7/submissions/queue?page=1&limit=20",
    );
    expect(vi.mocked(api.get).mock.calls[0][0]).not.toContain("estado=");
  });

  it("conserva los null de puntaje y entregadoEn sin forzar defaults", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          ...FILA_BACKEND,
          estado: "in_progress" as FilaCola["estado"],
          entregadoEn: null,
          puntaje: null,
          monedasOtorgadas: 0,
        },
      ],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const cola = await listarCola("7", {
      page: 1,
      limit: 20,
      estado: "in_progress",
    });

    expect(cola.data[0].entregadoEn).toBeNull();
    expect(cola.data[0].puntaje).toBeNull();
    expect(cola.data[0].monedasOtorgadas).toBe(0);
  });

  it("propaga el ApiError del backend sin envolverlo", async () => {
    const errorBackend = new ApiError("No se encontró el recurso solicitado.", 404);
    vi.mocked(api.get).mockRejectedValue(errorBackend);

    await expect(
      listarCola("ajena", { page: 1, limit: 20, estado: "todas" }),
    ).rejects.toBe(errorBackend);

    const errorServidor = new ApiError("Error interno del servidor.", 500);
    vi.mocked(api.get).mockRejectedValue(errorServidor);

    await expect(
      listarCola("7", { page: 1, limit: 20, estado: "todas" }),
    ).rejects.toBe(errorServidor);
  });

  it("rechaza un payload que viola el esquema con ApiError 422 de mensajeDeErroresZod", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ ...FILA_BACKEND, estado: "cancelada" }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const intento = listarCola("7", { page: 1, limit: 20, estado: "todas" });

    await expect(intento).rejects.toBeInstanceOf(ApiError);
    await expect(intento).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("estado"),
    });
  });
});

/** `EntregaDetalleProfesorDto` de H3.5 con los `null` legítimos del contrato. */
const DETALLE_CON_NULLS = {
  id: "71",
  estudiante: {
    id: "13",
    usuario: "ana.garcia",
    nombre: "Ana",
    apellido: "García",
  },
  estado: "submitted" as EntregaDetalle["estado"],
  entregadoEn: "2026-10-18T15:30:00.000Z",
  calificadoEn: null,
  puntaje: null,
  monedasOtorgadas: 0,
  feedback: null,
  respuestas: [
    { question_position: 1, option: "3", is_correct: true, score: 5 },
    { question_position: 2, text: "4", is_correct: null, score: null },
    {
      question_position: 3,
      files: [{ path: "7/1/uuid.pdf", mime: "application/pdf", bytes: 12345 }],
    },
  ],
};

/** Traducción esperada de {@link DETALLE_CON_NULLS} al tipo `EntregaDetalle`. */
const DETALLE_ESPERADO: EntregaDetalle = {
  id: "71",
  estudiante: {
    id: "13",
    usuario: "ana.garcia",
    nombre: "Ana",
    apellido: "García",
  },
  estado: "submitted",
  entregadoEn: "2026-10-18T15:30:00.000Z",
  calificadoEn: null,
  puntaje: null,
  monedasOtorgadas: 0,
  feedback: null,
  respuestas: [
    { question_position: 1, option: "3", is_correct: true, score: 5 },
    { question_position: 2, text: "4", is_correct: null, score: null },
    {
      question_position: 3,
      files: [{ path: "7/1/uuid.pdf", mime: "application/pdf", bytes: 12345 }],
    },
  ],
};

/** `EntregaDetalleProfesorDto` ya calificada (lo que devuelve el POST de calificar). */
const DETALLE_CALIFICADA = {
  ...DETALLE_CON_NULLS,
  estado: "graded" as EntregaDetalle["estado"],
  calificadoEn: "2026-10-18T16:00:00.000Z",
  puntaje: 8.5,
  monedasOtorgadas: 5,
  feedback: "Bien, pero revisa la pregunta 3.",
};

/** `CalificacionRespuestaDto` de H3.5: `{ mensaje, entrega }` en plano. */
const CALIFICACION_RESPUESTA = {
  mensaje: "Entrega calificada: el estudiante ya puede ver el puntaje y tu retroalimentación.",
  entrega: DETALLE_CALIFICADA,
};

describe("obtenerEntrega", () => {
  it("mapea el detalle plano con nulls a EntregaDetalle con ids string", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(DETALLE_CON_NULLS);

    const detalle = await obtenerEntrega("7", "71");

    expect(detalle).toEqual(DETALLE_ESPERADO);
    expect(typeof detalle?.id).toBe("string");
    expect(typeof detalle?.estudiante.id).toBe("string");
    expect(detalle?.calificadoEn).toBeNull();
    expect(detalle?.puntaje).toBeNull();
    expect(detalle?.feedback).toBeNull();
    // Variante sin veredicto del JSONB (borrador sin evaluar): pasa tal cual.
    expect(detalle?.respuestas[2].is_correct).toBeUndefined();
    expect(detalle?.respuestas[2].score).toBeUndefined();
  });

  it("traduce el 404 del backend a null", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(
      new ApiError("No se encontró el recurso solicitado.", 404),
    );

    await expect(obtenerEntrega("7", "inexistente")).resolves.toBeNull();
    expect(apiPlano.get).toHaveBeenCalledWith(
      "activities/7/submissions/inexistente",
    );
  });
});

describe("calificarEntrega", () => {
  it("envía el body de graded y devuelve la entrega del POST", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(CALIFICACION_RESPUESTA);

    const entrega = await calificarEntrega("7", "71", {
      decision: "graded",
      puntaje: 8.5,
      feedback: "Bien, pero revisa la pregunta 3.",
    });

    expect(apiPlano.post).toHaveBeenCalledWith(
      "activities/7/submissions/71/calificar",
      { decision: "graded", puntaje: 8.5, feedback: "Bien, pero revisa la pregunta 3." },
    );
    expect(entrega).toEqual({
      ...DETALLE_ESPERADO,
      estado: "graded",
      calificadoEn: "2026-10-18T16:00:00.000Z",
      puntaje: 8.5,
      monedasOtorgadas: 5,
      feedback: "Bien, pero revisa la pregunta 3.",
    });
  });

  it("rechaza graded sin puntaje y rejected con puntaje sin invocar el transporte", async () => {
    const sinPuntaje = calificarEntrega("7", "71", { decision: "graded" });

    await expect(sinPuntaje).rejects.toBeInstanceOf(ApiError);
    await expect(sinPuntaje).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("puntaje"),
    });

    const rechazoConPuntaje = calificarEntrega("7", "71", {
      decision: "rejected",
      puntaje: 8.5,
    });

    await expect(rechazoConPuntaje).rejects.toBeInstanceOf(ApiError);
    await expect(rechazoConPuntaje).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("puntaje"),
    });

    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("propaga el ApiError 409 del backend sin envolverlo", async () => {
    const errorConflicto = new ApiError(
      "La entrega ya no está pendiente de calificación: solo las enviadas (submitted) pueden calificarse y el estado no se recalifica.",
      409,
    );
    vi.mocked(apiPlano.post).mockRejectedValue(errorConflicto);

    await expect(
      calificarEntrega("7", "71", { decision: "graded", puntaje: 8.5 }),
    ).rejects.toBe(errorConflicto);
  });
});
