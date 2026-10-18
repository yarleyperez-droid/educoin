import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { organization_type } from '../../generated/prisma/client';
import { MENSAJE_SIN_ROL } from '../../common/guards/roles.guard';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../autorizacion/autorizacion.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CrearOrganizacionDto } from './dto/crear-organizacion.dto';
import type { ActualizarOrganizacionDto } from './dto/actualizar-organizacion.dto';
import type { ListarOrganizacionesQueryDto } from './dto/listar-organizaciones.dto';
import type {
  ListadoOrganizacionesDto,
  OrganizacionCreadaRespuestaDto,
  OrganizacionRespuestaDto,
} from './dto/organizacion-respuesta.dto';

/** Mensaje de éxito de la creación (misma idea que mensajeClaseCreada). */
export const MENSAJE_ORGANIZACION_CREADA = 'Organización creada con éxito.';

/** 400 cuando el PATCH no lleva ningún campo para actualizar. */
export const MENSAJE_ACTUALIZACION_VACIA =
  'Debes enviar al menos un campo para actualizar: nombre, tipo, ciudad o activa.';

/** Campos leídos de la tabla organizations (AGENTS.md §5: nombres reales de la BD). */
interface Organizacion {
  id: bigint;
  name: string;
  type: organization_type;
  city: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const CAMPOS_ORGANIZACION = {
  id: true,
  name: true,
  type: true,
  city: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

const CAMPOS_ADMIN = {
  id: true,
} as const;

/**
 * CRUD de organizaciones para el panel del administrador
 * (AGENTS.md §5: solo el admin las registra).
 *
 * Autorización: las organizaciones son un recurso GLOBAL del admin, sin
 * dueño por usuario, así que @PerteneceA no registra 'organizacion' (su
 * único gestor, el admin, pasa siempre ese guard; docs/guard_pertenencia.md
 * §4). La restricción completa es @Roles('admin') en el controller —
 * Http: JwtAuthGuard → RolesGuard, ambos globales — más esta segunda
 * capa en el Service (AGENTS.md §8): asegurarAdmin re-verifica el rol
 * para que los métodos también sean seguros en flujos internos.
 *
 * Errores de BD: el filtro global traduce P2002 (nombre duplicado) a
 * 409 y P2025 (registro inexistente) a 404; el service valida primero
 * para dar errores claros (AGENTS.md §6). updated_at jamás se escribe:
 * lo mantiene el trigger fn_set_updated_at.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una organización. is_active lo aporta el DEFAULT de la BD
   * (TRUE) y jamás se acepta del body; created_at/updated_at van con
   * sus DEFAULT/trigger (AGENTS.md §7). El nombre duplicado falla por
   * organizations.name UNIQUE (P2002 → 409 vía el filtro global).
   *
   * Defensa en profundidad (patrón de ClassesService.crear): el token
   * pudo firmarse antes de que el admin fuera desactivado o eliminado;
   * la BD se re-verifica aquí antes del INSERT.
   */
  async crear(
    dto: CrearOrganizacionDto,
    usuario: UsuarioAutenticado,
  ): Promise<OrganizacionCreadaRespuestaDto> {
    this.asegurarAdmin(usuario);

    const idAdmin = this.aBigInt(usuario.id);
    if (idAdmin === null) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    const admin = await this.prisma.users.findFirst({
      where: { id: idAdmin, role: 'admin', is_active: true },
      select: CAMPOS_ADMIN,
    });
    if (admin === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const organizacion = await this.prisma.organizations.create({
      data: { name: dto.nombre, type: dto.tipo, city: dto.ciudad ?? null },
      select: CAMPOS_ORGANIZACION,
    });

    return {
      mensaje: MENSAJE_ORGANIZACION_CREADA,
      organizacion: this.aOrganizacionRespuesta(organizacion),
    };
  }

  /**
   * Lista las organizaciones con la paginación estándar { data, meta }
   * y filtros opcionales de nombre (contains insensible), tipo y
   * estado activo. El conteo del total repite el mismo WHERE en una
   * consulta aparte (patrón de ClassesService.listarEstudiantes).
   */
  async listar(
    dto: ListarOrganizacionesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoOrganizacionesDto> {
    this.asegurarAdmin(usuario);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: Prisma.organizationsWhereInput = {};
    if (dto.q !== undefined) {
      where.name = { contains: dto.q, mode: 'insensitive' };
    }
    if (dto.tipo !== undefined) {
      where.type = dto.tipo;
    }
    if (dto.activa !== undefined) {
      where.is_active = dto.activa;
    }

    const organizaciones = await this.prisma.organizations.findMany({
      where,
      select: CAMPOS_ORGANIZACION,
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.organizations.count({ where });

    return {
      data: organizaciones.map((organizacion) =>
        this.aOrganizacionRespuesta(organizacion),
      ),
      meta: { total, page, limit },
    };
  }

  /**
   * Devuelve el detalle de una organización. Los ids no numéricos
   * reciben el 404 estándar ANTES de BigInt(): la conversión lanzaría
   * un SyntaxError que el filtro global traduciría a 500.
   */
  async buscarPorId(
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    this.asegurarAdmin(usuario);

    const idOrganizacion = this.aBigInt(id);
    if (idOrganizacion === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const organizacion = await this.prisma.organizations.findFirst({
      where: { id: idOrganizacion },
      select: CAMPOS_ORGANIZACION,
    });
    if (organizacion === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    return this.aOrganizacionRespuesta(organizacion);
  }

  /**
   * Edita parcialmente una organización: nombre, tipo, ciudad (null la
   * limpia) y/o estado activo. Solo los campos presentes llegan al
   * UPDATE — ni created_at ni updated_at (trigger fn_set_updated_at).
   * Un registro inexistente falla con P2025 → 404 estándar vía el
   * filtro global; el nombre duplicado con P2002 → 409.
   */
  async actualizar(
    id: string,
    dto: ActualizarOrganizacionDto,
    usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    this.asegurarAdmin(usuario);

    if (
      dto.nombre === undefined &&
      dto.tipo === undefined &&
      dto.ciudad === undefined &&
      dto.activa === undefined
    ) {
      throw new BadRequestException(MENSAJE_ACTUALIZACION_VACIA);
    }

    const idOrganizacion = this.aBigInt(id);
    if (idOrganizacion === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const data: {
      name?: string;
      type?: organization_type;
      city?: string | null;
      is_active?: boolean;
    } = {};
    if (dto.nombre !== undefined) {
      data.name = dto.nombre;
    }
    if (dto.tipo !== undefined) {
      data.type = dto.tipo;
    }
    if (dto.ciudad !== undefined) {
      data.city = dto.ciudad;
    }
    if (dto.activa !== undefined) {
      data.is_active = dto.activa;
    }

    const organizacion = await this.prisma.organizations.update({
      where: { id: idOrganizacion },
      data,
      select: CAMPOS_ORGANIZACION,
    });

    return this.aOrganizacionRespuesta(organizacion);
  }

  /**
   * Borrado LÓGICO de una organización: is_active=false, nunca DELETE
   * físico (decisión del equipo; la tabla no tiene deleted_at y ninguna
   * tabla se vacía a mano, contexto_mvp §2.7). El registro sigue
   * existiendo — el detalle lo devuelve con activa=false — y solo se
   * reactiva con PATCH { activa: true }. La operación es idempotente:
   * repetirla sobre una organización ya desactivada vuelve a dar 204.
   * updated_at lo renueva el trigger; el registro inexistente falla
   * con P2025 → 404 estándar vía el filtro global.
   */
  async eliminar(id: string, usuario: UsuarioAutenticado): Promise<void> {
    this.asegurarAdmin(usuario);

    const idOrganizacion = this.aBigInt(id);
    if (idOrganizacion === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    await this.prisma.organizations.update({
      where: { id: idOrganizacion },
      data: { is_active: false },
      select: CAMPOS_ORGANIZACION,
    });
  }

  /**
   * Segunda capa de autorización (AGENTS.md §8): @Roles('admin') ya la
   * comprobó en HTTP con el RolesGuard global; aquí se re-verifica el
   * rol para que el service también sea seguro en flujos internos. Es
   * el equivalente organizacional de AutorizacionService para un
   * recurso sin dueño por usuario.
   */
  private asegurarAdmin(usuario: UsuarioAutenticado): void {
    if (usuario.role !== 'admin') {
      throw new ForbiddenException(MENSAJE_SIN_ROL);
    }
  }

  /** Convierte un id de ruta a BigInt; null si no es numérico. */
  private aBigInt(valor: string): bigint | null {
    try {
      return BigInt(valor);
    } catch {
      return null;
    }
  }

  private aOrganizacionRespuesta(
    organizacion: Organizacion,
  ): OrganizacionRespuestaDto {
    return {
      id: organizacion.id.toString(),
      nombre: organizacion.name,
      tipo: organizacion.type,
      ciudad: organizacion.city,
      activa: organizacion.is_active,
      creadoEn: organizacion.created_at.toISOString(),
      actualizadoEn: organizacion.updated_at.toISOString(),
    };
  }
}
