import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { activity_status } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import {
  sinRespuestasCorrectas,
  validarPreguntas,
  type Pregunta,
} from './dto/preguntas.schema';
import type { CrearActividadDto } from './dto/crear-actividad.dto';
import type { ActualizarActividadDto } from './dto/actualizar-actividad.dto';
import type { PublicarActividadDto } from './dto/publicar-actividad.dto';
import type {
  ListarActividadesPublicadasQueryDto,
  ListarActividadesQueryDto,
} from './dto/listar-actividades.dto';
import type {
  ActividadCreadaRespuestaDto,
  ActividadEstudianteRespuestaDto,
  ActividadRespuestaDto,
  ListadoActividadesDto,
} from './dto/actividad-respuesta.dto';

/**
 * Mensaje de éxito de la creación (exportado para que las pruebas
 * compartan exactamente el mismo texto).
 */
export const MENSAJE_ACTIVIDAD_CREADA =
  'Actividad creada como borrador. Publícala cuando esté lista: los estudiantes solo pueden resolver actividades publicadas.';

/** 400 cuando el PATCH no lleva ningún campo para actualizar. */
export const MENSAJE_ACTUALIZACION_ACTIVIDAD_VACIA =
  'Debes enviar al menos un campo para actualizar: titulo, descripcion, recompensaMonedas, preguntas o cierraEn.';

/** 409 al publicar una actividad que ya está publicada. */
export const MENSAJE_YA_PUBLICADA =
  'La actividad ya está publicada. Solo puede cambiarse la fecha de cierre (cierraEn).';

/** 409 al editar campos congelados de una actividad publicada. */
export const MENSAJE_PUBLICADA_NO_EDITABLE =
  'La actividad ya está publicada: solo puede cambiarse la fecha de cierre (cierraEn).';

/** 422 cuando la fecha de cierre no queda después del momento actual. */
export const MENSAJE_CIERRE_FUTURO =
  'La fecha de cierre (cierraEn) debe ser posterior al momento actual.';

/** Fila completa de activities (AGENTS.md §5: nombres reales de la BD). */
interface ActividadEncontrada {
  id: bigint;
  class_id: bigint;
  title: string;
  description: string | null;
  reward_coins: number;
  status: activity_status;
  questions: Prisma.JsonValue;
  published_at: Date | null;
  closes_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/** Fila del listado: sin preguntas (el detalle está en GET /activities/:id). */
interface ActividadListadoEncontrada {
  id: bigint;
  title: string;
  status: activity_status;
  reward_coins: number;
  published_at: Date | null;
  closes_at: Date | null;
  created_at: Date;
}

const CAMPOS_ACTIVIDAD = {
  id: true,
  class_id: true,
  title: true,
  description: true,
  reward_coins: true,
  status: true,
  questions: true,
  published_at: true,
  closes_at: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
} as const;

const CAMPOS_ACTIVIDAD_LISTADO = {
  id: true,
  title: true,
  status: true,
  reward_coins: true,
  published_at: true,
  closes_at: true,
  created_at: true,
} as const;

/**
 * Flujo del profesor sobre las actividades de SUS clases
 * (AGENTS.md §11 y docs/plataforma_educativa_bd.md §4):
 *
 * - Crear: nace 'draft' por DEFAULT de la BD; status/published_at nunca
 *   se aceptan del cliente. Las preguntas viajan embebidas en el JSONB
 *   (estructura de la seed) y se validan con zod antes de guardar.
 * - Editar: solo en borrador; una publicada solo acepta la fecha de
 *   cierre; una eliminada se comporta como inexistente (404 estándar).
 * - Publicar: draft → published seteando published_at (ningún trigger de
 *   la BD lo hace). A partir de ahí fn_validate_submission permite las
 *   entregas de los estudiantes.
 * - Eliminar: borrado LÓGICO (status='deleted' + deleted_at), jamás un
 *   DELETE físico (AGENTS.md §6).
 *
 * Máquina de estados (decisiones del equipo, la BD no la restringe):
 *   draft → published → deleted   (sin despublicar)
 *   draft → deleted
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autorizacion: AutorizacionService,
  ) {}

  /**
   * Crea una actividad en la clase indicada, a nombre del profesor del
   * token. Segunda capa de pertenencia (AGENTS.md §8): re-verifica con
   * AutorizacionService que la clase sea suya (el guard HTTP ya lo hizo
   * por :claseId; el service también es seguro en flujos internos).
   *
   * El INSERT no envía status ni published_at/deleted_at: son defaults
   * de la BD (draft / NULL) y así se garantiza que toda actividad nace
   * en borrador. updated_at tampoco viaja (trigger fn_set_updated_at).
   */
  async crear(
    claseId: string,
    dto: CrearActividadDto,
    usuario: UsuarioAutenticado,
  ): Promise<ActividadCreadaRespuestaDto> {
    await this.autorizacion.verificarPertenencia('clase', claseId, usuario);

    const preguntas = validarPreguntas(dto.preguntas);

    const actividad = await this.prisma.activities.create({
      data: {
        class_id: this.aBigInt(claseId),
        title: dto.titulo,
        ...(dto.descripcion !== undefined
          ? { description: dto.descripcion }
          : {}),
        ...(dto.recompensaMonedas !== undefined
          ? { reward_coins: dto.recompensaMonedas }
          : {}),
        questions: preguntas,
        ...(dto.cierraEn !== undefined
          ? { closes_at: new Date(dto.cierraEn) }
          : {}),
      },
      select: CAMPOS_ACTIVIDAD,
    });

    return {
      mensaje: MENSAJE_ACTIVIDAD_CREADA,
      actividad: this.aActividadRespuesta(actividad),
    };
  }

