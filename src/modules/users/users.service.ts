import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'argon2';
import type { Prisma, user_role } from '../../generated/prisma/client';
import { MENSAJE_SIN_ROL } from '../../common/guards/roles.guard';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { MENSAJE_RECURSO_NO_ENCONTRADO } from '../autorizacion/autorizacion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_CREABLES } from './dto/crear-usuario.dto';
import type { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import type { ListarUsuariosQueryDto } from './dto/listar-usuarios.dto';
import type {
  ListadoUsuariosDto,
  UsuarioCreadoRespuestaDto,
  UsuarioRespuestaDto,
} from './dto/usuario-respuesta.dto';

/** Mensaje de éxito de la creación (misma idea que MENSAJE_ORGANIZACION_CREADA). */
export const MENSAJE_USUARIO_CREADO =
  'Usuario creado con éxito. La contraseña inicial solo se muestra esta vez: el usuario debe cambiarla en su primer inicio de sesión.';

/** 409 cuando el username ya existe (users.username CITEXT UNIQUE). */
export const MENSAJE_USERNAME_DUPLICADO =
  'Ya existe un usuario con ese nombre de usuario.';

/** 409 cuando el correo ya existe (users.email CITEXT UNIQUE). */
export const MENSAJE_CORREO_DUPLICADO =
  'Ya existe un usuario con ese correo electrónico.';

/** 400 cuando la especialidad llega en una cuenta de estudiante. */
export const MENSAJE_ESPECIALIDAD_SOLO_PROFESOR =
  'La especialidad solo puede asignarse a profesores.';

/**
 * 400 defensivo para un organizacionId no numérico (inalcanzable por
 * HTTP: el DTO lo exige con el patrón /^\d+$/, pero el service también
 * debe ser seguro en flujos internos, AGENTS.md §8).
 */
export const MENSAJE_ORGANIZACION_INVALIDA =
  'El id de organización enviado no es válido.';

/** 400 cuando el PATCH no lleva ningún campo para actualizar. */
export const MENSAJE_ACTUALIZACION_VACIA =
  'Debes enviar al menos un campo para actualizar: activa.';

/**
 * Campos leídos de la tabla users (AGENTS.md §5: nombres reales de la
 * BD). password_hash y last_login no se leen: no salen de la BD hacia
 * el cliente (AGENTS.md §8) y este módulo no los necesita.
 */
interface UsuarioCreado {
  id: bigint;
  organization_id: bigint | null;
  role: user_role;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  specialty: string | null;
  must_change_password: boolean;
  is_active: boolean;
  created_at: Date;
}

const CAMPOS_USUARIO = {
  id: true,
  organization_id: true,
  role: true,
  username: true,
  email: true,
  first_name: true,
  last_name: true,
  specialty: true,
  must_change_password: true,
  is_active: true,
  created_at: true,
} as const;

const CAMPOS_ID = {
  id: true,
} as const;

/**
 * Alta, listado y borrado lógico (más reactivación) de cuentas
 * teacher/student para el panel del administrador (AGENTS.md §5: solo
 * el admin crea profesores y estudiantes, con contraseña inicial que
 * deben cambiar en su primer inicio).
 *
 * Autorización: los usuarios son un recurso gestionado por el admin
 * global, así que @PerteneceA no registra 'usuario' (su único gestor
 * pasa siempre ese guard; docs/guard_pertenencia.md §4). La restricción
 * es @Roles('admin') en el controller — JwtAuthGuard → RolesGuard,
 * ambos globales — más esta segunda capa en el Service (AGENTS.md §8):
 * asegurarAdmin re-verifica el rol para que los métodos también sean
 * seguros en flujos internos, y al crear se re-verifica en la BD que
 * el admin del token siga activo (el token pudo firmarse antes de una
 * desactivación; patrón de OrganizationsService.crear).
 *
 * Contraseñas (AGENTS.md §9.3): la genera el SERVIDOR con
 * crypto.randomBytes (decisión del equipo; nada sensible viaja en el
 * request) y se guarda como hash argon2. El texto plano sale UNA sola
 * vez en la respuesta de creación y jamás se registra en logs.
 * must_change_password lo aporta la BD con su DEFAULT TRUE: el usuario
 * nace obligado a cambiarla en su primer inicio de sesión.
 *
 * Errores de BD: el filtro global traduce P2002 (username/correo
 * duplicado) a 409 y P2025 a 404; aquí se valida primero para dar
 * errores claros en español (AGENTS.md §6: validación doble). updated_at
 * jamás se escribe: lo mantiene el trigger fn_set_updated_at.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una cuenta teacher/student en una organización. El INSERT solo
   * lleva lo que el cliente puede decidir: identidad, rol y
   * organización. must_change_password (TRUE), is_active (TRUE),
   * last_login (NULL) y las fechas van con sus DEFAULT/triggers de la
   * BD (AGENTS.md §7: los valores con dueño "BD" jamás se aceptan del
   * cliente).
   *
   * La organización inexistente se valida AQUÍ con el 404 estándar en
   * lugar de dejarla llegar a un P2003 de FK, que el filtro global no
   * mapea (derivaría en un 500 que filtra detalles internos).
   */
  async crear(
    dto: CrearUsuarioDto,
    usuario: UsuarioAutenticado,
  ): Promise<UsuarioCreadoRespuestaDto> {
    this.asegurarAdmin(usuario);

    // Regla de entrada pura, antes de tocar la BD: la especialidad solo
    // existe para profesores (comentario del esquema en users.specialty).
    if (dto.rol === 'student' && dto.especialidad !== undefined) {
      throw new BadRequestException(MENSAJE_ESPECIALIDAD_SOLO_PROFESOR);
    }

    const idAdmin = this.aBigInt(usuario.id);
    if (idAdmin === null) {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    // Defensa en profundidad (patrón de OrganizationsService.crear): el
    // token pudo firmarse antes de que el admin fuera desactivado o
    // eliminado; la BD se re-verifica aquí antes del INSERT.
    const admin = await this.prisma.users.findFirst({
      where: { id: idAdmin, role: 'admin', is_active: true },
      select: CAMPOS_ID,
    });
    if (admin === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const idOrganizacion = this.aBigInt(dto.organizacionId);
    if (idOrganizacion === null) {
      throw new BadRequestException(MENSAJE_ORGANIZACION_INVALIDA);
    }

    // Pre-check de duplicados con mensaje específico (validación doble,
    // AGENTS.md §6): username/email son CITEXT UNIQUE, así que la
    // igualdad ya es insensible a mayúsculas. La BD sigue siendo la red
    // de seguridad final con P2002 → 409 para cualquier carrera de
    // escritura concurrente.
    const existente = await this.prisma.users.findFirst({
      where: {
        OR: [{ username: dto.usuario }, { email: dto.correo }],
      },
      select: { username: true, email: true },
    });
    if (existente !== null) {
      if (existente.username.toLowerCase() === dto.usuario.toLowerCase()) {
        throw new ConflictException(MENSAJE_USERNAME_DUPLICADO);
      }
      throw new ConflictException(MENSAJE_CORREO_DUPLICADO);
    }

    const organizacion = await this.prisma.organizations.findFirst({
      where: { id: idOrganizacion },
      select: CAMPOS_ID,
    });
    if (organizacion === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    // Contraseña inicial generada por el servidor: 12 bytes aleatorios
    // en base64url → 16 caracteres (~96 bits de entropía) dentro del
    // rango 8–128 que exige el login. Se hashea con argon2 antes de
    // tocar la BD (AGENTS.md §9.3) y el texto plano solo viaja en la
    // respuesta de creación.
    const contrasenaInicial = randomBytes(12).toString('base64url');
    const passwordHash = await hash(contrasenaInicial);

    const creado = await this.prisma.users.create({
      data: {
        organization_id: idOrganizacion,
        role: dto.rol,
        username: dto.usuario,
        email: dto.correo,
        password_hash: passwordHash,
        first_name: dto.nombre,
        last_name: dto.apellido,
        specialty: dto.rol === 'teacher' ? (dto.especialidad ?? null) : null,
      },
      select: CAMPOS_USUARIO,
    });

    return {
      mensaje: MENSAJE_USUARIO_CREADO,
      contrasenaInicial,
      usuario: this.aUsuarioRespuesta(creado),
    };
  }

  /**
   * Lista las cuentas con la paginación estándar { data, meta } y
   * filtros opcionales de texto (usuario/correo/nombre/apellido, contains
   * insensible), rol, organización y estado activo. El conteo del total
   * repite el mismo WHERE en una consulta aparte (patrón de
   * ClassesService.listarEstudiantes). Orden: created_at DESC — el
   * admin ve primero las cuentas recién creadas.
   */
  async listar(
    dto: ListarUsuariosQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoUsuariosDto> {
    this.asegurarAdmin(usuario);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: Prisma.usersWhereInput = {};
    if (dto.q !== undefined) {
      where.OR = [
        { username: { contains: dto.q, mode: 'insensitive' } },
        { email: { contains: dto.q, mode: 'insensitive' } },
        { first_name: { contains: dto.q, mode: 'insensitive' } },
        { last_name: { contains: dto.q, mode: 'insensitive' } },
      ];
    }
    if (dto.rol !== undefined) {
      where.role = dto.rol;
    }
    if (dto.organizacionId !== undefined) {
      const idOrganizacion = this.aBigInt(dto.organizacionId);
      if (idOrganizacion === null) {
        throw new BadRequestException(MENSAJE_ORGANIZACION_INVALIDA);
      }
      where.organization_id = idOrganizacion;
    }
    if (dto.activa !== undefined) {
      where.is_active = dto.activa;
    }

    const usuarios = await this.prisma.users.findMany({
      where,
      select: CAMPOS_USUARIO,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.users.count({ where });

    return {
      data: usuarios.map((encontrado) => this.aUsuarioRespuesta(encontrado)),
      meta: { total, page, limit },
    };
  }

  /**
   * Borrado LÓGICO de una cuenta: is_active=false, nunca DELETE físico
   * (la tabla users no tiene deleted_at y ninguna tabla se vacía a
   * mano, contexto_mvp §2.7 — misma decisión que organizations). El
   * registro sigue existiendo: clases, inscripciones, monedas e
   * historial quedan intactos, y el login queda bloqueado porque
   * AuthService.validarUsuario rechaza cuentas inactivas. La
   * reactivación solo vía PATCH { activa: true }.
   *
   * Solo se gestionan cuentas teacher/student (espejo del POST, decisión
   * del equipo): un objetivo admin o inexistente recibe el mismo 404
   * estándar (anti-enumeración, docs/guard_pertenencia.md §9). La
   * operación es idempotente: repetirla sobre una cuenta ya
   * desactivada vuelve a dar 204. updated_at lo renueva el trigger;
   * el inexistente falla con P2025 → 404 estándar vía el filtro global.
   */
  async eliminar(id: string, usuario: UsuarioAutenticado): Promise<void> {
    this.asegurarAdmin(usuario);

    const idUsuario = this.aBigInt(id);
    if (idUsuario === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    await this.asegurarObjetivoCreable(idUsuario);

    await this.prisma.users.update({
      where: { id: idUsuario },
      data: { is_active: false },
      select: CAMPOS_ID,
    });
  }

  /**
   * Edita el estado activo de una cuenta teacher/student: activa=true
   * reactiva (el único camino de vuelta tras un borrado lógico) y
   * activa=false desactiva (misma vía que DELETE). Solo los campos
   * presentes llegan al UPDATE — ni must_change_password ni las
   * fechas (trigger fn_set_updated_at). Un cuerpo sin campos responde
   * 400 (MENSAJE_ACTUALIZACION_VACIA); el inexistente/admin como
   * objetivo falla con el 404 estándar antes del UPDATE.
   */
  async actualizar(
    id: string,
    dto: ActualizarUsuarioDto,
    usuario: UsuarioAutenticado,
  ): Promise<UsuarioRespuestaDto> {
    this.asegurarAdmin(usuario);

    if (dto.activa === undefined) {
      throw new BadRequestException(MENSAJE_ACTUALIZACION_VACIA);
    }

    const idUsuario = this.aBigInt(id);
    if (idUsuario === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    await this.asegurarObjetivoCreable(idUsuario);

    const actualizado = await this.prisma.users.update({
      where: { id: idUsuario },
      data: { is_active: dto.activa },
      select: CAMPOS_USUARIO,
    });

    return this.aUsuarioRespuesta(actualizado);
  }

  /**
   * Pre-check compartido por eliminar/actualizar: el objetivo debe ser
   * una cuenta teacher/student EXISTENTE (decisión del equipo, espejo
   * de ROLES_CREABLES del alta). Un id inexistente o de otro rol
   * (p. ej. un admin) recibe el mismo 404 estándar: no revela si el
   * registro existe ni de qué tipo es (anti-enumeración).
   */
  private async asegurarObjetivoCreable(idUsuario: bigint): Promise<void> {
    const objetivo = await this.prisma.users.findFirst({
      where: { id: idUsuario, role: { in: [...ROLES_CREABLES] } },
      select: CAMPOS_ID,
    });
    if (objetivo === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
  }

  /**
   * Segunda capa de autorización (AGENTS.md §8): @Roles('admin') ya la
   * comprobó en HTTP con el RolesGuard global; aquí se re-verifica el
   * rol para que el service también sea seguro en flujos internos.
   */
  private asegurarAdmin(usuario: UsuarioAutenticado): void {
    if (usuario.role !== 'admin') {
      throw new ForbiddenException(MENSAJE_SIN_ROL);
    }
  }

  /** Convierte un id a BigInt; null si no es numérico. */
  private aBigInt(valor: string): bigint | null {
    try {
      return BigInt(valor);
    } catch {
      return null;
    }
  }

  private aUsuarioRespuesta(usuario: UsuarioCreado): UsuarioRespuestaDto {
    return {
      id: usuario.id.toString(),
      usuario: usuario.username,
      correo: usuario.email,
      rol: usuario.role,
      nombre: usuario.first_name,
      apellido: usuario.last_name,
      especialidad: usuario.specialty,
      organizacionId:
        usuario.organization_id === null
          ? null
          : usuario.organization_id.toString(),
      debeCambiarContrasena: usuario.must_change_password,
      activo: usuario.is_active,
      creadoEn: usuario.created_at.toISOString(),
    };
  }
}
