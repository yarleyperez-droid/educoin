import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { MENSAJE_SIN_ROL } from '../../common/guards/roles.guard';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../autorizacion/autorizacion.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OrganizationsService,
  MENSAJE_ACTUALIZACION_VACIA,
  MENSAJE_ORGANIZACION_CREADA,
} from './organizations.service';

type ConsultaUsuario = { where: object; select: object };
type ConsultaCreate = { data: object; select: object };
type ConsultaFind = { where: object; select: object };
type ConsultaListar = {
  where: object;
  select: object;
  orderBy: object;
  skip: number;
  take: number;
};
type ConsultaCount = { where: object };
type ConsultaUpdate = { where: object; data: object; select: object };

interface PrismaMock {
  users: {
    findFirst: jest.Mock<Promise<{ id: bigint } | null>, [ConsultaUsuario]>;
  };
  organizations: {
    create: jest.Mock<Promise<unknown>, [ConsultaCreate]>;
    findMany: jest.Mock<Promise<unknown[]>, [ConsultaListar]>;
    findFirst: jest.Mock<Promise<unknown>, [ConsultaFind]>;
    count: jest.Mock<Promise<number>, [ConsultaCount]>;
    update: jest.Mock<Promise<unknown>, [ConsultaUpdate]>;
    delete: jest.Mock<Promise<unknown>, [ConsultaCount]>;
  };
}

const ADMIN: UsuarioAutenticado = {
  id: '1',
  username: 'admin',
  role: 'admin',
  organizacionId: null,
  debeCambiarContrasena: false,
};

const PROFESOR: UsuarioAutenticado = {
  id: '2',
  username: 'prof.lopez',
  role: 'teacher',
  organizacionId: '1',
  debeCambiarContrasena: false,
};

const ORGANIZACION = {
  id: BigInt(7),
  name: 'Colegio Unit',
  type: 'school' as const,
  city: 'Buga',
  is_active: true,
  created_at: new Date('2026-10-12T10:00:00.000Z'),
  updated_at: new Date('2026-10-12T10:00:00.000Z'),
};

const ORGANIZACION_RESPUESTA = {
  id: '7',
  nombre: 'Colegio Unit',
  tipo: 'school',
  ciudad: 'Buga',
  activa: true,
  creadoEn: '2026-10-12T10:00:00.000Z',
  actualizadoEn: '2026-10-12T10:00:00.000Z',
};

function errorDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`name`)',
    { code: 'P2002', meta: { target: ['name'] }, clientVersion: 'test' },
  );
}

function errorNoEncontrado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'An operation failed because it depends on one or more records that were required but not found.',
    { code: 'P2025', clientVersion: 'test' },
  );
}

