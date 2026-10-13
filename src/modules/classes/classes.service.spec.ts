import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import {
  ClassesService,
  MENSAJE_ACTUALIZACION_VACIA,
  mensajeClaseCreada,
} from './classes.service';

type ConsultaProfesor = { where: object; select: object };
type ConsultaCreate = { data: object; select: object };
type ConsultaUpdate = { where: object; data: object; select: object };

interface PrismaMock {
  users: {
    findFirst: jest.Mock<Promise<{ id: bigint } | null>, [ConsultaProfesor]>;
  };
  classes: {
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
  };
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

const CLASE_CREADA = {
  id: BigInt(5),
  teacher_id: BigInt(2),
  name: 'Proyecto integrador Prueba',
  code: 'AB12CD34',
  status: 'active' as const,
  created_at: new Date('2026-10-12T10:00:00.000Z'),
  updated_at: new Date('2026-10-12T10:00:00.000Z'),
};

function errorDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`lower(name)`)',
    { code: 'P2002', meta: { target: ['name'] }, clientVersion: 'test' },
  );
}

describe('ClassesService', () => {
  let classesService: ClassesService;
  let prisma: PrismaMock;
  let autorizacion: AutorizacionMock;

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn<
          Promise<{ id: bigint } | null>,
          [ConsultaProfesor]
        >(),
      },
      classes: {
        create: jest.fn<Promise<unknown>, [ConsultaCreate]>(),
        update: jest.fn<Promise<unknown>, [ConsultaUpdate]>(),
      },
    };
    autorizacion = {
      verificarPertenencia: jest.fn<
        Promise<void>,
        [string, string, UsuarioAutenticado]
      >(),
    };
    classesService = new ClassesService(
      prisma as unknown as PrismaService,
      autorizacion as unknown as AutorizacionService,
    );
  });

  describe('crear', () => {
    it('crea la clase SIN enviar el código: lo genera la BD', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      const resultado = await classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );

      const llamada = prisma.classes.create.mock.calls[0][0];
      expect(llamada.data).toEqual({
        teacher_id: BigInt(2),
        name: 'Proyecto integrador Prueba',
      });
      // El código, estado y fechas jamás viajan en el INSERT: son defaults
      // de la BD (AGENTS.md §7).
      expect(llamada.data).not.toHaveProperty('code');
      expect(llamada.data).not.toHaveProperty('status');
      expect(llamada.data).not.toHaveProperty('created_at');

      expect(resultado).toEqual({
        mensaje: mensajeClaseCreada('AB12CD34'),
        clase: {
          id: '5',
          profesorId: '2',
          nombre: 'Proyecto integrador Prueba',
          codigo: 'AB12CD34',
          estado: 'active',
          creadoEn: '2026-10-12T10:00:00.000Z',
          actualizadoEn: '2026-10-12T10:00:00.000Z',
        },
      });
    });

    it('el mensaje de éxito menciona el código que la BD generó', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      const resultado = await classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );

      expect(resultado.mensaje).toBe(
        'Clase creada con éxito. Comparte el código AB12CD34 con tus estudiantes.',
      );
    });

    it('verifica en la BD que el profesor exista y esté activo antes de crear', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      await classesService.crear('Proyecto integrador Prueba', PROFESOR);

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(2), role: 'teacher', is_active: true },
        select: expect.any(Object),
      });
    });

    it('usa el teacher_id del token y nunca lo recibe del cuerpo', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockResolvedValue(CLASE_CREADA);

      await classesService.crear('Proyecto integrador Prueba', PROFESOR);

      expect(prisma.classes.create.mock.calls[0][0].data).toEqual({
        teacher_id: BigInt(2),
        name: 'Proyecto integrador Prueba',
      });
    });

    it('rechaza con 404 estándar si el profesor no existe o está inactivo', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        classesService.crear('Proyecto integrador Prueba', PROFESOR),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.classes.create).not.toHaveBeenCalled();
    });

    it('rechaza con 401 ids del token no numéricos sin consultar la BD', async () => {
      const tokenCorrupto: UsuarioAutenticado = {
        ...PROFESOR,
        id: 'no-soy-numero',
      };

      await expect(
        classesService.crear('Proyecto integrador Prueba', tokenCorrupto),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.classes.create).not.toHaveBeenCalled();
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(2) });
      prisma.classes.create.mockRejectedValue(errorDuplicado());

      const promesa = classesService.crear(
        'Proyecto integrador Prueba',
        PROFESOR,
      );
      await expect(promesa).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('actualizar', () => {
    it('renombra la clase tocando solo el nombre en el UPDATE', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        name: 'Proyecto integrador Renombrado',
      });

      const resultado = await classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado' },
        PROFESOR,
      );

      // Segunda capa de pertenencia antes del UPDATE (AGENTS.md §8).
      expect(autorizacion.verificarPertenencia).toHaveBeenCalledWith(
        'clase',
        '5',
        PROFESOR,
      );
      expect(prisma.classes.update).toHaveBeenCalledWith({
        where: { id: BigInt(5) },
        data: { name: 'Proyecto integrador Renombrado' },
        select: expect.any(Object),
      });
      expect(resultado).toEqual({
        id: '5',
        profesorId: '2',
        nombre: 'Proyecto integrador Renombrado',
        codigo: 'AB12CD34',
        estado: 'active',
        creadoEn: '2026-10-12T10:00:00.000Z',
        actualizadoEn: '2026-10-12T10:00:00.000Z',
      });
    });

    it('archiva cambiando el estado a archived', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        status: 'archived' as const,
      });

      await classesService.actualizar('5', { estado: 'archived' }, PROFESOR);

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        status: 'archived',
      });
    });

    it('reactiva cambiando el estado a active', async () => {
      prisma.classes.update.mockResolvedValue(CLASE_CREADA);

      await classesService.actualizar('5', { estado: 'active' }, PROFESOR);

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        status: 'active',
      });
    });

    it('actualiza nombre y estado juntos cuando llegan ambos', async () => {
      prisma.classes.update.mockResolvedValue({
        ...CLASE_CREADA,
        name: 'Proyecto integrador Renombrado',
        status: 'archived' as const,
      });

      await classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado', estado: 'archived' },
        PROFESOR,
      );

      expect(prisma.classes.update.mock.calls[0][0].data).toEqual({
        name: 'Proyecto integrador Renombrado',
        status: 'archived',
      });
    });

    it('jamás setea updated_at ni teacher_id en el UPDATE (trigger BD)', async () => {
      prisma.classes.update.mockResolvedValue(CLASE_CREADA);

      await classesService.actualizar('5', { estado: 'archived' }, PROFESOR);

      const data = prisma.classes.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('updated_at');
      expect(data).not.toHaveProperty('teacher_id');
      expect(data).not.toHaveProperty('code');
    });

    it('rechaza con 400 un cuerpo sin campos para actualizar', async () => {
      await expect(
        classesService.actualizar('5', {}, PROFESOR),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ACTUALIZACION_VACIA));
      expect(prisma.classes.update).not.toHaveBeenCalled();
    });

    it('propaga el 404 de la pertenencia (clase ajena o inexistente) sin tocar la BD de escritura', async () => {
      autorizacion.verificarPertenencia.mockRejectedValue(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );

      await expect(
        classesService.actualizar('999', { estado: 'archived' }, PROFESOR),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.classes.update).not.toHaveBeenCalled();
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.classes.update.mockRejectedValue(errorDuplicado());

      const promesa = classesService.actualizar(
        '5',
        { nombre: 'Proyecto integrador Renombrado' },
        PROFESOR,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
