import { BadRequestException } from '@nestjs/common';
import type { Pregunta } from '../../activities/dto/preguntas.schema';
import type { RespuestaEntrega } from './respuestas.schema';
import { exigirCompletitud, validarRespuestas } from './respuestas.schema';

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

describe('validarRespuestas con archivos (preguntas file)', () => {
  const PREGUNTA_FILE: Pregunta = {
    position: 1,
    type: 'file',
    prompt: 'Sube tu PDF',
    score: 5,
  };

  /** Metadata válida: la forma exacta que devuelve el endpoint de subida. */
  const ARCHIVO = {
    path: '7/1/11111111-1111-4111-8111-111111111111.pdf',
    mime: 'application/pdf',
    bytes: 100,
  } as const;

  it('acepta la respuesta de una pregunta file con files y la devuelve saneada', () => {
    const respuestas = validarRespuestas(
      [{ question_position: 1, files: [ARCHIVO] }],
      [PREGUNTA_FILE],
    );

    expect(respuestas).toEqual([{ question_position: 1, files: [ARCHIVO] }]);
  });

  it('acepta files vacío: desadjuntar lo subido antes de enviar', () => {
    expect(() =>
      validarRespuestas([{ question_position: 1, files: [] }], [PREGUNTA_FILE]),
    ).not.toThrow();
  });

  it('400 si la respuesta de una pregunta file no trae files', () => {
    expect(() =>
      validarRespuestas([{ question_position: 1 }], [PREGUNTA_FILE]),
    ).toThrow(BadRequestException);
  });

  it('400 si la respuesta file trae option o text (se responde solo con files)', () => {
    expect(() =>
      validarRespuestas(
        [{ question_position: 1, option: '3' }],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/no admite option/);
    expect(() =>
      validarRespuestas(
        [{ question_position: 1, text: 'a.pdf' }],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/no admite text/);
  });

  it('400 si una pregunta que NO es file trae files', () => {
    expect(() =>
      validarRespuestas(
        [{ question_position: 1, option: '3', files: [ARCHIVO] }],
        PREGUNTAS_SEED,
      ),
    ).toThrow(/no admite files/);
  });

  it('400 si la ruta no tiene el formato generado por el servidor', () => {
    expect(() =>
      validarRespuestas(
        [
          {
            question_position: 1,
            files: [{ ...ARCHIVO, path: 'mi-archivo.pdf' }],
          },
        ],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/ruta \(path\)/);
    expect(() =>
      validarRespuestas(
        [
          {
            question_position: 1,
            files: [{ ...ARCHIVO, path: '../../7/1/escape.pdf' }],
          },
        ],
        [PREGUNTA_FILE],
      ),
    ).toThrow(BadRequestException);
  });

  it('400 si el mime del archivo no es de los permitidos', () => {
    expect(() =>
      validarRespuestas(
        [
          {
            question_position: 1,
            files: [{ ...ARCHIVO, mime: 'text/plain' }],
          },
        ],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/application\/pdf, image\/jpeg o image\/png/);
  });

  it('400 si bytes no es un entero positivo', () => {
    expect(() =>
      validarRespuestas(
        [{ question_position: 1, files: [{ ...ARCHIVO, bytes: 0 }] }],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/mayor que 0/);
    expect(() =>
      validarRespuestas(
        [{ question_position: 1, files: [{ ...ARCHIVO, bytes: 1.5 }] }],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/número entero/);
  });

  it('400 si vienen más archivos que el máximo por pregunta', () => {
    const cuatro = [ARCHIVO, ARCHIVO, ARCHIVO, ARCHIVO].map((archivo) => ({
      ...archivo,
      path: archivo.path,
    }));

    expect(() =>
      validarRespuestas(
        [{ question_position: 1, files: cuatro }],
        [PREGUNTA_FILE],
      ),
    ).toThrow(/máximo 3 archivos/);
  });

  it('descarta claves desconocidas del archivo: solo path/mime/bytes se guardan', () => {
    const respuestas = validarRespuestas(
      [
        {
          question_position: 1,
          files: [
            { ...ARCHIVO, is_correct: true, score: 999, nombre: 'virus.exe' },
          ],
        },
      ],
      [PREGUNTA_FILE],
    );

    expect(respuestas[0].files).toEqual([ARCHIVO]);
    expect(JSON.stringify(respuestas)).not.toContain('virus');
  });
});
