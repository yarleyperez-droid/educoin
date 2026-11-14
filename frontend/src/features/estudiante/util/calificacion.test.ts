/**
 * Tests del calculador de resultados (T5.8.3, PRO-396).
 *
 * Cubren el plan §3: puntaje perfecto, parcial, comparación
 * insensible a mayúsculas del `completion`, preguntas sin responder y —
 * el más importante — que el objeto de resultado **no contiene secretos**
 * (`is_correct` ni `expected_answer`).
 */

import { describe, expect, it } from "vitest";

import type { Pregunta } from "@/features/teacher/contrato/actividades";

import type { Respuesta } from "../contrato/entregas";

import { calcularResultado } from "./calificacion";

/** Pregunta `test` de ejemplo (Bogotá es la correcta). */
const TEST: Pregunta = {
  type: "test",
  position: 1,
  prompt: "Capital de Colombia",
  score: 10,
  options: [
    { text: "Bogotá", is_correct: true },
    { text: "Cali", is_correct: false },
  ],
};

/** Pregunta `completion` de ejemplo (espera "100"). */
const COMPLETION: Pregunta = {
  type: "completion",
  position: 2,
  prompt: "El agua hierve a ___ °C",
  score: 5,
  expected_answer: "100",
};

describe("calcularResultado", () => {
  it("respuestas correctas → puntaje total y todas correctas", () => {
    const respuestas: Respuesta[] = [
      { question_position: 1, option: "Bogotá" },
      { question_position: 2, text: "100" },
    ];

    const { resultado, puntaje } = calcularResultado(respuestas, [
      TEST,
      COMPLETION,
    ]);

    expect(puntaje).toBe(15);
    expect(resultado.every((item) => item.correcta)).toBe(true);
    expect(resultado.map((item) => item.puntos)).toEqual([10, 5]);
  });

  it("mezcla de correctas e incorrectas → puntaje parcial", () => {
    const respuestas: Respuesta[] = [
      { question_position: 1, option: "Cali" }, // incorrecta
      { question_position: 2, text: "100" }, // correcta
    ];

    const { resultado, puntaje } = calcularResultado(respuestas, [
      TEST,
      COMPLETION,
    ]);

    expect(puntaje).toBe(5);
    expect(resultado[0]).toEqual({
      question_position: 1,
      correcta: false,
      puntos: 0,
    });
    expect(resultado[1].correcta).toBe(true);
  });

  it("completion insensible a mayúsculas y espacios", () => {
    const conEspacios = calcularResultado(
      [{ question_position: 2, text: "  100  " }],
      [COMPLETION],
    );

    const preguntaTexto: Pregunta = {
      type: "completion",
      position: 1,
      prompt: "Saludo",
      score: 4,
      expected_answer: "Hola Mundo",
    };
    const conMayusculas = calcularResultado(
      [{ question_position: 1, text: "  hOLA mundo " }],
      [preguntaTexto],
    );

    expect(conEspacios.puntaje).toBe(5);
    expect(conMayusculas.puntaje).toBe(4);
  });

  it("pregunta sin respuesta → incorrecta con 0 puntos", () => {
    const { resultado, puntaje } = calcularResultado([], [TEST, COMPLETION]);

    expect(puntaje).toBe(0);
    expect(resultado).toHaveLength(2);
    expect(resultado.every((item) => !item.correcta)).toBe(true);
    expect(resultado.every((item) => item.puntos === 0)).toBe(true);
  });

  it("el resultado no contiene secretos del JSONB", () => {
    const { resultado } = calcularResultado(
      [{ question_position: 1, option: "Bogotá" }],
      [TEST],
    );

    const serializado = JSON.stringify(resultado);

    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
    expect(serializado).not.toContain("Bogotá"); // ni el texto de la opción correcta
    expect(Object.keys(resultado[0])).toEqual([
      "question_position",
      "correcta",
      "puntos",
    ]);
  });
});
