/**
 * Tests de la fachada del estudiante (T5.8.1 → T5.8.4, PRO-397).
 *
 * Desde T5.8.4 la fachada habla con la API real de H3.3, así que estos
 * tests **mockean el transporte** (`@/lib/api-client`) con los shapes
 * verificados en `test/activities.e2e-spec.ts` y cubren:
 * - {@link listarPublicadas}: `[]` documentado (el listado real exige un
 *   `inscripcionId` que el frontend no tiene);
 * - {@link obtenerParaEstudiante}: mapeo backend → contrato, `404` →
 *   `null`, propagación del resto de errores;
 * - el más importante: **el JSON de la actividad segura no contiene
 *   `is_correct` ni `expected_answer`** en ninguna profundidad — defensa
 *   en profundidad del mapper (H3.3 ya sanitiza por rol).
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

import { listarPublicadas, obtenerParaEstudiante } from "./actividades-estudiante";

/**
 * `ActividadEstudianteRespuestaDto` de H3.3 tal cual sale del backend
 * (preguntas ya sanitizadas por rol, e2e).
 */
const ACTIVIDAD_BACKEND = {
  id: "7",
  claseId: "3",
  titulo: "Cuestionario de fracciones",
  descripcion: "Resuelve las operaciones.",
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
  cierraEn: null,
  creadoEn: "2026-10-11T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarPublicadas", () => {
  it("devuelve [] sin invocar el transporte mientras el listado requiera inscripcionId", async () => {
    const lista = await listarPublicadas();

    expect(lista).toEqual([]);
    expect(apiPlano.get).not.toHaveBeenCalled();
    expect(apiPlano.post).not.toHaveBeenCalled();
    expect(apiPlano.put).not.toHaveBeenCalled();
  });
});

describe("obtenerParaEstudiante", () => {
  it("mapea el DTO del estudiante al contrato (solo claves permitidas)", async () => {
    vi.mocked(apiPlano.get).mockResolvedValue(ACTIVIDAD_BACKEND);

    const actividad = await obtenerParaEstudiante("7");

    expect(apiPlano.get).toHaveBeenCalledWith("activities/7");
    expect(actividad).toEqual({
      id: "7",
      claseId: "3",
      titulo: "Cuestionario de fracciones",
      descripcion: "Resuelve las operaciones.",
      recompensaMonedas: 120,
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
    });
  });

  it("traduce el 404 a null (no existe, no publicada o sin inscripción)", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(new ApiError("Recurso no encontrado", 404));

    expect(await obtenerParaEstudiante("999")).toBeNull();
  });

  it("propaga los errores que no son 404", async () => {
    vi.mocked(apiPlano.get).mockRejectedValue(new ApiError("Sesión expirada", 401));

    await expect(obtenerParaEstudiante("7")).rejects.toMatchObject({ status: 401 });
  });

  it("el JSON de la actividad no contiene secretos ni siquiera por accidente", async () => {
    // Un backend que llegara a filtrar secretos: el mapper copia solo las
    // claves permitidas, así que no pasan a la vista.
    vi.mocked(apiPlano.get).mockResolvedValue({
      ...ACTIVIDAD_BACKEND,
      preguntas: [
        {
          ...ACTIVIDAD_BACKEND.preguntas[0],
          expected_answer: "Bogotá",
          options: [{ text: "Bogotá", is_correct: true }, { text: "Cali", is_correct: false }],
        },
        {
          ...ACTIVIDAD_BACKEND.preguntas[1],
          expected_answer: "100",
        },
      ],
    });

    const actividad = await obtenerParaEstudiante("7");
    const serializado = JSON.stringify(actividad);

    expect(serializado).toContain("Bogotá"); // el texto sí está
    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
  });
});
