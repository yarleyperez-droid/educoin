import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from './autorizacion.service';

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: true,
};

const ESTUDIANTE: UsuarioAutenticado = {
  id: '3',
  username: 'est.perez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: true,
};

const ADMIN: UsuarioAutenticado = {
  id: '1',
  username: 'admin',
  role: 'admin',
  organizacionId: null,
  debeCambiarContrasena: true,
};

interface PrismaMock {
  classes: { findFirst: jest.Mock<Promise<unknown>, [object]> };
  enrollments: { findFirst: jest.Mock<Promise<unknown>, [object]> };
  activities: { findFirst: jest.Mock<Promise<unknown>, [object]> };
  submissions: { findFirst: jest.Mock<Promise<unknown>, [object]> };
  redeemable_items: { findFirst: jest.Mock<Promise<unknown>, [object]> };
  redemptions: { findFirst: jest.Mock<Promise<unknown>, [object]> };
}

describe('AutorizacionService', () => {
  let service: AutorizacionService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = {
      classes: { findFirst: jest.fn<Promise<unknown>, [object]>() },
      enrollments: { findFirst: jest.fn<Promise<unknown>, [object]>() },
      activities: { findFirst: jest.fn<Promise<unknown>, [object]>() },
      submissions: { findFirst: jest.fn<Promise<unknown>, [object]>() },
      redeemable_items: { findFirst: jest.fn<Promise<unknown>, [object]>() },
      redemptions: { findFirst: jest.fn<Promise<unknown>, [object]>() },
    };
    service = new AutorizacionService(prisma as unknown as PrismaService);
  });

  describe('regla: clase', () => {
    it('permite al profesor dueño (classes.teacher_id = usuario)', async () => {
      prisma.classes.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('clase', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.classes.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), teacher_id: BigInt(2) },
        select: { id: true },
      });
    });

    it('rechaza con 404 al profesor de otra clase', async () => {
      prisma.classes.findFirst.mockResolvedValue(null);

      await expect(
        service.verificarPertenencia('clase', '1', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('rechaza con 404 a cualquier estudiante sin consultar la BD', async () => {
      await expect(
        service.verificarPertenencia('clase', '1', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('regla: inscripcion', () => {
    it('permite al estudiante dueño (enrollments.student_id)', async () => {
      prisma.enrollments.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('inscripcion', '1', ESTUDIANTE),
      ).resolves.toBeUndefined();
      expect(prisma.enrollments.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), student_id: BigInt(3) },
        select: { id: true },
      });
    });

    it('permite al profesor de la clase de la inscripción (join classes.teacher_id)', async () => {
      prisma.enrollments.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('inscripcion', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.enrollments.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), classes: { teacher_id: BigInt(2) } },
        select: { id: true },
      });
    });

    it('rechaza con 404 la inscripción de otro estudiante', async () => {
      prisma.enrollments.findFirst.mockResolvedValue(null);

      await expect(
        service.verificarPertenencia('inscripcion', '2', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });
  });

  describe('regla: actividad', () => {
    it('permite al profesor dueño de la clase de la actividad', async () => {
      prisma.activities.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('actividad', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.activities.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), classes: { teacher_id: BigInt(2) } },
        select: { id: true },
      });
    });

    it('rechaza con 404 al estudiante (las actividades no son suyas)', async () => {
      await expect(
        service.verificarPertenencia('actividad', '1', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.activities.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('regla: entrega', () => {
    it('permite al estudiante dueño vía su inscripción', async () => {
      prisma.submissions.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('entrega', '1', ESTUDIANTE),
      ).resolves.toBeUndefined();
      expect(prisma.submissions.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), enrollments: { student_id: BigInt(3) } },
        select: { id: true },
      });
    });

    it('permite al profesor vía la clase de la inscripción de la entrega', async () => {
      prisma.submissions.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('entrega', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.submissions.findFirst).toHaveBeenCalledWith({
        where: {
          id: BigInt(1),
          enrollments: { classes: { teacher_id: BigInt(2) } },
        },
        select: { id: true },
      });
    });
  });

  describe('regla: item', () => {
    it('permite al profesor dueño de la clase del ítem', async () => {
      prisma.redeemable_items.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('item', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.redeemable_items.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), classes: { teacher_id: BigInt(2) } },
        select: { id: true },
      });
    });

    it('rechaza con 404 al estudiante', async () => {
      await expect(
        service.verificarPertenencia('item', '1', ESTUDIANTE),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.redeemable_items.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('regla: canje', () => {
    it('permite al estudiante dueño vía su inscripción', async () => {
      prisma.redemptions.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('canje', '1', ESTUDIANTE),
      ).resolves.toBeUndefined();
      expect(prisma.redemptions.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), enrollments: { student_id: BigInt(3) } },
        select: { id: true },
      });
    });

    it('permite al profesor vía la clase de la inscripción del canje', async () => {
      prisma.redemptions.findFirst.mockResolvedValue({ id: BigInt(1) });

      await expect(
        service.verificarPertenencia('canje', '1', PROFESOR),
      ).resolves.toBeUndefined();
      expect(prisma.redemptions.findFirst).toHaveBeenCalledWith({
        where: {
          id: BigInt(1),
          enrollments: { classes: { teacher_id: BigInt(2) } },
        },
        select: { id: true },
      });
    });
  });

  describe('casos transversales', () => {
    it('el admin pasa siempre sin consultar la BD', async () => {
      await expect(
        service.verificarPertenencia('clase', '1', ADMIN),
      ).resolves.toBeUndefined();
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });

    it('un id no numérico se trata como recurso inexistente (404)', async () => {
      await expect(
        service.verificarPertenencia('clase', 'abc', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });

    it('un recurso inexistente devuelve el mismo 404 que un recurso ajeno', async () => {
      prisma.classes.findFirst.mockResolvedValue(null);

      await expect(
        service.verificarPertenencia('clase', '999', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('un tipo de recurso desconocido se rechaza con 404 sin consultar la BD', async () => {
      await expect(
        service.verificarPertenencia('inventado' as never, '1', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.findFirst).not.toHaveBeenCalled();
    });
  });
});
