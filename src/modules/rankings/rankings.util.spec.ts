import { aFilaRanking, type FilaRanking } from './rankings.util';

const FILA_CRUDA: FilaRanking = {
  position: 1n,
  student_id: 15n,
  first_name: 'Juan',
  last_name: 'Pérez',
  coins_earned: 120n,
  coins_available: 100n,
};

describe('aFilaRanking (U1 · fila cruda → DTO)', () => {
  it('serializa ids como string y montos como number (bigint crudo)', () => {
    const dto = aFilaRanking(FILA_CRUDA);

    expect(dto).toEqual({
      posicion: 1,
      estudianteId: '15',
      nombres: 'Juan Pérez',
      monedasGanadas: 120,
      monedasDisponibles: 100,
    });
  });

  it('tolera números y strings numéricos del driver', () => {
    const dto = aFilaRanking({
      position: '3',
      student_id: 42,
      first_name: 'María',
      last_name: 'Gómez',
      coins_earned: '60.0000',
      coins_available: 0,
    });

    expect(dto.posicion).toBe(3);
    expect(dto.estudianteId).toBe('42');
    expect(dto.monedasGanadas).toBe(60);
    expect(dto.monedasDisponibles).toBe(0);
  });

  it('nombres con espacios dobles se conservan y los bordes se recortan', () => {
    const compuesto = aFilaRanking({
      ...FILA_CRUDA,
      first_name: 'Juan  Carlos',
      last_name: 'Pérez',
    });
    expect(compuesto.nombres).toBe('Juan  Carlos Pérez');

    const bordes = aFilaRanking({
      ...FILA_CRUDA,
      first_name: ' Ana',
      last_name: 'López ',
    });
    expect(bordes.nombres).toBe('Ana López');
  });
});