  /**
   * Lista las actividades de una clase del profesor autenticado con la
   * paginación estándar { data, meta } y filtro opcional por estado.
   * Sin preguntas en las filas: el listado es un resumen y el detalle
   * completo está en GET /activities/:id.
   */
  async listar(
    claseId: string,
    query: ListarActividadesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoActividadesDto> {
    await this.autorizacion.verificarPertenencia('clase', claseId, usuario);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      class_id: this.aBigInt(claseId),
      ...(query.estado !== undefined ? { status: query.estado } : {}),
    };

    const filas = await this.prisma.activities.findMany({
      where,
      select: CAMPOS_ACTIVIDAD_LISTADO,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.activities.count({ where });

    return {
      data: filas.map((fila) => this.aActividadListado(fila)),
      meta: { total, page, limit },
    };
  }

  /**
   * Detalle de una actividad con DTO POR ROL (AGENTS.md §9.5):
   *
   * - teacher dueño → DTO completo, con el JSONB entero (opciones
   *   correctas incluidas): es quien redacta y califica.
   * - student inscrito → DTO sanitizado: la regla 'actividadVisible'
   *   (AutorizacionService) ya garantizó en una sola consulta que la
   *   actividad está published y que su inscripción en esa clase está
   *   activa; sinRespuestasCorrectas elimina is_correct/expected_answer.
   *   Las cerradas (closes_at pasado) SÍ se muestran con su cierraEn:
   *   es fn_validate_submission quien bloquea la entrega al cerrar.
   *
   * Una actividad eliminada sigue visible en lectura para su dueño
   * (mismo criterio que el filtro ?estado=deleted); para el estudiante
   * la regla la filtra (solo published) y las mutaciones responden 404.
   */
  async detalle(
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto | ActividadEstudianteRespuestaDto> {
    await this.autorizacion.verificarPertenencia(
      'actividadVisible',
      id,
      usuario,
    );

    const actividad = await this.prisma.activities.findUniqueOrThrow({
      where: { id: this.aBigInt(id) },
      select: CAMPOS_ACTIVIDAD,
    });

    if (usuario.role === 'student') {
      return this.aActividadEstudianteRespuesta(actividad);
    }
    return this.aActividadRespuesta(actividad);
  }

  /**
   * Lista las actividades PUBLISHED de la clase de la inscripción del
   * estudiante (GET /enrollments/:inscripcionId/activities). Solo rol
   * student: el profesor ya tiene su propio listado por clase.
   *
   * La pertenencia de la inscripción la verifica el guard con la regla
   * 'inscripcion' (student → su student_id); aquí va la segunda capa y
   * además se exige que la inscripción esté ACTIVA — retirado/bloqueado
   * es como no estar en la clase (404 estándar). El filtro de estado
   * es fijo (published) por diseño: el estudiante solo resuelve
   * actividades publicadas (fn_validate_submission).
   */
  async listarPublicadas(
    inscripcionId: string,
    query: ListarActividadesPublicadasQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoActividadesDto> {
    await this.autorizacion.verificarPertenencia(
      'inscripcion',
      inscripcionId,
      usuario,
    );

    const inscripcion = await this.prisma.enrollments.findUniqueOrThrow({
      where: { id: this.aBigInt(inscripcionId) },
      select: { status: true, class_id: true },
    });
    if (inscripcion.status !== 'active') {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      class_id: inscripcion.class_id,
      status: 'published' as const,
    };

    const filas = await this.prisma.activities.findMany({
      where,
      select: CAMPOS_ACTIVIDAD_LISTADO,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.activities.count({ where });

    return {
      data: filas.map((fila) => this.aActividadListado(fila)),
      meta: { total, page, limit },
    };
  }

  /**
   * Edita una actividad. Reglas de estado:
   * - draft: todos los campos de este DTO.
   * - published: SOLO cierraEn (los demás → 409; cambiar preguntas o
   *   recompensa con entregas en curso rompería la calificación).
   * - deleted: 404 estándar — para mutaciones ya no existe.
   *
   * La pertenencia se re-verifica (segunda capa) y las preguntas, cuando
   * viajan, se validan con zod y reemplazan el JSONB completo.
   */
  async actualizar(
    id: string,
    dto: ActualizarActividadDto,
    usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto> {
    await this.autorizacion.verificarPertenencia('actividad', id, usuario);

    const idActividad = this.aBigInt(id);
    const actual = await this.prisma.activities.findUniqueOrThrow({
      where: { id: idActividad },
      select: { status: true },
    });

    this.rechazarEliminada(actual.status);

    const campos = [
      dto.titulo,
      dto.descripcion,
      dto.recompensaMonedas,
      dto.preguntas,
      dto.cierraEn,
    ];
    if (campos.every((campo) => campo === undefined)) {
      throw new BadRequestException(MENSAJE_ACTUALIZACION_ACTIVIDAD_VACIA);
    }

    const soloCambioCierre =
      dto.titulo === undefined &&
      dto.descripcion === undefined &&
      dto.recompensaMonedas === undefined &&
      dto.preguntas === undefined &&
      dto.cierraEn !== undefined;

    if (actual.status === 'published' && !soloCambioCierre) {
      throw new ConflictException(MENSAJE_PUBLICADA_NO_EDITABLE);
    }

    const data: Prisma.activitiesUncheckedUpdateInput = {};
    if (dto.titulo !== undefined) {
      data.title = dto.titulo;
    }
    if (dto.descripcion !== undefined) {
      data.description = dto.descripcion;
    }
    if (dto.recompensaMonedas !== undefined) {
      data.reward_coins = dto.recompensaMonedas;
    }
    if (dto.preguntas !== undefined) {
      data.questions = validarPreguntas(dto.preguntas);
    }
    if (dto.cierraEn !== undefined) {
      data.closes_at = this.fechaCierreFutura(dto.cierraEn);
    }

    const actividad = await this.prisma.activities.update({
      where: { id: idActividad },
      data,
      select: CAMPOS_ACTIVIDAD,
    });

    return this.aActividadRespuesta(actividad);
  }

  /**
   * Publica una actividad: draft → published. Setea published_at (la BD
   * no tiene ningún trigger que lo haga) y, si viaja cierraEn, la fecha
   * de cierre. La fecha de cierre efectiva (la nueva o la que ya tenía
   * la actividad) debe quedar en el futuro: ck_activity_dates exige
   * closes_at > published_at y published_at es ahora — validar antes da
   * un mensaje amigable (422) en lugar del error crudo de la BD.
   */
  async publicar(
    id: string,
    dto: PublicarActividadDto,
    usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto> {
    await this.autorizacion.verificarPertenencia('actividad', id, usuario);

    const idActividad = this.aBigInt(id);
    const actual = await this.prisma.activities.findUniqueOrThrow({
      where: { id: idActividad },
      select: { status: true, closes_at: true },
    });

    this.rechazarEliminada(actual.status);
    if (actual.status === 'published') {
      throw new ConflictException(MENSAJE_YA_PUBLICADA);
    }

    const ahora = new Date();
    const cierre =
      dto.cierraEn !== undefined
        ? this.fechaCierreFutura(dto.cierraEn)
        : actual.closes_at;
    if (cierre !== null && cierre.getTime() <= ahora.getTime()) {
      throw new UnprocessableEntityException(MENSAJE_CIERRE_FUTURO);
    }

    const actividad = await this.prisma.activities.update({
      where: { id: idActividad },
      data: {
        status: 'published',
        published_at: ahora,
        ...(dto.cierraEn !== undefined ? { closes_at: cierre } : {}),
      },
      select: CAMPOS_ACTIVIDAD,
    });

    return this.aActividadRespuesta(actividad);
  }

  /**
   * Borrado LÓGICO de una actividad (AGENTS.md §6): status='deleted' +
   * deleted_at, jamás un DELETE físico — la BD conserva el historial y
   * las entregas siguen referenciando la actividad. Eliminar dos veces
   * responde 404: para efectos de mutación ya no existe.
   */
  async eliminar(id: string, usuario: UsuarioAutenticado): Promise<void> {
    await this.autorizacion.verificarPertenencia('actividad', id, usuario);

    const idActividad = this.aBigInt(id);
    const actual = await this.prisma.activities.findUniqueOrThrow({
      where: { id: idActividad },
      select: { status: true },
    });

    this.rechazarEliminada(actual.status);

    await this.prisma.activities.update({
      where: { id: idActividad },
      data: { status: 'deleted', deleted_at: new Date() },
      select: { id: true },
    });
  }

  /**
   * Las actividades eliminadas se comportan como inexistentes ante
   * cualquier mutación (mismo 404 estándar que P2025).
   */
  private rechazarEliminada(status: activity_status): void {
    if (status === 'deleted') {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
  }

  /** ISO 8601 → Date, exigiendo que quede en el futuro (422 si no). */
  private fechaCierreFutura(cierraEn: string): Date {
    const fecha = new Date(cierraEn);
    if (fecha.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(MENSAJE_CIERRE_FUTURO);
    }
    return fecha;
  }

  /**
   * Convierte el id de ruta a BigInt con el 404 estándar si no es
   * numérico: mismo tratamiento que AutorizacionService.aBigInt, para
   * que ni siquiera el admin (que pasa la pertenencia sin consultar la
   * BD) provoque un 500 con un id malformado.
   */
  private aBigInt(valor: string): bigint {
    try {
      return BigInt(valor);
    } catch {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
  }

  private aActividadRespuesta(
    actividad: ActividadEncontrada,
  ): ActividadRespuestaDto {
    return {
      id: actividad.id.toString(),
      claseId: actividad.class_id.toString(),
      titulo: actividad.title,
      descripcion: actividad.description,
      recompensaMonedas: actividad.reward_coins,
      estado: actividad.status,
      // Guardado con zod: la estructura ya es la de la seed.
      preguntas: actividad.questions as Pregunta[],
      publicadaEn: actividad.published_at?.toISOString() ?? null,
      cierraEn: actividad.closes_at?.toISOString() ?? null,
      creadoEn: actividad.created_at.toISOString(),
      actualizadoEn: actividad.updated_at.toISOString(),
      eliminadaEn: actividad.deleted_at?.toISOString() ?? null,
    };
  }

  /**
   * Mapper de la vista del ESTUDIANTE: reutiliza los campos planos del
   * mapper del profesor y sanitiza las preguntas con allow-list
   * (sinRespuestasCorrectas). Sin eliminadaEn: el estudiante nunca
   * llega a actividades eliminadas.
   */
  private aActividadEstudianteRespuesta(
    actividad: ActividadEncontrada,
  ): ActividadEstudianteRespuestaDto {
    return {
      id: actividad.id.toString(),
      claseId: actividad.class_id.toString(),
      titulo: actividad.title,
      descripcion: actividad.description,
      recompensaMonedas: actividad.reward_coins,
      estado: actividad.status,
      preguntas: sinRespuestasCorrectas(actividad.questions as Pregunta[]),
      publicadaEn: actividad.published_at?.toISOString() ?? null,
      cierraEn: actividad.closes_at?.toISOString() ?? null,
      creadoEn: actividad.created_at.toISOString(),
    };
  }

  private aActividadListado(
    actividad: ActividadListadoEncontrada,
  ): ListadoActividadesDto['data'][number] {
    return {
      id: actividad.id.toString(),
      titulo: actividad.title,
      estado: actividad.status,
      recompensaMonedas: actividad.reward_coins,
      publicadaEn: actividad.published_at?.toISOString() ?? null,
      cierraEn: actividad.closes_at?.toISOString() ?? null,
      creadoEn: actividad.created_at.toISOString(),
    };
  }
}
