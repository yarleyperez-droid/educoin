/**
 * Tests del contrato zod de las actividades (T5.6.2, PRO-386).
 *
 * Cubren el plan §4 (tests 1–7): formas válidas del JSONB `questions`,
 * reglas de `test`/`completion`, límites de `score`/`position`, array vacío
 * y el normalizador de posiciones. Se añaden dos casos extra: el tipo
 * `file` (tipado sin UI) y el formato del mensaje en español.
 *
 * Entorno: Vitest en node (sin DOM); zod no necesita navegador.
 */

import { describe, expect, it } from "vitest";

import {
  mensajeDeErroresZod,
  normalizarPosiciones,
  PreguntasSchema,
  type Pregunta,
} from "./actividades";

/** Pregunta `test` válida de ejemplo (2 opciones, 1 correcta). */
const PREGUNTA_TEST_VALIDA: Pregunta = {
  type: "test",
  position: 1,
  prompt: "¿Cuál es la capital de Colombia?",
  score: 10,
  options: [
    { text: "Bogotá", is_correct: true },
    { text: "Cali", is_correct: false },
  ],
};

/** Pregunta `completion` válida de ejemplo. */
const PREGUNTA_COMPLETION_VALIDA: Pregunta = {
  type: "completion",
  position: 2,
  prompt: "El agua hierve a ___ °C.",
  score: 5,
  expected_answer: "100",
};

describe("PreguntasSchema", () => {
  it("acepta una pregunta test con 2 opciones y una correcta", () => {
    const resultado = PreguntasSchema.safeParse([PREGUNTA_TEST_VALIDA]);

    expect(resultado.success).toBe(true);
  });

  it("acepta un array mixto test + completion", () => {
    const resultado = PreguntasSchema.safeParse([
      PREGUNTA_TEST_VALIDA,
      PREGUNTA_COMPLETION_VALIDA,
    ]);

    expect(resultado.success).toBe(true);
  });

  it("rechaza una pregunta test con una sola opción", () => {
    const pregunta: Pregunta = {
      ...PREGUNTA_TEST_VALIDA,
      options: [{ text: "Única", is_correct: true }],
    };

    const resultado = PreguntasSchema.safeParse([pregunta]);

    expect(resultado.success).toBe(false);
  });

  it("rechaza una pregunta test sin ninguna opción correcta", () => {
    const pregunta: Pregunta = {
      ...PREGUNTA_TEST_VALIDA,
      options: [
        { text: "A", is_correct: false },
        { text: "B", is_correct: false },
      ],
    };

    const resultado = PreguntasSchema.safeParse([pregunta]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(JSON.stringify(resultado.error.issues)).toContain(
        "correcta",
      );
    }
  });

  it("rechaza una pregunta completion sin expected_answer", () => {
    const pregunta = {
      type: "completion",
      position: 1,
      prompt: "Completa",
      score: 5,
      expected_answer: "   ",
    } as const;

    const resultado = PreguntasSchema.safeParse([pregunta]);

    expect(resultado.success).toBe(false);
  });

  it("rechaza puntuación negativa y posición cero", () => {
    const scoreNegativo = PreguntasSchema.safeParse([
      { ...PREGUNTA_TEST_VALIDA, score: -1 },
    ]);
    const posicionCero = PreguntasSchema.safeParse([
      { ...PREGUNTA_TEST_VALIDA, position: 0 },
    ]);

    expect(scoreNegativo.success).toBe(false);
    expect(posicionCero.success).toBe(false);
  });

  it("rechaza un array de preguntas vacío", () => {
    const resultado = PreguntasSchema.safeParse([]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toContain("al menos una");
    }
  });

  it("acepta el tipo file (tipado sin UI en esta tarea)", () => {
    const pregunta: Pregunta = {
      type: "file",
      position: 1,
      prompt: "Sube tu informe",
      score: 20,
    };

    const resultado = PreguntasSchema.safeParse([pregunta]);

    expect(resultado.success).toBe(true);
  });

  it("rechaza un enunciado vacío", () => {
    const resultado = PreguntasSchema.safeParse([
      { ...PREGUNTA_TEST_VALIDA, prompt: "   " },
    ]);

    expect(resultado.success).toBe(false);
  });
});

describe("normalizarPosiciones", () => {
  it("renumera las posiciones 1..n según el orden", () => {
    const preguntas: Pregunta[] = [
      { ...PREGUNTA_TEST_VALIDA, position: 7 },
      { ...PREGUNTA_COMPLETION_VALIDA, position: 3 },
      { ...PREGUNTA_TEST_VALIDA, position: 99 },
    ];

    const normalizadas = normalizarPosiciones(preguntas);

    expect(normalizadas.map((p) => p.position)).toEqual([1, 2, 3]);
    // No muta la entrada (devuelve copia).
    expect(preguntas[0].position).toBe(7);
    // Conserva el contenido de cada pregunta.
    expect(normalizadas[1]).toMatchObject({ type: "completion" });
  });
});

describe("mensajeDeErroresZod", () => {
  it("formatea un único problema con su campo", () => {
    const resultado = PreguntasSchema.safeParse([]);

    expect(resultado.success).toBe(false);

    if (!resultado.success) {
      const mensaje = mensajeDeErroresZod(resultado.error.issues);

      expect(mensaje).toContain("al menos una");
      expect(typeof mensaje).toBe("string");
    }
  });

  it("resume varios problemas indicando cuántos quedan", () => {
    const resultado = PreguntasSchema.safeParse([
      { ...PREGUNTA_TEST_VALIDA, prompt: "" },
      { ...PREGUNTA_COMPLETION_VALIDA, expected_answer: "" },
    ]);

    expect(resultado.success).toBe(false);

    if (!resultado.success) {
      const mensaje = mensajeDeErroresZod(resultado.error.issues);

      expect(mensaje).toContain("(+");
    }
  });
});
