/**
 * Tests de la fachada de entregas (T5.8.2 → T5.8.4, PRO-397).
 *
 * Desde T5.8.4 la fachada habla con la API real de H3.4, así que estos
 * tests **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados en `test/submissions.e2e-spec.ts` y cubren:
 * - la validación de cliente (zod + coherencia, `ApiError` 422/404)
 *   **sin invocar** el transporte de escritura;
 * - el mapeo backend → tipo `Entrega` (respuestas saneadas sin veredicto
 *   y `resultado` derivado de `is_correct`/`score`);
 * - la propagación de los errores del backend (`ApiError` tal cual — el
 *   409 del doble envío llega con su mensaje, sin pre-comprobación);
 * - `obtenerEntrega`: `404` → `null`;
 * - `consultarAutoCalificacion`: lectura idempotente del estado (ya no
 *   simula un job asíncrono);
 * - `guardarBorrador`: autosave parcial o vacío por `PUT`.
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
    apiPlano: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
  };
});

import { apiPlano, ApiError } from "@/lib/api-client";

import {
  consultarAutoCalificacion,
  enviarRespuestas,
  guardarBorrador,
  obtenerEntrega,
} from "./entregas";

/**
 * `ActividadEstudianteRespuestaDto` de H3.3 (sanitizada): dos preguntas,
 * una `test` y una `completion`. La fachada la usa para la coherencia.
 */
const ACTIVIDAD_BACKEND = {
  id: "7",
  claseId: "3",
  titulo: "Cuestionario de fracciones",
  descripcion: null,
  recompensaMonedas: 120,
  estado: "published",
  preguntas: [
    {
      position: 1,
      type: "test",
      prompt: "¿Cuál es la capital de Colombia?",
      score: 10,
      options: [{ text: "Bogotá" }, { text: "Cali" }],
    },
    {
      position: 2,
      type: "completion",
      prompt: "El agua hierve a ___ °C.",
      score: 5,
    },
  ],
  publicadaEn: "2026-10-12T10:00:00.000Z",
};

/** Respuestas completas válidas (ambas correctas según los veredictos). */
const RESPUESTAS_COMPLETAS = [
  { question_position: 1, option: "Bogotá" },
  { question_position: 2, text: "100" },
];

/** `EntregaBorradorRespuestaDto` de H3.4: sin veredictos. */
const BORRADOR_BACKEND = {
  id: "40",
  actividadId: "7",
  estado: "in_progress",
  entregadoEn: null,
  puntaje: null,
  monedasOtorgadas: 0,
  respuestas: [{ question_position: 1, option: "Bogotá" }],
};

/** `EntregaRespuestaDto` de H3.4 calificada: con veredicto por respuesta. */
const ENTREGA_CALIFICADA_BACKEND = {
  id: "41",
  actividadId: "7",
  estado: "graded",
  entregadoEn: "2026-10-12T10:05:00.000Z",
  puntaje: 15,
  monedasOtorgadas: 120,
  feedback: "Buen trabajo; revisa el paso 2.",
  respuestas: [
    { question_position: 1, option: "Bogotá", is_correct: true, score: 10 },
    { question_position: 2, text: "100", is_correct: true, score: 5 },
  ],
};

/** Misma entrega bajo el umbral: veredictos sí, calificación no. */
const ENTREGA_PENDIENTE_BACKEND = {
  ...ENTREGA_CALIFICADA_BACKEND,
  id: "42",
  estado: "submitted",
  puntaje: null,
  monedasOtorgadas: 0,
  feedback: null,
  respuestas: [
    { question_position: 1, option: "Cali", is_correct: false, score: 0 },
    { question_position: 2, text: "100", is_correct: true, score: 5 },
  ],
};

/** `EntregaCreadaRespuestaDto` de H3.4: `{ mensaje, entrega }` en plano. */
const ENTREGA_CREADA_BACKEND = {
  mensaje: "Entrega calificada.",
  entrega: ENTREGA_CALIFICADA_BACKEND,
};

/** `BorradorGuardadoRespuestaDto` de H3.4: `{ mensaje, entrega }` plano. */
const BORRADOR_GUARDADO_BACKEND = {
  mensaje: "Borrador guardado.",
  entrega: BORRADOR_BACKEND,
};

/** `404` estándar anti-enumeración del backend. */
const error404 = new ApiError("Recurso no encontrado", 404);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiPlano.get).mockResolvedValue(ACTIVIDAD_BACKEND);
});

