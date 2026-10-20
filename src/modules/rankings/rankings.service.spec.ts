import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import { RankingsService } from './rankings.service';

interface PrismaMock {
  enrollments: {
    findFirst: jest.Mock<
      Promise<unknown>,
      [{ where: object; select: object }]
    >;
  };
  $queryRaw: jest.Mock<Promise<unknown[]>, [Prisma.Sql]>;
}

interface AutorizacionMock {
  verificarPertenencia: jest.Mock<
    Promise<void>,
    [string, string, UsuarioAutenticado]
  >;
}

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const ESTUDIANTE: UsuarioAutenticado = {
  id: '3',
  username: 'est.perez',
  role: 'student',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const ADMIN: UsuarioAutenticado = {
  id: '1',
  username: 'admin',
  role: 'admin',
  organizacionId: null,
  debeCambiarContrasena: false,
};

const FILAS_RANKING = [
  {
    position: 1n,
    student_id: 10n,
    first_name: 'Juan',
    last_name: 'Pérez',
    coins_earned: 120n,
    coins_available: 100n,
  },
  {
    position: 2n,
    student_id: 11n,
    first_name: 'María',
    last_name: 'Gómez',
    coins_earned: 60n,
    coins_available: 60n,
  },
];

const DATA_ESPERADA = [
  {
    posicion: 1,
    estudianteId: '10',
    nombres: 'Juan Pérez',
    monedasGanadas: 120,
    monedasDisponibles: 100,
  },
  {
    posicion: 2,
    estudianteId: '11',
    nombres: 'María Gómez',
    monedasGanadas: 60,
    monedasDisponibles: 60,
  },
];

describe('RankingsService', () => {
  let rankingsService: RankingsService;
  let prisma: PrismaMock;
  let autorizacion: AutorizacionMock;

  beforeEach(() => {
    prisma = {
      enrollments: {
        findFirst: jest.fn<
          Promise<unknown>,
          [{ where: object; select: object }]
        >(),
      },
      $queryRaw: jest.fn<Promise<unknown[]>, [Prisma.Sql]>(),
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    rankingsService = new RankingsService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
    );
  });

  /** Texto y valores del SQL capturado en la llamada n de $queryRaw. */
  const sqlDe = (indice: number): { sql: string; values: unknown[] } => {
    const captura = prisma.$queryRaw.mock.calls[indice][0] as unknown as {
      sql: string;
      values: unknown[];
    };
    return captura;
  };

  describe('global', () => {
    it('U2: happy path con meta correcta y 2 llamadas (filas + conteo)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(FILAS_RANKING)
        .mockResolvedValueOnce([{ total: BigInt(2) }]);

      const resultado = await rankingsService.global(ESTUDIANTE);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(resultado).toEqual({
        data: DATA_ESPERADA,
        meta: { total: 2, page: 1, limit: 20 },
      });
    });

    it('U3: student/teacher filtran el SQL por organization_id del token', async () => {
      for (const usuario of [ESTUDIANTE, PROFESOR]) {
        prisma.$queryRaw.mockClear();
        prisma.$queryRaw.mockResolvedValue([]);

        await rankingsService.global(usuario, 1, 20);

        const filas = sqlDe(0);
        expect(filas.sql).toContain('global_ranking');
        expect(filas.sql).toContain('organization_id = ?');
        expect(filas.values).toContain(BigInt('1'));
        const conteo = sqlDe(1);
        expect(conteo.sql).toContain('count(*) AS total');
        expect(conteo.sql).toContain('organization_id = ?');
        expect(conteo.values).toContain(BigInt('1'));
      }
    });

    it('U4: admin consulta sin filtro de organización', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await rankingsService.global(ADMIN, 1, 20);

      expect(sqlDe(0).sql).toContain('global_ranking');
      expect(sqlDe(0).sql).not.toContain('organization_id');
      expect(sqlDe(1).sql).not.toContain('organization_id');
    });

    it('U5: token sin organización devuelve vacío sin consultar', async () => {
      for (const base of [ESTUDIANTE, PROFESOR]) {
        prisma.$queryRaw.mockClear();

        const resultado = await rankingsService.global(
          { ...base, organizacionId: null },
          3,
          5,
        );

        expect(resultado).toEqual({
          data: [],
          meta: { total: 0, page: 3, limit: 5 },
        });
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      }
    });
  });

  describe('porClase', () => {
    it('U6: teacher dueño recibe el happy path paginado', async () => {
      autorizacion.verificarPertenencia.mockResolvedValue(undefined);
      prisma.$queryRaw
        .mockResolvedValueOnce(FILAS_RANKING)
        .mockResolvedValueOnce([{ total: BigInt(2) }]);

      const resultado = await rankingsService.porClase('5', PROFESOR, 2, 10);

      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '5',
        PROFESOR,
      );
      expect(prisma.enrollments.findFirst).not.toHaveBeenCalled();
      const filas = sqlDe(0);
      expect(filas.sql).toContain('class_ranking');
      expect(filas.sql).toContain('class_id = ?');
      expect(filas.sql).toContain(
        'ORDER BY coins_earned DESC, first_name ASC, student_id ASC',
      );
      expect(filas.values).toContain(BigInt(5));
      expect(filas.values).toContain(10);
      expect(resultado).toEqual({
        data: DATA_ESPERADA,
        meta: { total: 2, page: 2, limit: 10 },
      });
    });

    it('U7: teacher ajeno propaga el 404 sin consultar el ranking', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        rankingsService.porClase('5', PROFESOR, 1, 20),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.enrollments.findFirst).not.toHaveBeenCalled();
    });

    it('U8: student con inscripción active recibe el happy path', async () => {
      prisma.enrollments.findFirst.mockResolvedValue({ id: BigInt(9) });
      prisma.$queryRaw
        .mockResolvedValueOnce(FILAS_RANKING)
        .mockResolvedValueOnce([{ total: BigInt(2) }]);

      const resultado = await rankingsService.porClase('5', ESTUDIANTE, 1, 20);

      expect(prisma.enrollments.findFirst).toHaveBeenCalledWith({
        where: {
          class_id: BigInt(5),
          student_id: BigInt(3),
          status: 'active',
        },
        select: { id: true },
      });
      expect(autorizacion.verificarPertenencia).not.toHaveBeenCalled();
      expect(resultado.data).toEqual(DATA_ESPERADA);
    });

    it('U9: student sin inscripción active recibe 404 sin query de ranking', async () => {
      prisma.enrollments.findFirst.mockResolvedValue(null);

      await expect(
        rankingsService.porClase('5', ESTUDIANTE, 1, 20),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('U10: admin pasa sin autorización ni inscripción', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);

      const resultado = await rankingsService.porClase('5', ADMIN, 1, 20);

      expect(autorizacion.verificarPertenencia).not.toHaveBeenCalled();
      expect(prisma.enrollments.findFirst).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(resultado).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });
    });

    it('U11: :id no numérico responde 404 sin tocar la BD', async () => {
      for (const id of ['abc', '1.5', '']) {
        await expect(
          rankingsService.porClase(id, ESTUDIANTE, 1, 20),
        ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      }
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.enrollments.findFirst).not.toHaveBeenCalled();
      expect(autorizacion.verificarPertenencia).not.toHaveBeenCalled();
    });
  });
});
