import {
  auditarSinSecretos,
  CAMPOS_PROHIBIDOS,
} from './auditoria-respuestas';

describe('auditarSinSecretos (auditoría de filtraciones)', () => {
  it('declara exactamente los campos prohibidos del CA 3', () => {
    expect([...CAMPOS_PROHIBIDOS]).toEqual([
      'password_hash',
      'is_correct',
      'expected_answer',
    ]);
  });

  it('no lanza con un cuerpo limpio, anidado o en array', () => {
    const cuerpoLimpio = {
      data: [
        { id: '1', nombre: 'Clase', meta: { total: 1, page: 1 } },
        { id: '2', saldo: { monedasDisponibles: 10, esCorrecto: true } },
      ],
      meta: { total: 2 },
      mensaje: 'password_hash solo como texto de ejemplo seguro',
    };

    expect(() => auditarSinSecretos(cuerpoLimpio, 'limpio')).not.toThrow();
  });

  it('no lanza con primitivos, null o cuerpos vacíos', () => {
    expect(() => auditarSinSecretos(undefined, 'vacío')).not.toThrow();
    expect(() => auditarSinSecretos(null, 'null')).not.toThrow();
    expect(() => auditarSinSecretos([], 'array vacío')).not.toThrow();
    expect(() => auditarSinSecretos('hola', 'string')).not.toThrow();
  });

  it('falla con la ruta exacta si encuentra password_hash anidado', () => {
    const cuerpo = { data: { usuario: { password_hash: '$argon2id$...' } } };

    expect(() => auditarSinSecretos(cuerpo, 'perfil')).toThrow(
      /perfil.*\$\.data\.usuario\.password_hash/,
    );
  });

  it('falla si encuentra is_correct dentro de un array de respuestas', () => {
    const cuerpo = {
      data: [
        { pregunta: 'a', respuesta: 'x' },
        { pregunta: 'b', respuesta: 'y', is_correct: true },
      ],
    };

    expect(() => auditarSinSecretos(cuerpo, 'activities')).toThrow(
      /\$\.data\[1\]\.is_correct/,
    );
  });

  it('falla si encuentra expected_answer en cualquier nivel', () => {
    const cuerpo = { detalle: { preguntas: [{ expected_answer: '42' }] } };

    expect(() => auditarSinSecretos(cuerpo, 'quiz')).toThrow(
      /\$\.detalle\.preguntas\[0\]\.expected_answer/,
    );
  });

  it('acumula todos los hallazgos en un solo error', () => {
    const cuerpo = { password_hash: 'a', otro: { is_correct: false } };

    expect(() => auditarSinSecretos(cuerpo, 'varios')).toThrow(
      /\$\.password_hash.*\$\.otro\.is_correct/,
    );
  });
});
