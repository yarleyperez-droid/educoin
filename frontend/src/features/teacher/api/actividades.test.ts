/**
 * Tests de la fachada de actividades (T5.6.2, PRO-386).
 *
 * Cubren el plan §4 (tests 8–11 y extras): creación en `draft` con JSONB
 * validado, rechazo del JSONB inválido sin persistir, transición
 * `draft → published` y la ausencia de reversión (CA 3 de H5.6).
 *
 * Entorno: Vitest en node (sin DOM); el mock no usa `fetch` todavía
 * (T5.6.4 lo stubbeará cuando existan los endpoints de H3.3).
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import type { Pregunta } from "../contrato/actividades";

import { crearActividad, publicarActividad } from "./actividades";
import { listarActividadesMock } from "./actividades-mock";

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
  claseId: "mock-clase-seed",
  titulo: "Repaso de geografía",
  descripcion: "Cuestionario corto de la unidad 1",
  recompensaMonedas: 120,
  preguntas: [PREGUNTA_TEST],
};

describe("crearActividad", () => {
  it("crea una actividad válida en estado draft con posiciones normalizadas", async () => {
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

    expect(creada.estado).toBe("draft");
    expect(creada.publicadaEn).toBeNull();
    expect(creada.titulo).toBe(DATOS_VALIDOS.titulo);
    expect(creada.recompensaMonedas).toBe(120);
    expect(creada.preguntas.map((p) => p.position)).toEqual([1, 2]);
    expect(creada.id).not.toBe("");
  });

  it("rechaza un JSONB inválido con ApiError 422 sin persistir nada", async () => {
    const antes = listarActividadesMock().length;

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

    expect(listarActividadesMock().length).toBe(antes);
  });

  it("rechaza un título vacío con ApiError 422", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, titulo: "   " }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rechaza una recompensa negativa con ApiError 422", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, recompensaMonedas: -1 }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rechaza un array de preguntas vacío con ApiError 422", async () => {
    await expect(
      crearActividad({ ...DATOS_VALIDOS, preguntas: [] }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("descarta la descripción en blanco (queda null)", async () => {
    const creada = await crearActividad({
      ...DATOS_VALIDOS,
      titulo: "Actividad sin descripción",
      descripcion: "   ",
    });

    expect(creada.descripcion).toBeNull();
  });
});

describe("publicarActividad", () => {
  it("publica una actividad en draft y fija publicadaEn", async () => {
    const creada = await crearActividad({
      ...DATOS_VALIDOS,
      titulo: "Actividad por publicar",
    });

    expect(creada.estado).toBe("draft");

    const publicada = await publicarActividad(creada.id);

    expect(publicada.estado).toBe("published");
    expect(publicada.publicadaEn).not.toBeNull();
    expect(publicada.id).toBe(creada.id);
    expect(publicada.titulo).toBe(creada.titulo);
  });

  it("no permite publicar dos veces (sin reversión ni doble publicación)", async () => {
    const creada = await crearActividad({
      ...DATOS_VALIDOS,
      titulo: "Actividad ya publicada",
    });

    await publicarActividad(creada.id);

    const segundoIntento = publicarActividad(creada.id);

    await expect(segundoIntento).rejects.toBeInstanceOf(ApiError);
    await expect(segundoIntento).rejects.toMatchObject({ status: 409 });
  });

  it("responde ApiError 404 para una actividad inexistente", async () => {
    await expect(publicarActividad("no-existe")).rejects.toMatchObject({
      status: 404,
    });
  });
});
