import { ForbiddenException } from '@nestjs/common';

import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  MENSAJE_SOLO_PROPIO,
  aMovimientoBilletera,
  verificarPropio,
} from './billetera.util';

const ESTUDIANTE: UsuarioAutenticado = {
  id: '3',
  username: 'est.perez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

describe('verificarPropio (CA 3 · billetera solo el propio)', () => {
  it('deja pasar sin studentId (la API ya es del propio token)', () => {
    expect(() => verificarPropio(undefined, ESTUDIANTE)).not.toThrow();
  });

  it('deja pasar cuando studentId coincide con el token', () => {
    expect(() => verificarPropio('3', ESTUDIANTE)).not.toThrow();
  });

  it('responde 403 cuando piden la billetera ajena', () => {
    expect(() => verificarPropio('4', ESTUDIANTE)).toThrow(ForbiddenException);
    try {
      verificarPropio('4', ESTUDIANTE);
    } catch (error) {
      expect((error as ForbiddenException).message).toBe(MENSAJE_SOLO_PROPIO);
    }
  });
});

describe('aMovimientoBilletera (T4.2.2)', () => {
  const fila = {
    id: 15n,
    type: 'spending' as const,
    quantity: -50,
    description: 'Item redemption',
    class_id: 1n,
    class_name: 'Mathematics 10A',
    created_at: new Date('2026-10-16T10:00:00Z'),
  };

  it('serializa ids como string, cantidad firmada y fecha ISO (AGENTS §7)', () => {
    const dto = aMovimientoBilletera(fila);

    expect(dto.id).toBe('15');
    expect(dto.tipo).toBe('spending');
    expect(dto.cantidad).toBe(-50);
    expect(dto.claseId).toBe('1');
    expect(dto.claseNombre).toBe('Mathematics 10A');
    expect(dto.creadoEn).toBe('2026-10-16T10:00:00.000Z');
  });

  it('acepta descripción nula (movimientos sin texto)', () => {
    const dto = aMovimientoBilletera({ ...fila, description: null });
    expect(dto.descripcion).toBeNull();
  });
});
