/**
 * Tests de la fachada de inscripciones del estudiante.
 *
 * Mockea `@/lib/api-client` y verifica que `listarInscripciones` consume
 * `GET /enrollments` con el contrato `{ data, meta }` del backend.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>();

  return {
    ...original,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { api, ApiError } from '@/lib/api-client';

import { listarInscripciones } from './inscripciones';

const LISTADO_BACKEND = {
  data: [
    {
      id: '7',
      clase: { id: '5', nombre: 'Matemática 5A' },
      estado: 'active',
      inscritoEn: '2026-10-08T02:53:19.000Z',
    },
  ],
  meta: { total: 1, page: 1, limit: 50 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listarInscripciones', () => {
  it('consume GET /enrollments?limit=50 y mapea las inscripciones', async () => {
    vi.mocked(api.get).mockResolvedValue(LISTADO_BACKEND);

    const resultado = await listarInscripciones();

    expect(api.get).toHaveBeenCalledWith('enrollments?limit=50');
    expect(resultado).toEqual({
      data: [
        {
          id: '7',
          clase: { id: '5', nombre: 'Matemática 5A' },
          estado: 'active',
          inscritoEn: '2026-10-08T02:53:19.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 50 },
    });
  });

  it('inventa meta cuando el backend no la devuelve', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: LISTADO_BACKEND.data });

    const resultado = await listarInscripciones();

    expect(resultado.meta).toEqual({ total: 1, page: 1, limit: 50 });
  });

  it('propaga errores del transporte', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError('Sesión expirada', 401));

    await expect(listarInscripciones()).rejects.toMatchObject({ status: 401 });
  });
});
