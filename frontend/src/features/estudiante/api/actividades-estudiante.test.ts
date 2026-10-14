/**
 * Tests de la fachada del estudiante (T5.8.1, PRO-394).
 *
 * Cubren el plan §4: exclusión de borradores, `null` para no publicadas y
 * — el más importante — que **el JSON serializado de la actividad segura
 * no contiene `is_correct` ni `expected_answer`** en ninguna profundidad.
 *
 * El escenario usa el mock real del profesor (`crearActividad` +
 * `publicarActividad`) para que la sanitización se ejerza sobre datos con
 * secretos de verdad.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  crearActividad,
  publicarActividad,
} from "@/features/teacher/api/actividades";
import type { Pregunta } from "@/features/teacher/contrato/actividades";

import {
  listarPublicadas,
  obtenerParaEstudiante,
} from "./actividades-estudiante";

/** Pregunta `test` con secretos (forma del profesor). */
const PREGUNTA_CON_SECRETOS: Pregunta = {
  type: "test",
  position: 1,
  prompt: "¿Cuál es la capital de Colombia?",
  score: 10,
  options: [
    { text: "Bogotá", is_correct: true },
    { text: "Cali", is_correct: false },
  ],
};

/** Pregunta `completion` con `expected_answer` (secreto). */
const PREGUNTA_COMPLETION: Pregunta = {
  type: "completion",
  position: 2,
  prompt: "El agua hierve a ___ °C.",
  score: 5,
  expected_answer: "100",
};

let contador = 0;

/** Crea una actividad publicada de prueba con secretos. */
async function crearPublicada(titulo: string): Promise<string> {
  contador += 1;
  const creada = await crearActividad({
    claseId: "clase-estudiante-test",
    titulo: `${titulo} ${contador}`,
    recompensaMonedas: 120,
    preguntas: [PREGUNTA_CON_SECRETOS, PREGUNTA_COMPLETION],
  });

  const publicada = await publicarActividad(creada.id);

  return publicada.id;
}

describe("listarPublicadas", () => {
  beforeEach(() => {
    contador = 0;
  });

  it("devuelve solo actividades publicadas (excluye draft)", async () => {
    const publicadaId = await crearPublicada("Publicada para listar");

    // Un borrador que no debe aparecer:
    const borrador = await crearActividad({
      claseId: "clase-estudiante-test",
      titulo: "Borrador que no debe listarse",
      recompensaMonedas: 10,
      preguntas: [PREGUNTA_CON_SECRETOS],
    });

    const lista = await listarPublicadas();
    const ids = lista.map((actividad) => actividad.id);

    expect(ids).toContain(publicadaId);
    expect(ids).not.toContain(borrador.id);
    expect(
      lista.every((actividad) => actividad.preguntas.every((p) => p.position >= 1)),
    ).toBe(true);
  });

  it("ninguna actividad del listado expone secretos", async () => {
    await crearPublicada("Publicada sin secretos");

    const lista = await listarPublicadas();
    const serializado = JSON.stringify(lista);

    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
  });
});

describe("obtenerParaEstudiante", () => {
  it("devuelve la actividad publicada sanitizada", async () => {
    const id = await crearPublicada("Publicada individual");

    const actividad = await obtenerParaEstudiante(id);

    expect(actividad).not.toBeNull();
    expect(actividad?.titulo).toContain("Publicada individual");
    expect(actividad?.preguntas).toHaveLength(2);
    expect(actividad?.preguntas[0].options).toEqual([
      { text: "Bogotá" },
      { text: "Cali" },
    ]);
    expect(actividad?.preguntas[1]).not.toHaveProperty("expected_answer");
  });

  it("devuelve null para una actividad en draft (no accesible por URL)", async () => {
    const borrador = await crearActividad({
      claseId: "clase-estudiante-test",
      titulo: "Borrador inaccesible",
      recompensaMonedas: 10,
      preguntas: [PREGUNTA_CON_SECRETOS],
    });

    expect(await obtenerParaEstudiante(borrador.id)).toBeNull();
  });

  it("devuelve null para un id inexistente", async () => {
    expect(await obtenerParaEstudiante("no-existe")).toBeNull();
  });

  it("el JSON serializado de la actividad no contiene secretos", async () => {
    const id = await crearPublicada("Serializada");

    const actividad = await obtenerParaEstudiante(id);
    const serializado = JSON.stringify(actividad);

    expect(serializado).toContain("Bogotá"); // el texto sí está
    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
    // El valor esperado del completion ("100") tampoco aparece.
    expect(actividad?.preguntas[1]).not.toHaveProperty("expected_answer");
  });
});
