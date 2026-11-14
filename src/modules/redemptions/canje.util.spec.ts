import {
  aCanjeListado,
  aCanjeRespuesta,
  evaluarCanje,
  mensajeDeError,
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

describe('mensajeDeError (mensajes exactos del contrato H7.2)', () => {
  it('saldo insuficiente → `Saldo insuficiente` literal', () => {
    expect(mensajeDeError('saldo-insuficiente')).toBe('Saldo insuficiente');
  });

  it('sin stock → `Sin stock disponible` literal', () => {
    expect(mensajeDeError('sin-stock')).toBe('Sin stock disponible');
  });

  it('ítem inactivo conserva su mensaje', () => {
    expect(mensajeDeError('item-no-disponible')).toBe(
      'El ítem no está disponible.',
    );
  });
});

describe('aCanjeRespuesta (H7.2: resueltoEn + aprobacionAutomatica)', () => {
  const fila = {
    id: 7n,
    item_id: 3n,
    cost_coins: 100,
    grade_points: '0.50',
    status: 'pending' as const,
    redeemed_at: new Date('2026-10-15T12:00:00Z'),
    reversed_at: null,
    resolved_at: null,
  };

  it('serializa ids como string y fechas en ISO (AGENTS §7)', () => {
    const dto = aCanjeRespuesta(fila, '+0.5 on the midterm', false);

    expect(dto.id).toBe('7');
    expect(dto.itemId).toBe('3');
    expect(dto.costoMonedas).toBe(100);
    expect(dto.puntosNota).toBe('0.50');
    expect(dto.estado).toBe('pending');
    expect(dto.canjeadoEn).toBe('2026-10-15T12:00:00.000Z');
    expect(dto.reversadoEn).toBeNull();
    expect(dto.resueltoEn).toBeNull();
    expect(dto.aprobacionAutomatica).toBe(false);
  });

  it('sin puntos de nota (fun_activity) deja null y refleja la reversión', () => {
    const dto = aCanjeRespuesta(
      {
        ...fila,
        grade_points: null,
        status: 'reversed',
        reversed_at: new Date('2026-10-16T09:30:00Z'),
      },
      'Trivia game in class',
      false,
    );

    expect(dto.puntosNota).toBeNull();
    expect(dto.estado).toBe('reversed');
    expect(dto.reversadoEn).toBe('2026-10-16T09:30:00.000Z');
    expect(dto.resueltoEn).toBeNull();
    expect(dto.aprobacionAutomatica).toBe(false);
  });

  it('refleja la resolución (resueltoEn) y la aprobación automática', () => {
    const dto = aCanjeRespuesta(
      {
        ...fila,
        status: 'approved',
        resolved_at: new Date('2026-10-15T12:05:00Z'),
      },
      '+0.5 on the midterm',
      true,
    );

    expect(dto.estado).toBe('approved');
    expect(dto.resueltoEn).toBe('2026-10-15T12:05:00.000Z');
    expect(dto.reversadoEn).toBeNull();
    expect(dto.aprobacionAutomatica).toBe(true);
  });
});

describe('aCanjeListado (cola del profesor / historial del estudiante)', () => {
  const fila = {
    id: 42n,
    cost_coins: 30,
    status: 'pending' as const,
    redeemed_at: new Date('2026-10-15T12:00:00Z'),
    item_name: 'Trivia game in class',
    student_first_name: 'Ana',
    student_last_name: 'Pérez',
  };

  it('mapea id como string, nombre completo y fecha ISO', () => {
    const dto = aCanjeListado(fila);

    expect(dto).toEqual({
      id: '42',
      nombreEstudiante: 'Ana Pérez',
      nombreItem: 'Trivia game in class',
      costoMonedas: 30,
      estado: 'pending',
      solicitadoEn: '2026-10-15T12:00:00.000Z',
    });
  });
});
