/**
 * Tests del contrato de entregas (T5.8.2, PRO-395).
 *
 * Cubren el plan §3: formas válidas de `answers` (completion y test),
 * rechazo de respuestas vacías, array vacío y posiciones inválidas.
 */

import { describe, expect, it } from "vitest";

import { RespuestaSchema, RespuestasSchema } from "./entregas";

describe("RespuestaSchema", () => {
  it("acepta una respuesta de completion con text", () => {
    const resultado = RespuestaSchema.safeParse({
      question_position: 1,
      text: "100",
    });

    expect(resultado.success).toBe(true);
  });

  it("acepta una respuesta de test con option", () => {
    const resultado = RespuestaSchema.safeParse({
      question_position: 2,
      option: "Bogotá",
    });

    expect(resultado.success).toBe(true);
  });

  it("rechaza una respuesta sin text ni option", () => {
    const resultado = RespuestaSchema.safeParse({ question_position: 1 });

    expect(resultado.success).toBe(false);
  });

  it("rechaza respuestas con text en blanco", () => {
    const resultado = RespuestaSchema.safeParse({
      question_position: 1,
      text: "   ",
    });

    expect(resultado.success).toBe(false);
  });

  it("rechaza position cero o negativa", () => {
    expect(
      RespuestaSchema.safeParse({ question_position: 0, text: "x" }).success,
    ).toBe(false);
    expect(
      RespuestaSchema.safeParse({ question_position: -1, option: "x" })
        .success,
    ).toBe(false);
  });
});

describe("RespuestasSchema", () => {
  it("acepta un array con respuestas válidas", () => {
    const resultado = RespuestasSchema.safeParse([
      { question_position: 1, option: "Bogotá" },
      { question_position: 2, text: "100" },
    ]);

    expect(resultado.success).toBe(true);
  });

  it("rechaza un array vacío", () => {
    const resultado = RespuestasSchema.safeParse([]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toContain("al menos una");
    }
  });
});
