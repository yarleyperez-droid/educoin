import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ItemsService, MENSAJE_ITEMS_AJENOS } from './items.service';
import type { ActualizarItemDto } from './dto/item.dto';

/**
 * Unit de `ItemsService` sin BD (H4.1 / PRO-279): validación por tipo
 * → 422 (CA 1/2/4, T4.1.2) y traducción pertenencia → 403 uniforme
 * (CA 3 / T4.1.3). `prisma` y `autorizacionService` van mockeados.
 */

const PROFESOR: UsuarioAutenticado = {
  id: '1',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const itemCreado = {
  id: 10n,
  class_id: 1n,
  name: 'Trivia game in class',
  description: null,
  type: 'fun_activity' as const,
  cost_coins: 50,
  grade_points: null,
  stock: 5,
  status: 'active',
  created_at: new Date('2026-10-16T10:00:00Z'),
  updated_at: new Date('2026-10-16T10:00:00Z'),
};

type AltaPrisma = { data: Record<string, unknown> };
const create = jest.fn<Promise<unknown>, [AltaPrisma]>();
const findUnique = jest.fn<Promise<unknown>, [unknown]>();
const update = jest.fn<Promise<unknown>, [unknown]>();
const findMany = jest.fn<Promise<unknown[]>, [unknown]>();

const verificarPertenencia = jest.fn<Promise<void>, [unknown, unknown, unknown]>();

const service = new ItemsService(
  {
    redeemable_items: { create, findUnique, findMany, update },
  } as never,
  { verificarPertenencia } as never,
);

const altaFunActivity = {
  classId: 1,
  name: 'Trivia game in class',
  type: 'fun_activity' as const,
  costCoins: 50,
  stock: 5,
};

const altaGradeBonus = {
  classId: 1,
  name: '+0.5 on the midterm',
  type: 'grade_bonus' as const,
  costCoins: 100,
  gradePoints: 0.5,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Por defecto: la pertenencia pasa (profesor dueño) y la BD responde
  // ecoando los datos enviados (el DTO de respuesta refleja el alta real).
  verificarPertenencia.mockResolvedValue(undefined);
  create.mockImplementation((entrada) =>
    Promise.resolve({ ...itemCreado, ...entrada.data }),
  );
  findMany.mockResolvedValue([]);
  findUnique.mockResolvedValue(itemCreado);
  update.mockResolvedValue(itemCreado);
});

describe('ItemsService.crear — validación por tipo (T4.1.2)', () => {
  it('CA 1: alta válida de fun_activity con stock y costo → crea', async () => {
    const dto = await service.crear(altaFunActivity, PROFESOR);

    expect(verificarPertenencia).toHaveBeenCalledWith('clase', '1', PROFESOR);
    expect(create).toHaveBeenCalledTimes(1);
    expect(dto.type).toBe('fun_activity');
    expect(dto.stock).toBe(5);
    expect(dto.costCoins).toBe(50);
    expect(dto.status).toBe('active');
  });

  it('CA 2: alta válida de grade_bonus con grade_points → crea', async () => {
    const dto = await service.crear(altaGradeBonus, PROFESOR);

    expect(create).toHaveBeenCalledTimes(1);
    expect(dto.type).toBe('grade_bonus');
    expect(dto.gradePoints).toBe(0.5);
    expect(dto.stock).toBeNull();
  });

  it('fun_activity sin stock → 422', async () => {
    await expect(
      service.crear({ ...altaFunActivity, stock: undefined }, PROFESOR),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });

  it('grade_bonus sin grade_points → 422', async () => {
    await expect(
      service.crear({ ...altaGradeBonus, gradePoints: undefined }, PROFESOR),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });

  it('CA 4: stock negativo → 422', async () => {
    await expect(
      service.crear({ ...altaFunActivity, stock: -1 }, PROFESOR),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });

  it('CA 4: costo inválido (0) → 422', async () => {
    await expect(
      service.crear({ ...altaFunActivity, costCoins: 0 }, PROFESOR),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ItemsService — propiedad 403 uniforme (CA 3)', () => {
  it('clase ajena o inexistente (NotFound de AutorizacionService) → 403 con el mensaje único', async () => {
    verificarPertenencia.mockRejectedValue(
      new NotFoundException('El registro solicitado no fue encontrado.'),
    );

    await expect(service.crear(altaFunActivity, PROFESOR)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.crear(altaFunActivity, PROFESOR)).rejects.toThrow(
      MENSAJE_ITEMS_AJENOS,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('admin: la pertenencia pasa → crea sin 403', async () => {
    const admin: UsuarioAutenticado = { ...PROFESOR, id: '0', role: 'admin' };
    verificarPertenencia.mockResolvedValue(undefined);

    await service.crear(altaFunActivity, admin);
    expect(verificarPertenencia).toHaveBeenCalledWith('clase', '1', admin);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('ItemsService.actualizar — revalida el merge (T4.1.2)', () => {
  it('PATCH que deja un grade_bonus sin grade_points → 422 y no actualiza', async () => {
    findUnique.mockResolvedValue({
      ...itemCreado,
      type: 'grade_bonus',
      cost_coins: 100,
      grade_points: 0.5,
      stock: null,
    });
    const dto: ActualizarItemDto = { gradePoints: null };

    await expect(service.actualizar('10', dto, PROFESOR)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(verificarPertenencia).toHaveBeenCalledWith('item', '10', PROFESOR);
    expect(update).not.toHaveBeenCalled();
  });
});