describe("enviarRespuestas", () => {
  it("envía el JSONB y mapea la entrega calificada (resultado desde los veredictos)", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(ENTREGA_CREADA_BACKEND);

    const entrega = await enviarRespuestas("7", RESPUESTAS_COMPLETAS);

    expect(apiPlano.post).toHaveBeenCalledWith("activities/7/submissions", {
      respuestas: RESPUESTAS_COMPLETAS,
    });
    expect(entrega).toEqual({
      id: "41",
      actividadId: "7",
      estado: "graded",
      respuestas: RESPUESTAS_COMPLETAS,
      enviadaEn: "2026-10-12T10:05:00.000Z",
      puntaje: 15,
      monedasOtorgadas: 120,
      retroalimentacion: "Buen trabajo; revisa el paso 2.",
      resultado: [
        { question_position: 1, correcta: true, puntos: 10 },
        { question_position: 2, correcta: true, puntos: 5 },
      ],
    });
  });

  it("la entrega mapeada no expone los veredictos del JSONB", async () => {
    vi.mocked(apiPlano.post).mockResolvedValue(ENTREGA_CREADA_BACKEND);

    const entrega = await enviarRespuestas("7", RESPUESTAS_COMPLETAS);
    const serializado = JSON.stringify(entrega);

    expect(serializado).toContain("correcta"); // el resultado sí se ve
    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
  });

  it("propaga el 409 del backend en el doble envío (sin pre-comprobar)", async () => {
    vi.mocked(apiPlano.post).mockRejectedValue(
      new ApiError("Ya enviaste esta actividad.", 409),
    );

    const intento = enviarRespuestas("7", RESPUESTAS_COMPLETAS);

    await expect(intento).rejects.toBeInstanceOf(ApiError);
    await expect(intento).rejects.toMatchObject({ status: 409 });
  });

  it("responde 404 para una actividad inexistente o no publicada", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(error404);

    await expect(
      enviarRespuestas("no-existe", RESPUESTAS_COMPLETAS),
    ).rejects.toMatchObject({ status: 404 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("responde 422 si el array de respuestas está vacío sin invocar el POST", async () => {
    await expect(enviarRespuestas("7", [])).rejects.toMatchObject({
      status: 422,
    });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("responde 422 si una respuesta no tiene text ni option", async () => {
    await expect(
      enviarRespuestas("7", [
        { question_position: 1 },
        { question_position: 2, text: "100" },
      ]),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("responde 422 si falta una respuesta y no persiste nada", async () => {
    const intento = enviarRespuestas("7", [
      { question_position: 1, option: "Bogotá" }, // falta la 2
    ]);

    await expect(intento).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("responde 422 si la opción no pertenece a la pregunta", async () => {
    await expect(
      enviarRespuestas("7", [
        { question_position: 1, option: "Medellín" }, // no existe
        { question_position: 2, text: "100" },
      ]),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("responde 422 si una posición no corresponde a ninguna pregunta", async () => {
    await expect(
      enviarRespuestas("7", [
        ...RESPUESTAS_COMPLETAS,
        { question_position: 99, text: "extra" },
      ]),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.post).not.toHaveBeenCalled();
  });
});

describe("guardarBorrador", () => {
  it("guarda respuestas parciales por PUT y devuelve el borrador mapeado", async () => {
    vi.mocked(apiPlano.put).mockResolvedValue(BORRADOR_GUARDADO_BACKEND);

    const borrador = await guardarBorrador("7", [
      { question_position: 1, option: "Bogotá" },
    ]);

    expect(apiPlano.put).toHaveBeenCalledWith("activities/7/submissions", {
      respuestas: [{ question_position: 1, option: "Bogotá" }],
    });
    expect(borrador).toEqual({
      id: "40",
      actividadId: "7",
      estado: "in_progress",
      respuestas: [{ question_position: 1, option: "Bogotá" }],
      enviadaEn: null,
      puntaje: null,
      monedasOtorgadas: 0,
      retroalimentacion: null,
      resultado: null,
    });
  });

  it("admite el arreglo vacío (el estudiante recién abre la actividad)", async () => {
    vi.mocked(apiPlano.put).mockResolvedValue({
      mensaje: "Borrador guardado.",
      entrega: { ...BORRADOR_BACKEND, respuestas: [] },
    });

    const borrador = await guardarBorrador("7", []);

    expect(apiPlano.put).toHaveBeenCalledWith("activities/7/submissions", {
      respuestas: [],
    });
    expect(borrador.respuestas).toEqual([]);
  });

  it("responde 422 si una respuesta individual no cumple el contrato", async () => {
    await expect(
      guardarBorrador("7", [{ question_position: 1 }]),
    ).rejects.toMatchObject({ status: 422 });
    expect(apiPlano.put).not.toHaveBeenCalled();
  });
});

describe("obtenerEntrega", () => {
  it("devuelve el borrador tal cual (sin veredictos ni fecha de envío)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(BORRADOR_BACKEND);

    const entrega = await obtenerEntrega("7");

    expect(apiPlano.get).toHaveBeenCalledWith("activities/7/submissions");
    expect(entrega).toEqual({
      id: "40",
      actividadId: "7",
      estado: "in_progress",
      respuestas: [{ question_position: 1, option: "Bogotá" }],
      enviadaEn: null,
      puntaje: null,
      monedasOtorgadas: 0,
      retroalimentacion: null,
      resultado: null,
    });
  });

  it("mapea la entrega enviada con resultado derivado y respuestas saneadas", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ENTREGA_CALIFICADA_BACKEND);

    const entrega = await obtenerEntrega("7");

    expect(entrega?.estado).toBe("graded");
    expect(entrega?.enviadaEn).toBe("2026-10-12T10:05:00.000Z");
    expect(entrega?.puntaje).toBe(15);
    expect(entrega?.monedasOtorgadas).toBe(120);
    expect(entrega?.respuestas).toEqual(RESPUESTAS_COMPLETAS);
    expect(entrega?.resultado).toEqual([
      { question_position: 1, correcta: true, puntos: 10 },
      { question_position: 2, correcta: true, puntos: 5 },
    ]);
    expect(entrega?.retroalimentacion).toBe("Buen trabajo; revisa el paso 2.");
  });

  it("mapea el feedback del backend a retroalimentacion (T5.9.3)", async () => {
    // H3.5 sí expone `feedback` en EntregaRespuestaDto: la vista de T5.8.3
    // debe mostrarlo tal cual (antes la fachada lo descartaba y el
    // estudiante veía "Aún sin retroalimentación." aunque el profesor
    // hubiera escrito comentarios).
    vi.mocked(apiPlano.get).mockResolvedValue(ENTREGA_CALIFICADA_BACKEND);

    const entrega = await obtenerEntrega("7");

    expect(entrega?.retroalimentacion).toBe("Buen trabajo; revisa el paso 2.");
  });

  it("conserva retroalimentacion null cuando el backend no envía feedback", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ENTREGA_PENDIENTE_BACKEND);

    const entrega = await obtenerEntrega("7");

    expect(entrega?.estado).toBe("submitted");
    expect(entrega?.retroalimentacion).toBeNull();
  });

  it("devuelve null cuando todavía no hay entrega (404)", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(error404);

    expect(await obtenerEntrega("7")).toBeNull();
  });
});

describe("consultarAutoCalificacion", () => {
  it("lee el estado actual sin mutar nada (idempotente)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ENTREGA_CALIFICADA_BACKEND);

    const primera = await consultarAutoCalificacion("7");
    const segunda = await consultarAutoCalificacion("7");

    expect(segunda).toEqual(primera);
    expect(apiPlano.get).toHaveBeenCalledTimes(2);
    expect(apiPlano.get).toHaveBeenCalledWith("activities/7/submissions");
    expect(apiPlano.put).not.toHaveBeenCalled();
    expect(apiPlano.post).not.toHaveBeenCalled();
  });

  it("devuelve submitted tal cual cuando espera al profesor (bajo el umbral)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ENTREGA_PENDIENTE_BACKEND);

    const entrega = await consultarAutoCalificacion("7");

    expect(entrega.estado).toBe("submitted");
    expect(entrega.puntaje).toBeNull();
    expect(entrega.monedasOtorgadas).toBe(0);
    // Los veredictos de la auto-evaluación sí se derivan; la vista solo
    // los pinta cuando el estado es "graded".
    expect(entrega.resultado).toEqual([
      { question_position: 1, correcta: false, puntos: 0 },
      { question_position: 2, correcta: true, puntos: 5 },
    ]);
  });

  it("responde 404 si no hay entrega", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(error404);

    await expect(consultarAutoCalificacion("7")).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(consultarAutoCalificacion("7")).rejects.toMatchObject({
      status: 404,
    });
  });
});
