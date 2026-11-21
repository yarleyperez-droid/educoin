/**
 * Tests del contrato seguro del cuestionario (T5.8.1, PRO-394).
 *
 * Verifican que la proyección para el estudiante acepta la forma sin
 * secretos y —defensa en profundidad— que **cualquier clave extra**
 * (como `is_correct` o `expected_answer`) queda **fuera** del resultado
 * del parseo (el default de zod elimina claves desconocidas).
 */

import { describe, expect, it } from "vitest";

import {
  PreguntaEstudianteSchema,
  type PreguntaEstudiante,
} from "./cuestionario";

/** Pregunta segura de ejemplo. */
const PREGUNTA_SEGURA: PreguntaEstudiante = {
  position: 1,
  type: "test",
  prompt: "¿Cuál es la capital de Colombia?",
  score: 10,
  options: [{ text: "Bogotá" }, { text: "Cali" }],
};

describe("PreguntaEstudianteSchema", () => {
  it("acepta la forma segura de una pregunta test", () => {
    const resultado = PreguntaEstudianteSchema.safeParse(PREGUNTA_SEGURA);

    expect(resultado.success).toBe(true);
  });

  it("acepta completion sin options", () => {
    const resultado = PreguntaEstudianteSchema.safeParse({
      position: 2,
      type: "completion",
      prompt: "El agua hierve a ___ °C.",
      score: 5,
    });

    expect(resultado.success).toBe(true);
  });

  it("elimina claves secretas si llegaran por accidente", () => {
    const resultado = PreguntaEstudianteSchema.parse({
      ...PREGUNTA_SEGURA,
      expected_answer: "Bogotá",
      options: [{ text: "Bogotá", is_correct: true }],
    });

    expect(resultado).not.toHaveProperty("expected_answer");
    expect(JSON.stringify(resultado)).not.toContain("is_correct");
    expect(JSON.stringify(resultado)).not.toContain("expected_answer");
  });

  it("rechaza una posición no entera o negativa", () => {
    expect(
      PreguntaEstudianteSchema.safeParse({ ...PREGUNTA_SEGURA, position: 0 })
        .success,
    ).toBe(false);
    expect(
      PreguntaEstudianteSchema.safeParse({ ...PREGUNTA_SEGURA, position: 1.5 })
        .success,
    ).toBe(false);
  });
});
