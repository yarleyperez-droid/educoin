import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  MENSAJE_CANJE_NO_EXISTE,
  MENSAJE_CANJE_YA_RESUELTO,
  MENSAJE_ITEM_NO_EXISTE,
  MENSAJE_SIN_INSCRIPCION,
  MENSAJE_SIN_PERMISO_RESOLVER,
  RedemptionsService,
} from './redemptions.service';

/**
 * Unit de `RedemptionsService` sin BD (H4.4 + H7.2 / PRO-447).
 *
 * Cubre la capa que el service aporta por encima de los triggers: lectura
 * del ítem/inscripción, pre-validación con mensajes en español, guard de
 * transición del flujo revisable (`pending → approved | rejected`,
 * `approved → delivered`), autorización por recurso y mapeo a DTO.
 *
 * `prisma` va mockeado: `$queryRaw` devuelve los resultados encolados en
 * cada prueba y `$transaction` ejecuta el callback contra el mismo doble,
 * de modo que no se necesita PostgreSQL.
 */

const ESTUDIANTE: UsuarioAutenticado = {
  id: '5',
  username: 'est.lopez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

/** Ítem vigente, con stock limitado y puntos de nota. */
const ITEM = {
  id: 3n,
  class_id: 1n,
  name: 'Bono de 0.3 en el examen',
  cost_coins: 30,
  stock: 4,
  status: 'active' as const,
  type: 'grade_bonus' as const,
  grade_points: { toString: () => '0.30' },
};

/** Canje `pending` tal como lo devuelve Prisma. */
const CANJE = {
  id: 7n,
  item_id: 3n,
  cost_coins: 30,
  grade_points: '0.30',
  status: 'pending' as const,
  redeemed_at: new Date('2026-11-10T12:00:00Z'),
  reversed_at: null,
  resolved_at: null,
};

/** Fila de la cola/historial (nombres ya unidos por el SQL). */
const FILA_LISTADO = {
  id: 7n,
  cost_coins: 30,
  status: 'pending' as const,
  redeemed_at: new Date('2026-11-10T12:00:00Z'),
  item_name: 'Bono de 0.3 en el examen',
  student_first_name: 'Ana',
  student_last_name: 'López',
};

const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>();
const create = jest.fn<Promise<unknown>, [unknown]>();
const update = jest.fn<Promise<unknown>, [unknown]>();
const findUniqueCanje = jest.fn<Promise<unknown>, [unknown]>();
const findUniqueInscripcion = jest.fn<Promise<unknown>, [unknown]>();
const findUniqueItem = jest.fn<Promise<unknown>, [unknown]>();

/** Doble de la transacción: el callback recibe el mismo `tx`. */
const tx = {
  $queryRaw: queryRaw,
  redemptions: { create, update, findUnique: findUniqueCanje },
  enrollments: { findUnique: findUniqueInscripcion },
  redeemable_items: { findUnique: findUniqueItem },
};

const transaction = jest.fn<Promise<unknown>, [(doble: typeof tx) => unknown]>();

const service = new RedemptionsService({
  $queryRaw: queryRaw,
  $transaction: transaction,
} as never);

/** Resultados que devolverá `$queryRaw`, en orden de llamada. */
let resultados: unknown[][];

/**
 * Encola los resultados de las próximas consultas crudas.
 *
 * @param filas Resultados en el orden en que el service las consulta.
 */
function encolar(...filas: unknown[][]): void {
  resultados.push(...filas);
}

beforeEach(() => {
  jest.clearAllMocks();
  resultados = [];
  queryRaw.mockImplementation(() => {
    const siguiente = resultados.shift();
    if (siguiente === undefined) {
      throw new Error('$queryRaw sin resultado encolado en la prueba');
    }
    return Promise.resolve(siguiente);
  });
  transaction.mockImplementation(async (doble) => doble(tx));
  create.mockResolvedValue(CANJE);
  update.mockResolvedValue(CANJE);
});

describe('previsualizarCanje', () => {
  it('404 anti-enumeración cuando el id no es numérico', async () => {
    await expect(
      service.previsualizarCanje('abc', ESTUDIANTE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('404 cuando el ítem no existe', async () => {
    encolar([]);

    await expect(
      service.previsualizarCanje('3', ESTUDIANTE),
    ).rejects.toThrow(MENSAJE_ITEM_NO_EXISTE);
  });

  it('404 cuando no hay inscripción activa en la clase del ítem', async () => {
    encolar([ITEM], []);

    await expect(
      service.previsualizarCanje('3', ESTUDIANTE),
    ).rejects.toThrow(MENSAJE_SIN_INSCRIPCION);
  });

  it('devuelve costo, saldo y stock cuando el canje es posible', async () => {
    encolar([ITEM], [{ id: 9n, coins_available: 120 }]);

    const vista = await service.previsualizarCanje('3', ESTUDIANTE);

    expect(vista).toEqual({
      item: {
        id: '3',
        nombre: 'Bono de 0.3 en el examen',
        tipo: 'grade_bonus',
        costoMonedas: 30,
        stock: 4,
        puntosNota: '0.30',
        disponible: true,
      },
      saldo: { monedasDisponibles: 120 },
      puedeCanjear: true,
      motivo: null,
    });
  });

  it('explica el saldo insuficiente con los números concretos', async () => {
    encolar([ITEM], [{ id: 9n, coins_available: 10 }]);

    const vista = await service.previsualizarCanje('3', ESTUDIANTE);

    expect(vista.puedeCanjear).toBe(false);
    expect(vista.motivo).toBe(
      'No tienes monedas suficientes: necesitas 30 y tienes 10.',
    );
  });

  it('bloquea por stock agotado', async () => {
    encolar([{ ...ITEM, stock: 0 }], [{ id: 9n, coins_available: 120 }]);

    const vista = await service.previsualizarCanje('3', ESTUDIANTE);

    expect(vista.motivo).toBe('El ítem se quedó sin stock.');
  });

  it('bloquea un ítem inactivo y trata el stock null como ilimitado', async () => {
    encolar(
      [{ ...ITEM, status: 'inactive', stock: null }],
      [{ id: 9n, coins_available: 120 }],
    );

    const vista = await service.previsualizarCanje('3', ESTUDIANTE);

    expect(vista.item.stock).toBeNull();
    expect(vista.item.disponible).toBe(false);
    expect(vista.motivo).toBe('El ítem no está disponible.');
  });
});

describe('canjear', () => {
  it('404 cuando el estudiante no está inscrito en la clase', async () => {
    encolar([]);

    await expect(service.canjear('3', ESTUDIANTE)).rejects.toThrow(
      MENSAJE_SIN_INSCRIPCION,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('404 cuando el ítem desapareció entre la previsualización y la confirmación', async () => {
    encolar([{ id: 9n, coins_available: 120 }], []);

    await expect(service.canjear('3', ESTUDIANTE)).rejects.toThrow(
      MENSAJE_ITEM_NO_EXISTE,
    );
  });

  it('422 `Saldo insuficiente` sin crear la fila', async () => {
    encolar(
      [{ id: 9n, coins_available: 10 }],
      [{ ...ITEM, teacher_id: 2n }],
    );

    const error = await service
      .canjear('3', ESTUDIANTE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).message).toBe(
      'Saldo insuficiente',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('422 `Sin stock disponible` sin crear la fila', async () => {
    encolar(
      [{ id: 9n, coins_available: 120 }],
      [{ ...ITEM, stock: 0, teacher_id: 2n }],
    );

    await expect(service.canjear('3', ESTUDIANTE)).rejects.toThrow(
      'Sin stock disponible',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('crea el canje en `pending` explícito con el costo del ítem', async () => {
    encolar(
      [{ id: 9n, coins_available: 120 }],
      [{ ...ITEM, teacher_id: 2n }],
    );

    const canje = await service.canjear('3', ESTUDIANTE);

    expect(create).toHaveBeenCalledWith({
      data: {
        enrollment_id: 9n,
        item_id: 3n,
        cost_coins: 30,
        status: 'pending',
      },
    });
    expect(update).not.toHaveBeenCalled();
    expect(canje.estado).toBe('pending');
    expect(canje.aprobacionAutomatica).toBe(false);
    expect(canje.costoMonedas).toBe(30);
  });

  it('auto-aprueba en la misma transacción cuando el ítem lo permite', async () => {
    encolar(
      [{ id: 9n, coins_available: 120 }],
      [{ ...ITEM, auto_approve: true, teacher_id: 2n }],
    );
    update.mockResolvedValue({
      ...CANJE,
      status: 'approved',
      resolved_at: new Date('2026-11-10T12:01:00Z'),
    });

    const canje = await service.canjear('3', ESTUDIANTE);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: {
        status: 'approved',
        resolved_by: 2n,
        resolved_at: expect.any(Date) as Date,
      },
    });
    expect(canje.estado).toBe('approved');
    expect(canje.aprobacionAutomatica).toBe(true);
  });
});

describe('anular', () => {
  it('404 cuando el id no es numérico', async () => {
    await expect(service.anular('x', ESTUDIANTE)).rejects.toThrow(
      MENSAJE_CANJE_NO_EXISTE,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('404 cuando el canje no existe', async () => {
    findUniqueCanje.mockResolvedValue(null);

    await expect(service.anular('7', ESTUDIANTE)).rejects.toThrow(
      MENSAJE_CANJE_NO_EXISTE,
    );
  });

  it('404 cuando el canje es de otra persona (anti-enumeración)', async () => {
    findUniqueCanje.mockResolvedValue({ ...CANJE, status: 'completed' });
    findUniqueInscripcion.mockResolvedValue({ student_id: 99n });

    await expect(service.anular('7', ESTUDIANTE)).rejects.toThrow(
      MENSAJE_CANJE_NO_EXISTE,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('409 cuando el canje ya no está `completed` (flujo revisable)', async () => {
    findUniqueCanje.mockResolvedValue(CANJE);
    findUniqueInscripcion.mockResolvedValue({ student_id: 5n });

    await expect(service.anular('7', ESTUDIANTE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('anula un canje legado `completed` y sella `reversed_at`', async () => {
    findUniqueCanje.mockResolvedValue({ ...CANJE, status: 'completed' });
    findUniqueInscripcion.mockResolvedValue({ student_id: 5n });
    update.mockResolvedValue({
      ...CANJE,
      status: 'reversed',
      reversed_at: new Date('2026-11-10T13:00:00Z'),
    });
    findUniqueItem.mockResolvedValue({
      name: 'Bono de 0.3 en el examen',
      auto_approve: false,
    });

    const canje = await service.anular('7', ESTUDIANTE);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { status: 'reversed', reversed_at: expect.any(Date) as Date },
    });
    expect(canje.estado).toBe('reversed');
    expect(canje.reversadoEn).toBe('2026-11-10T13:00:00.000Z');
    expect(canje.nombreItem).toBe('Bono de 0.3 en el examen');
  });

  it('tolera que el ítem ya no exista al mapear la respuesta', async () => {
    findUniqueCanje.mockResolvedValue({ ...CANJE, status: 'completed' });
    findUniqueInscripcion.mockResolvedValue({ student_id: 5n });
    update.mockResolvedValue({ ...CANJE, status: 'reversed' });
    findUniqueItem.mockResolvedValue(null);

    const canje = await service.anular('7', ESTUDIANTE);

    expect(canje.nombreItem).toBe('');
    expect(canje.aprobacionAutomatica).toBe(false);
  });
});

describe('colaPendientes', () => {
  it('pagina con los valores por defecto y mapea la fila', async () => {
    encolar([FILA_LISTADO], [{ total: 1n }]);

    const listado = await service.colaPendientes({}, PROFESOR);

    expect(listado).toEqual({
      data: [
        {
          id: '7',
          nombreEstudiante: 'Ana López',
          nombreItem: 'Bono de 0.3 en el examen',
          costoMonedas: 30,
          estado: 'pending',
          solicitadoEn: '2026-11-10T12:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 20 },
    });
  });

  it('respeta page/limit y devuelve total 0 sin filas', async () => {
    encolar([], [{ total: '0' }]);

    const listado = await service.colaPendientes(
      { page: 3, limit: 5 },
      PROFESOR,
    );

    expect(listado.data).toEqual([]);
    expect(listado.meta).toEqual({ total: 0, page: 3, limit: 5 });
  });
});

describe('historial', () => {
  it('mapea los canjes del estudiante con su meta', async () => {
    encolar([FILA_LISTADO, { ...FILA_LISTADO, id: 8n, status: 'rejected' }], [
      { total: 2 },
    ]);

    const listado = await service.historial({ page: 1, limit: 20 }, ESTUDIANTE);

    expect(listado.data).toHaveLength(2);
    expect(listado.data[1].estado).toBe('rejected');
    expect(listado.meta.total).toBe(2);
  });

  it('normaliza el total cuando la BD no devuelve filas de conteo', async () => {
    encolar([], []);

    const listado = await service.historial({}, ESTUDIANTE);

    expect(listado.meta.total).toBe(0);
    expect(listado.meta).toEqual({ total: 0, page: 1, limit: 20 });
  });
});

describe('resoluciones del profesor', () => {
  it('404 cuando el id no es numérico (aprobar, rechazar y entregar)', async () => {
    for (const accion of ['aprobar', 'rechazar', 'entregar'] as const) {
      await expect(service[accion]('abc', PROFESOR)).rejects.toThrow(
        MENSAJE_CANJE_NO_EXISTE,
      );
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('404 cuando el canje no existe', async () => {
    encolar([]);

    await expect(service.aprobar('7', PROFESOR)).rejects.toThrow(
      MENSAJE_CANJE_NO_EXISTE,
    );
  });

  it('403 cuando el profesor no imparte la clase del canje', async () => {
    encolar([{ id: 7n, status: 'pending', resolved_at: null, teacher_id: 99n }]);

    const error = await service
      .aprobar('7', PROFESOR)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(
      MENSAJE_SIN_PERMISO_RESOLVER,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('409 al aprobar o rechazar un canje que ya no está `pending`', async () => {
    encolar([
      { id: 7n, status: 'approved', resolved_at: null, teacher_id: 2n },
    ]);

    await expect(service.rechazar('7', PROFESOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('409 al entregar un canje que aún no está `approved`', async () => {
    encolar([
      { id: 7n, status: 'pending', resolved_at: null, teacher_id: 2n },
    ]);

    await expect(service.entregar('7', PROFESOR)).rejects.toThrow(
      MENSAJE_CANJE_YA_RESUELTO,
    );
  });

  it('aprueba con un solo UPDATE que escribe la auditoría', async () => {
    encolar([{ id: 7n, status: 'pending', resolved_at: null, teacher_id: 2n }]);
    update.mockResolvedValue({
      ...CANJE,
      status: 'approved',
      resolved_at: new Date('2026-11-10T12:05:00Z'),
    });

    const resolucion = await service.aprobar('7', PROFESOR);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: {
        status: 'approved',
        resolved_by: 2n,
        resolved_at: expect.any(Date) as Date,
      },
    });
    expect(resolucion).toEqual({
      id: '7',
      estado: 'approved',
      resueltoEn: '2026-11-10T12:05:00.000Z',
    });
  });

  it('rechaza y deja la reversión de monedas/stock al trigger', async () => {
    encolar([{ id: 7n, status: 'pending', resolved_at: null, teacher_id: 2n }]);
    update.mockResolvedValue({
      ...CANJE,
      status: 'rejected',
      resolved_at: new Date('2026-11-10T12:06:00Z'),
    });

    const resolucion = await service.rechazar('7', PROFESOR);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: {
        status: 'rejected',
        resolved_by: 2n,
        resolved_at: expect.any(Date) as Date,
      },
    });
    expect(resolucion.estado).toBe('rejected');
  });

  it('entrega conservando el `resolved_at` de la aprobación', async () => {
    const aprobadoEn = new Date('2026-11-10T12:05:00Z');
    encolar([
      { id: 7n, status: 'approved', resolved_at: aprobadoEn, teacher_id: 2n },
    ]);
    update.mockResolvedValue({
      ...CANJE,
      status: 'delivered',
      resolved_at: aprobadoEn,
    });

    const resolucion = await service.entregar('7', PROFESOR);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { status: 'delivered' },
    });
    expect(resolucion).toEqual({
      id: '7',
      estado: 'delivered',
      resueltoEn: '2026-11-10T12:05:00.000Z',
    });
  });

  it('usa la época si ni el UPDATE ni la fila traen `resolved_at`', async () => {
    encolar([{ id: 7n, status: 'approved', resolved_at: null, teacher_id: 2n }]);
    update.mockResolvedValue({ ...CANJE, status: 'delivered', resolved_at: null });

    const resolucion = await service.entregar('7', PROFESOR);

    expect(resolucion.resueltoEn).toBe(new Date(0).toISOString());
  });
});