describe('OrganizationsService', () => {
  let organizationsService: OrganizationsService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = {
      users: {
        findFirst: jest.fn<Promise<{ id: bigint } | null>, [ConsultaUsuario]>(),
      },
      organizations: {
        create: jest.fn<Promise<unknown>, [ConsultaCreate]>(),
        findMany: jest.fn<Promise<unknown[]>, [ConsultaListar]>(),
        findFirst: jest.fn<Promise<unknown>, [ConsultaFind]>(),
        count: jest.fn<Promise<number>, [ConsultaCount]>(),
        update: jest.fn<Promise<unknown>, [ConsultaUpdate]>(),
        delete: jest.fn<Promise<unknown>, [ConsultaCount]>(),
      },
    };
    organizationsService = new OrganizationsService(
      prisma as unknown as PrismaService,
    );
  });

  describe('crear', () => {
    it('crea la organización con los campos del body y responde mensaje + DTO', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.organizations.create.mockResolvedValue(ORGANIZACION);

      const resultado = await organizationsService.crear(
        { nombre: 'Colegio Unit', tipo: 'school', ciudad: 'Buga' },
        ADMIN,
      );

      const llamada = prisma.organizations.create.mock.calls[0][0];
      expect(llamada.data).toEqual({
        name: 'Colegio Unit',
        type: 'school',
        city: 'Buga',
      });
      // is_active y las fechas jamás viajan en el INSERT: son defaults
      // de la BD (AGENTS.md §7).
      expect(llamada.data).not.toHaveProperty('is_active');
      expect(llamada.data).not.toHaveProperty('created_at');
      expect(llamada.data).not.toHaveProperty('updated_at');

      expect(resultado).toEqual({
        mensaje: MENSAJE_ORGANIZACION_CREADA,
        organizacion: ORGANIZACION_RESPUESTA,
      });
    });

    it('ciudad ausente viaja como null en el INSERT (columna nullable)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.organizations.create.mockResolvedValue(ORGANIZACION);

      await organizationsService.crear(
        { nombre: 'Colegio Unit', tipo: 'school' },
        ADMIN,
      );

      expect(prisma.organizations.create.mock.calls[0][0].data).toEqual({
        name: 'Colegio Unit',
        type: 'school',
        city: null,
      });
    });

    it('re-verifica en la BD que el admin exista y esté activo antes del INSERT', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.organizations.create.mockResolvedValue(ORGANIZACION);

      await organizationsService.crear(
        { nombre: 'Colegio Unit', tipo: 'school' },
        ADMIN,
      );

      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(1), role: 'admin', is_active: true },
        select: expect.any(Object),
      });
    });

    it('rechaza con 404 estándar si el admin no existe o está inactivo', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(
        organizationsService.crear(
          { nombre: 'Colegio Unit', tipo: 'school' },
          ADMIN,
        ),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.organizations.create).not.toHaveBeenCalled();
    });

    it('rechaza con 401 ids del token no numéricos sin consultar la BD', async () => {
      const tokenCorrupto: UsuarioAutenticado = {
        ...ADMIN,
        id: 'no-soy-numero',
      };

      await expect(
        organizationsService.crear(
          { nombre: 'Colegio Unit', tipo: 'school' },
          tokenCorrupto,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.organizations.create).not.toHaveBeenCalled();
    });

    it('rechaza con 403 a roles que no son admin (segunda capa del service)', async () => {
      await expect(
        organizationsService.crear(
          { nombre: 'Colegio Unit', tipo: 'school' },
          PROFESOR,
        ),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_SIN_ROL));
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.organizations.create).not.toHaveBeenCalled();
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.organizations.create.mockRejectedValue(errorDuplicado());

      const promesa = organizationsService.crear(
        { nombre: 'Colegio Unit', tipo: 'school' },
        ADMIN,
      );
      await expect(promesa).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('listar', () => {
    it('mapea organizaciones y meta de la paginación estándar { data, meta }', async () => {
      prisma.organizations.findMany.mockResolvedValue([ORGANIZACION]);
      prisma.organizations.count.mockResolvedValue(3);

      const resultado = await organizationsService.listar(
        { page: 2, limit: 10 },
        ADMIN,
      );

      expect(resultado).toEqual({
        data: [ORGANIZACION_RESPUESTA],
        meta: { total: 3, page: 2, limit: 10 },
      });
    });

    it('sin filtros consulta todas con la página 1 y 20 filas por defecto', async () => {
      prisma.organizations.findMany.mockResolvedValue([]);
      prisma.organizations.count.mockResolvedValue(0);

      const resultado = await organizationsService.listar({}, ADMIN);

      expect(prisma.organizations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
      expect(prisma.organizations.count).toHaveBeenCalledWith({
        where: {},
      });
      expect(resultado.meta).toEqual({ total: 0, page: 1, limit: 20 });
    });

    it('construye el WHERE con los filtros de nombre, tipo y activa', async () => {
      prisma.organizations.findMany.mockResolvedValue([]);
      prisma.organizations.count.mockResolvedValue(0);

      await organizationsService.listar(
        { q: 'colegio', tipo: 'school', activa: false, page: 2, limit: 10 },
        ADMIN,
      );

      const where = {
        name: { contains: 'colegio', mode: 'insensitive' },
        type: 'school',
        is_active: false,
      };
      expect(prisma.organizations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where, skip: 10, take: 10 }),
      );
      // El conteo repite el mismo WHERE para que el total sea coherente.
      expect(prisma.organizations.count).toHaveBeenCalledWith({ where });
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(organizationsService.listar({}, PROFESOR)).rejects.toThrow(
        new ForbiddenException(MENSAJE_SIN_ROL),
      );
      expect(prisma.organizations.findMany).not.toHaveBeenCalled();
      expect(prisma.organizations.count).not.toHaveBeenCalled();
    });
  });

  describe('buscarPorId', () => {
    it('devuelve la organización mapeada a DTO de respuesta', async () => {
      prisma.organizations.findFirst.mockResolvedValue(ORGANIZACION);

      const resultado = await organizationsService.buscarPorId('7', ADMIN);

      expect(prisma.organizations.findFirst).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        select: expect.any(Object),
      });
      expect(resultado).toEqual(ORGANIZACION_RESPUESTA);
    });

    it('id no numérico → 404 estándar sin consultar la BD', async () => {
      await expect(
        organizationsService.buscarPorId('abc', ADMIN),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.organizations.findFirst).not.toHaveBeenCalled();
    });

    it('inexistente → 404 estándar', async () => {
      prisma.organizations.findFirst.mockResolvedValue(null);

      await expect(
        organizationsService.buscarPorId('999', ADMIN),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(
        organizationsService.buscarPorId('7', PROFESOR),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_SIN_ROL));
      expect(prisma.organizations.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('actualizar', () => {
    it('renombra tocando solo el nombre en el UPDATE', async () => {
      prisma.organizations.update.mockResolvedValue({
        ...ORGANIZACION,
        name: 'Colegio Unit Renombrado',
      });

      const resultado = await organizationsService.actualizar(
        '7',
        { nombre: 'Colegio Unit Renombrado' },
        ADMIN,
      );

      expect(prisma.organizations.update).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        data: { name: 'Colegio Unit Renombrado' },
        select: expect.any(Object),
      });
      expect(resultado).toEqual({
        ...ORGANIZACION_RESPUESTA,
        nombre: 'Colegio Unit Renombrado',
      });
    });

    it('limpia la ciudad cuando llega null (columna nullable)', async () => {
      prisma.organizations.update.mockResolvedValue({
        ...ORGANIZACION,
        city: null,
      });

      await organizationsService.actualizar('7', { ciudad: null }, ADMIN);

      expect(prisma.organizations.update.mock.calls[0][0].data).toEqual({
        city: null,
      });
    });

    it('desactiva con activa=false y reactiva con activa=true', async () => {
      prisma.organizations.update.mockResolvedValue(ORGANIZACION);

      await organizationsService.actualizar('7', { activa: false }, ADMIN);
      expect(prisma.organizations.update.mock.calls[0][0].data).toEqual({
        is_active: false,
      });

      await organizationsService.actualizar('7', { activa: true }, ADMIN);
      expect(prisma.organizations.update.mock.calls[1][0].data).toEqual({
        is_active: true,
      });
    });

    it('actualiza nombre, tipo y ciudad juntos cuando llegan', async () => {
      prisma.organizations.update.mockResolvedValue(ORGANIZACION);

      await organizationsService.actualizar(
        '7',
        {
          nombre: 'Colegio Unit Renombrado',
          tipo: 'university',
          ciudad: 'Cali',
        },
        ADMIN,
      );

      expect(prisma.organizations.update.mock.calls[0][0].data).toEqual({
        name: 'Colegio Unit Renombrado',
        type: 'university',
        city: 'Cali',
      });
    });

    it('jamás setea created_at ni updated_at en el UPDATE (trigger BD)', async () => {
      prisma.organizations.update.mockResolvedValue(ORGANIZACION);

      await organizationsService.actualizar('7', { activa: false }, ADMIN);

      const data = prisma.organizations.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('created_at');
      expect(data).not.toHaveProperty('updated_at');
    });

    it('rechaza con 400 un cuerpo sin campos para actualizar', async () => {
      await expect(
        organizationsService.actualizar('7', {}, ADMIN),
      ).rejects.toThrow(new BadRequestException(MENSAJE_ACTUALIZACION_VACIA));
      expect(prisma.organizations.update).not.toHaveBeenCalled();
    });

    it('id no numérico → 404 estándar sin UPDATE', async () => {
      await expect(
        organizationsService.actualizar('abc', { activa: false }, ADMIN),
      ).rejects.toThrow(new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO));
      expect(prisma.organizations.update).not.toHaveBeenCalled();
    });

    it('propaga el P2025 de la inexistente (el filtro global lo traduce a 404)', async () => {
      prisma.organizations.update.mockRejectedValue(errorNoEncontrado());

      const promesa = organizationsService.actualizar(
        '999',
        { activa: false },
        ADMIN,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2025' });
    });

    it('propaga el P2002 del nombre duplicado (el filtro global lo traduce a 409)', async () => {
      prisma.organizations.update.mockRejectedValue(errorDuplicado());

      const promesa = organizationsService.actualizar(
        '7',
        { nombre: 'Colegio Unit Renombrado' },
        ADMIN,
      );
      await expect(promesa).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(
        organizationsService.actualizar('7', { activa: false }, PROFESOR),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_SIN_ROL));
      expect(prisma.organizations.update).not.toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('es borrado lógico: UPDATE is_active=false, jamás DELETE físico', async () => {
      prisma.organizations.update.mockResolvedValue({
        ...ORGANIZACION,
        is_active: false,
      });

      const resultado = await organizationsService.eliminar('7', ADMIN);

      expect(resultado).toBeUndefined();
      expect(prisma.organizations.update).toHaveBeenCalledWith({
        where: { id: BigInt(7) },
        data: { is_active: false },
        select: expect.any(Object),
      });
      expect(prisma.organizations.delete).not.toHaveBeenCalled();
    });

    it('id no numérico → 404 estándar sin UPDATE', async () => {
      await expect(organizationsService.eliminar('abc', ADMIN)).rejects.toThrow(
        new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO),
      );
      expect(prisma.organizations.update).not.toHaveBeenCalled();
    });

    it('propaga el P2025 de la inexistente (el filtro global lo traduce a 404)', async () => {
      prisma.organizations.update.mockRejectedValue(errorNoEncontrado());

      const promesa = organizationsService.eliminar('999', ADMIN);
      await expect(promesa).rejects.toMatchObject({ code: 'P2025' });
    });

    it('rechaza con 403 a roles que no son admin', async () => {
      await expect(
        organizationsService.eliminar('7', PROFESOR),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_SIN_ROL));
      expect(prisma.organizations.update).not.toHaveBeenCalled();
    });
  });

  describe('flujo: el admin crea, lista, desactiva y reactiva', () => {
    it('el id de la creación sirve para editar y desactivar la misma organización', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: BigInt(1) });
      prisma.organizations.create.mockResolvedValue(ORGANIZACION);

      const creada = await organizationsService.crear(
        { nombre: 'Colegio Unit', tipo: 'school' },
        ADMIN,
      );
      const id = creada.organizacion.id;
      expect(id).toBe('7');

      prisma.organizations.update.mockResolvedValue({
        ...ORGANIZACION,
        is_active: false,
      });
      const desactivada = await organizationsService.actualizar(
        id,
        { activa: false },
        ADMIN,
      );
      expect(desactivada.activa).toBe(false);
      expect(prisma.organizations.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BigInt(7) } }),
      );
    });
  });
});
