import type { Pregunta } from '../activities/dto/preguntas.schema';
import type { RespuestaEntrega } from './dto/respuestas.schema';
import {
  UMBRAL_CORRECTAS_PORCENTAJE,
  evaluarRespuestas,
} from './auto-calificacion';

/** Preguntas con la MISMA estructura del JSONB de la seed (§7). */
const PREGUNTAS_SEED: Pregunta[] = [
  {
    position: 1,
    type: 'test',
    prompt: 'What is x in 2x + 4 = 10?',
    score: 5,
    options: [
      { text: '2', is_correct: false },
      { text: '3', is_correct: true },
      { text: '4', is_correct: false },
    ],
  },
  {
    position: 2,
    type: 'completion',
    prompt: 'Complete: the solution of x + 1 = 5 is x = ___',
    score: 5,
    expected_answer: '4',
  },
];

/** Generador de pregunta test de una correcta (a|b) para pruebas de umbral. */
const preguntaTest = (position: number, correcta: 'a' | 'b'): Pregunta => ({
  position,
  type: 'test',
  prompt: `Pregunta ${position}`,
  score: 1,
  options: [
    { text: 'a', is_correct: correcta === 'a' },
    { text: 'b', is_correct: correcta === 'b' },
  ],
});

/** Respuesta a una pregunta test del generador. */
const responderTest = (
  position: number,
  option: 'a' | 'b',
): RespuestaEntrega => ({
  question_position: position,
  option,
});

