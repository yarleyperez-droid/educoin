/**
 * Tests de la fachada de entregas (T5.8.2, PRO-395).
 *
 * Cubren el plan §3: primer envío → `submitted`, **segundo envío → 409**
 * (regla UNIQUE del mock), actividad no disponible → 404, respuestas
 * incoherentes → 422 sin persistir y lectura de la entrega para el bloqueo
 * de la vista.
 *
 * El escenario crea actividades reales con el mock del profesor
 * (`crearActividad` + `publicarActividad`) para ejercitar la coherencia
 * contra las preguntas de verdad.
 */

import { describe, expect, it } from "vitest";

import {
  crearActividad,
  publicarActividad,
} from "@/features/teacher/api/actividades";
import type { Pregunta } from "@/features/teacher/contrato/actividades";
import { ApiError } from "@/lib/api-client";

import {
  consultarAutoCalificacion,
  enviarRespuestas,
  obtenerEntrega,
} from "./entregas";

/** Pregunta `test` con opciones reales. */
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

/** Pregunta `completion`. */
const PREGUNTA_COMPLETION: Pregunta = {
  type: "completion",
  position: 2,
  prompt: "El agua hierve a ___ °C.",
  score: 5,
  expected_answer: "100",
};

let contador = 0;

/**
 * Crea una actividad publicada de prueba.
 *
 * @param titulo Título único de la actividad.
 * @returns El id de la actividad publicada.
 */
async function crearPublicada(titulo: string): Promise<string> {
  contador += 1;
  const creada = await crearActividad({
    claseId: "clase-entregas-test",
    titulo: `${titulo} ${contador}`,
    recompensaMonedas: 120,
    preguntas: [PREGUNTA_TEST, PREGUNTA_COMPLETION],
  });

  const publicada = await publicarActividad(creada.id);

  return publicada.id;
}

/** Respuestas completas de ejemplo (todas correctas). */
const RESPUESTAS_COMPLETAS = [
  { question_position: 1, option: "Bogotá" },
  { question_position: 2, text: "100" },
];

describe("enviarRespuestas", () => {
  it("el primer envío crea la entrega en submitted", async () => {
    const actividadId = await crearPublicada("Envío válido");

    const entrega = await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);

    expect(entrega.estado).toBe("submitted");
    expect(entrega.enviadaEn).not.toBeNull();
    expect(entrega.actividadId).toBe(actividadId);
    expect(entrega.respuestas).toHaveLength(2);
    expect(entrega.puntaje).toBeNull(); // aún sin calificar (T5.8.3)
  });

  it("el segundo envío devuelve ApiError 409 (UNIQUE de la BD)", async () => {
    const actividadId = await crearPublicada("Doble envío");

    await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);

    const segundoIntento = enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);

    await expect(segundoIntento).rejects.toBeInstanceOf(ApiError);
    await expect(segundoIntento).rejects.toMatchObject({ status: 409 });

    // Sigue habiendo exactamente una entrega (no se duplicó).
    const entrega = await obtenerEntrega(actividadId);
    expect(entrega?.estado).toBe("submitted");
  });

  it("responde 404 para una actividad inexistente", async () => {
    await expect(
      enviarRespuestas("no-existe", RESPUESTAS_COMPLETAS),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("responde 404 para una actividad en draft", async () => {
    const borrador = await crearActividad({
      claseId: "clase-entregas-test",
      titulo: "Borrador no resoluble",
      recompensaMonedas: 10,
      preguntas: [PREGUNTA_TEST],
    });

    await expect(
      enviarRespuestas(borrador.id, [{ question_position: 1, option: "Bogotá" }]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("responde 422 si falta una respuesta y no persiste nada", async () => {
    const actividadId = await crearPublicada("Respuesta incompleta");

    const intento = enviarRespuestas(actividadId, [
      { question_position: 1, option: "Bogotá" }, // falta la 2
    ]);

    await expect(intento).rejects.toMatchObject({ status: 422 });
    expect(await obtenerEntrega(actividadId)).toBeNull();
  });

  it("responde 422 si la opción no pertenece a la pregunta", async () => {
    const actividadId = await crearPublicada("Opción ajena");

    await expect(
      enviarRespuestas(actividadId, [
        { question_position: 1, option: "Medellín" }, // no existe
        { question_position: 2, text: "100" },
      ]),
    ).rejects.toMatchObject({ status: 422 });

    expect(await obtenerEntrega(actividadId)).toBeNull();
  });

  it("responde 422 si una posición no corresponde a ninguna pregunta", async () => {
    const actividadId = await crearPublicada("Posición desconocida");

    await expect(
      enviarRespuestas(actividadId, [
        ...RESPUESTAS_COMPLETAS,
        { question_position: 99, text: "extra" },
      ]),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("responde 422 si el array de respuestas está vacío", async () => {
    const actividadId = await crearPublicada("Sin respuestas");

    await expect(enviarRespuestas(actividadId, [])).rejects.toMatchObject({
      status: 422,
    });
    expect(await obtenerEntrega(actividadId)).toBeNull();
  });
});

describe("obtenerEntrega", () => {
  it("devuelve null antes del envío y la entrega después", async () => {
    const actividadId = await crearPublicada("Lectura de entrega");

    expect(await obtenerEntrega(actividadId)).toBeNull();

    const creada = await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);
    const leida = await obtenerEntrega(actividadId);

    expect(leida?.id).toBe(creada.id);
    expect(leida?.estado).toBe("submitted");
  });
});

describe("consultarAutoCalificacion", () => {
  it("califica una entrega submitted y devuelve graded con resultado", async () => {
    const actividadId = await crearPublicada("Auto-calificación");

    await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);
    const calificada = await consultarAutoCalificacion(actividadId);

    expect(calificada.estado).toBe("graded");
    expect(calificada.calificadaEn).not.toBeNull();
    expect(calificada.puntaje).toBe(15); // 10 (test) + 5 (completion)
    expect(calificada.monedasOtorgadas).toBe(120); // recompensa de la actividad
    expect(calificada.retroalimentacion).not.toBeNull(); // placeholder H3.5
    expect(calificada.resultado).toHaveLength(2);
    expect(calificada.resultado?.every((item) => item.correcta)).toBe(true);
  });

  it("es idempotente sobre una entrega ya calificada", async () => {
    const actividadId = await crearPublicada("Idempotencia");

    await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);
    const primera = await consultarAutoCalificacion(actividadId);
    const segunda = await consultarAutoCalificacion(actividadId);

    expect(segunda.estado).toBe("graded");
    expect(segunda.puntaje).toBe(primera.puntaje);
    expect(segunda.calificadaEn).toBe(primera.calificadaEn);
    expect(segunda.resultado).toEqual(primera.resultado);
  });

  it("responde 404 si no hay entrega", async () => {
    await expect(consultarAutoCalificacion("sin-entrega")).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("la entrega calificada no expone secretos del JSONB", async () => {
    const actividadId = await crearPublicada("Entrega sin secretos");

    await enviarRespuestas(actividadId, RESPUESTAS_COMPLETAS);
    const calificada = await consultarAutoCalificacion(actividadId);
    const serializado = JSON.stringify(calificada);

    expect(serializado).toContain("correcta"); // el resultado sí se ve
    expect(serializado).not.toContain("is_correct");
    expect(serializado).not.toContain("expected_answer");
  });
});
