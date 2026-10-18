import { BadRequestException } from '@nestjs/common';
import type { Pregunta } from '../../activities/dto/preguntas.schema';
import type { RespuestaEntrega } from './respuestas.schema';
import { exigirCompletitud } from './respuestas.schema';

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

describe('exigirCompletitud', () => {
  it('pasa cuando toda la actividad quedó respondida', () => {
    const respuestas: RespuestaEntrega[] = [
      { question_position: 1, option: '3' },
      { question_position: 2, text: '4' },
    ];

    expect(() => exigirCompletitud(respuestas, PREGUNTAS_SEED)).not.toThrow();
  });

  it('400 con las posiciones que faltan (nada respondido)', () => {
    try {
      exigirCompletitud([], PREGUNTAS_SEED);
      throw new Error('debería haber lanzado BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toMatch(
        /Falta responder las preguntas 1, 2/,
      );
    }
  });

  it('400 con la posición puntual que falta (respondida a medias)', () => {
    try {
      exigirCompletitud([{ question_position: 2, text: '4' }], PREGUNTAS_SEED);
      throw new Error('debería haber lanzado BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toMatch(
        /Falta responder la pregunta 1/,
      );
    }
  });

  it('las preguntas file NO cuentan para la completitud (hoy no se pueden responder)', () => {
    const preguntas: Pregunta[] = [
      PREGUNTAS_SEED[0],
      { position: 2, type: 'file', prompt: 'Sube tu PDF', score: 5 },
    ];

    expect(() =>
      exigirCompletitud([{ question_position: 1, option: '3' }], preguntas),
    ).not.toThrow();
  });

  it('una actividad solo de preguntas file se puede enviar sin respuestas', () => {
    const preguntas: Pregunta[] = [
      { position: 1, type: 'file', prompt: 'Sube tu PDF', score: 5 },
    ];

    expect(() => exigirCompletitud([], preguntas)).not.toThrow();
  });
});
