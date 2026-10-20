import {
  aCanjeRespuesta,
  evaluarCanje,
  mensajeDeMotivo,
} from './canje.util';

describe('evaluarCanje (T4.4.1 / CA 1-3)', () => {
  const base = { costoMonedas: 100, monedasDisponibles: 150, stock: 5, disponible: true };

  it('permite canjear con saldo, stock y ítem activo', () => {
    expect(evaluarCanje(base)).toEqual({ puedeCanjear: true, motivo: null });
  });

  it('bloquea con saldo insuficiente', () => {
    expect(evaluarCanje({ ...base, monedasDisponibles: 99 })).toEqual({
      puedeCanjear: false,
      motivo: 'saldo-insuficiente',
    });
  });

  it('bloquea con stock 0', () => {
    expect(evaluarCanje({ ...base, stock: 0 })).toEqual({
      puedeCanjear: false,
      motivo: 'sin-stock',
    });
  });

  it('stock null (ilimitado) nunca bloquea', () => {
    expect(evaluarCanje({ ...base, stock: null, monedasDisponibles: 100 })).toEqual({
      puedeCanjear: true,
      motivo: null,
    });
  });

  it('bloquea el ítem inactivo antes que cualquier otro motivo', () => {
    expect(
      evaluarCanje({ ...base, disponible: false, stock: 0, monedasDisponibles: 0 }),
    ).toEqual({ puedeCanjear: false, motivo: 'item-no-disponible' });
  });

  it('el saldo exacto del costo permite canjear', () => {
    expect(evaluarCanje({ ...base, monedasDisponibles: 100 }).puedeCanjear).toBe(
      true,
    );
  });
});

describe('mensajeDeMotivo', () => {
  it('explica el saldo insuficiente con números', () => {
    expect(mensajeDeMotivo('saldo-insuficiente', 100, 40)).toBe(
      'No tienes monedas suficientes: necesitas 100 y tienes 40.',
    );
  });

  it('usa mensajes fijos para stock e ítem', () => {
    expect(mensajeDeMotivo('sin-stock', 50, 10)).toBe('El ítem se quedó sin stock.');
    expect(mensajeDeMotivo('item-no-disponible', 50, 10)).toBe(
      'El ítem no está disponible.',
    );
  });
});

describe('aCanjeRespuesta', () => {
  const fila = {
    id: 7n,
    item_id: 3n,
    cost_coins: 100,
    grade_points: '0.50',
    status: 'completed' as const,
    redeemed_at: new Date('2026-10-15T12:00:00Z'),
    reversed_at: null,
  };

  it('serializa ids como string y fechas en ISO (AGENTS §7)', () => {
    const dto = aCanjeRespuesta(fila, '+0.5 on the midterm');

    expect(dto.id).toBe('7');
    expect(dto.itemId).toBe('3');
    expect(dto.costoMonedas).toBe(100);
    expect(dto.puntosNota).toBe('0.50');
    expect(dto.estado).toBe('completed');
    expect(dto.canjeadoEn).toBe('2026-10-15T12:00:00.000Z');
    expect(dto.reversadoEn).toBeNull();
  });

  it('sin puntos de nota (fun_activity) deja null y refleja la reversión', () => {
    const dto = aCanjeRespuesta(
      { ...fila, grade_points: null, status: 'reversed', reversed_at: new Date('2026-10-16T09:30:00Z') },
      'Trivia game in class',
    );

    expect(dto.puntosNota).toBeNull();
    expect(dto.estado).toBe('reversed');
    expect(dto.reversadoEn).toBe('2026-10-16T09:30:00.000Z');
  });
});