describe('evaluarRespuestas', () => {
  describe('veredicto por tipo de pregunta', () => {
    it('test acertada: copia el is_correct de la opción elegida y otorga el puntaje', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 1, option: '3' }],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.respuestas[0]).toEqual({
        question_position: 1,
        option: '3',
        is_correct: true,
        score: 5,
      });
      expect(evaluacion.correctas).toBe(1);
      expect(evaluacion.puntaje).toBe(5);
    });

    it('test fallida: is_correct false y score 0', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 1, option: '2' }],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.respuestas[0]).toEqual({
        question_position: 1,
        option: '2',
        is_correct: false,
        score: 0,
      });
      expect(evaluacion.puntaje).toBe(0);
    });

    it('completion exacta: is_correct true y el puntaje de la pregunta', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 2, text: '4' }],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.respuestas[0].is_correct).toBe(true);
      expect(evaluacion.respuestas[0].score).toBe(5);
    });

    it('completion normalizada: espacios al borde y mayúsculas no fallan la respuesta', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 2, text: '  4  ' }],
        PREGUNTAS_SEED,
      );
      expect(evaluacion.respuestas[0].is_correct).toBe(true);
    });

    it('completion distinta: is_correct false', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 2, text: '5' }],
        PREGUNTAS_SEED,
      );
      expect(evaluacion.respuestas[0].is_correct).toBe(false);
      expect(evaluacion.respuestas[0].score).toBe(0);
    });

    it('minigame: queda pendiente (is_correct y score en null)', () => {
      const preguntas: Pregunta[] = [
        {
          position: 1,
          type: 'minigame',
          prompt: 'Alcanza el nivel 3',
          score: 5,
        },
      ];

      const evaluacion = evaluarRespuestas(
        [{ question_position: 1, text: 'nivel 3' }],
        preguntas,
      );

      expect(evaluacion.respuestas[0]).toEqual({
        question_position: 1,
        text: 'nivel 3',
        is_correct: null,
        score: null,
      });
      expect(evaluacion.correctas).toBe(0);
      expect(evaluacion.puntaje).toBe(0);
    });

    it('respuesta a una pregunta file: invariante rota (validarRespuestas debe correr antes)', () => {
      const preguntas: Pregunta[] = [
        { position: 1, type: 'file', prompt: 'Sube tu PDF', score: 5 },
      ];

      expect(() =>
        evaluarRespuestas([{ question_position: 1, text: 'a.pdf' }], preguntas),
      ).toThrow(/file/);
    });
  });

  describe('puntaje total', () => {
    it('suma los puntajes obtenidos y redondea a 2 decimales', () => {
      const preguntas: Pregunta[] = [
        {
          position: 1,
          type: 'completion',
          prompt: '1',
          score: 2.5,
          expected_answer: 'x',
        },
        {
          position: 2,
          type: 'completion',
          prompt: '2',
          score: 2.5,
          expected_answer: 'y',
        },
      ];

      const evaluacion = evaluarRespuestas(
        [
          { question_position: 1, text: 'x' },
          { question_position: 2, text: 'y' },
        ],
        preguntas,
      );

      expect(evaluacion.puntaje).toBe(5);
    });
  });

  describe('autoCalificable', () => {
    it('true cuando toda la actividad quedó respondida y solo tiene test/completion', () => {
      const evaluacion = evaluarRespuestas(
        [
          { question_position: 1, option: '3' },
          { question_position: 2, text: '4' },
        ],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.autoCalificable).toBe(true);
      expect(evaluacion.totalPreguntas).toBe(2);
    });

    it('false cuando falta al menos una pregunta por responder', () => {
      const evaluacion = evaluarRespuestas(
        [{ question_position: 1, option: '3' }],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.autoCalificable).toBe(false);
      expect(evaluacion.alcanzaUmbral).toBe(false);
    });

    it('false cuando la actividad tiene una pregunta minigame aunque todo esté respondido', () => {
      const preguntas: Pregunta[] = [
        PREGUNTAS_SEED[0],
        { position: 2, type: 'minigame', prompt: 'Juega', score: 5 },
      ];

      const evaluacion = evaluarRespuestas(
        [
          { question_position: 1, option: '3' },
          { question_position: 2, text: 'nivel 1' },
        ],
        preguntas,
      );

      expect(evaluacion.autoCalificable).toBe(false);
      expect(evaluacion.alcanzaUmbral).toBe(false);
    });
  });

  describe('umbral de correctas (regla del equipo: 80%)', () => {
    it('4 de 5 correctas (80% exacto) alcanza el umbral', () => {
      const preguntas = [
        preguntaTest(1, 'a'),
        preguntaTest(2, 'a'),
        preguntaTest(3, 'a'),
        preguntaTest(4, 'a'),
        preguntaTest(5, 'b'),
      ];
      const respuestas = [
        responderTest(1, 'a'),
        responderTest(2, 'a'),
        responderTest(3, 'a'),
        responderTest(4, 'a'),
        responderTest(5, 'a'), // incorrecta
      ];

      const evaluacion = evaluarRespuestas(respuestas, preguntas);

      expect(evaluacion.correctas).toBe(4);
      expect(evaluacion.totalPreguntas).toBe(5);
      expect(evaluacion.alcanzaUmbral).toBe(true);
    });

    it('3 de 5 correctas (60%) NO alcanza el umbral', () => {
      const preguntas = [
        preguntaTest(1, 'a'),
        preguntaTest(2, 'a'),
        preguntaTest(3, 'a'),
        preguntaTest(4, 'b'),
        preguntaTest(5, 'b'),
      ];
      const respuestas = [
        responderTest(1, 'a'),
        responderTest(2, 'a'),
        responderTest(3, 'a'),
        responderTest(4, 'a'), // incorrecta
        responderTest(5, 'a'), // incorrecta
      ];

      const evaluacion = evaluarRespuestas(respuestas, preguntas);

      expect(evaluacion.alcanzaUmbral).toBe(false);
    });

    it('el umbral solo aplica a actividades auto-calificables', () => {
      // 4 de 5 correctas, pero la quinta es minigame: la calificación
      // final es del profesor, sin importar el porcentaje.
      const preguntas: Pregunta[] = [
        preguntaTest(1, 'a'),
        preguntaTest(2, 'a'),
        preguntaTest(3, 'a'),
        preguntaTest(4, 'a'),
        { position: 5, type: 'minigame', prompt: 'Juega', score: 5 },
      ];
      const respuestas = [
        responderTest(1, 'a'),
        responderTest(2, 'a'),
        responderTest(3, 'a'),
        responderTest(4, 'a'),
        { question_position: 5, text: 'nivel 1' },
      ];

      const evaluacion = evaluarRespuestas(respuestas, preguntas);

      expect(evaluacion.correctas).toBe(4);
      expect(evaluacion.autoCalificable).toBe(false);
      expect(evaluacion.alcanzaUmbral).toBe(false);
    });

    it('2 de 2 correctas: umbral alcanzado', () => {
      const evaluacion = evaluarRespuestas(
        [
          { question_position: 1, option: '3' },
          { question_position: 2, text: '4' },
        ],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.alcanzaUmbral).toBe(true);
    });

    it('1 de 2 correctas (50%): umbral NO alcanzado', () => {
      const evaluacion = evaluarRespuestas(
        [
          { question_position: 1, option: '2' },
          { question_position: 2, text: '4' },
        ],
        PREGUNTAS_SEED,
      );

      expect(evaluacion.autoCalificable).toBe(true);
      expect(evaluacion.correctas).toBe(1);
      expect(evaluacion.alcanzaUmbral).toBe(false);
      // La evaluación parcial sigue calculada para el profesor.
      expect(evaluacion.puntaje).toBe(5);
    });

    it('el umbral es el porcentaje exportado (80)', () => {
      expect(UMBRAL_CORRECTAS_PORCENTAJE).toBe(80);
    });
  });
});
