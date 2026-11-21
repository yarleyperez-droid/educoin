/**
 * Tests de los filtros de "Mis Actividades" (realizadas/pendientes).
 *
 * Entorno: Vitest en node; solo la capa pura.
 */

import { describe, expect, it } from 'vitest';

import {
  esActividadRealizada,
  filtrarActividades,
} from './actividades-filtros';
import type { ActividadResumen } from '../contrato/cuestionario';
import type { EstadoEntrega } from '../contrato/entregas';

function actividad(id: string): ActividadResumen {
  return {
    id,
    titulo: `Actividad ${id}`,
    recompensaMonedas: 10,
    totalPuntos: 100,
    modoCalificacion: 'automatica',
    publicadaEn: null,
    cierraEn: null,
    creadoEn: '2026-11-01T00:00:00.000Z',
  };
}

const actividades = [actividad('1'), actividad('2'), actividad('3')];

const estados: Record<string, EstadoEntrega> = {
  '1': 'graded',
  '2': 'in_progress',
};

describe('esActividadRealizada', () => {
  it('cuenta enviadas, calificadas y rechazadas como realizadas', () => {
    expect(esActividadRealizada('submitted')).toBe(true);
    expect(esActividadRealizada('graded')).toBe(true);
    expect(esActividadRealizada('rejected')).toBe(true);
  });

  it('deja pendientes el borrador y la entrega inexistente', () => {
    expect(esActividadRealizada('in_progress')).toBe(false);
    expect(esActividadRealizada(undefined)).toBe(false);
  });
});

describe('filtrarActividades', () => {
  it('devuelve todas sin filtro', () => {
    expect(filtrarActividades(actividades, estados, 'todas')).toHaveLength(3);
  });

  it('separa realizadas de pendientes (incluye borradores como pendientes)', () => {
    expect(
      filtrarActividades(actividades, estados, 'realizadas').map((a) => a.id),
    ).toEqual(['1']);
    expect(
      filtrarActividades(actividades, estados, 'pendientes').map((a) => a.id),
    ).toEqual(['2', '3']);
  });
});
