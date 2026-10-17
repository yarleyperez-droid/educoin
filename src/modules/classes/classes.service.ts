import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type {
  class_status,
  enrollment_status,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import type { ActualizarClaseDto } from './dto/actualizar-clase.dto';
import type { BuscarClasesQueryDto } from './dto/buscar-clases.dto';
import type { ListarEstudiantesQueryDto } from './dto/listar-estudiantes.dto';
import type {
  ClaseCreadaRespuestaDto,
  ClaseListadoDto,
  ClaseRespuestaDto,
  ListadoClasesDto,
} from './dto/clase-respuesta.dto';
import type {
  EstudianteInscritoDto,
  ListadoEstudiantesDto,
} from './dto/estudiante-inscrito-respuesta.dto';

/**
 * Mensaje de éxito de la creación: se arma con el código de unión real
 * que la BD generó para que el profesor lo comparta con los estudiantes.
 * Función exportada para que las pruebas compartan exactamente el mismo
 * texto (patrón de MENSAJE_SIN_ROL y demás constantes del proyecto).
 */
export const mensajeClaseCreada = (codigo: string): string =>
  `Clase creada con éxito. Comparte el código ${codigo} con tus estudiantes.`;

/** 400 cuando el PATCH no lleva ningún campo para actualizar. */
export const MENSAJE_ACTUALIZACION_VACIA =
  'Debes enviar al menos un campo para actualizar: nombre o estado.';

/** Campos leídos de la tabla classes (AGENTS.md §5: nombres reales de la BD). */
interface ClaseCreada {
  id: bigint;
  teacher_id: bigint;
  name: string;
  code: string;
  status: class_status;
  created_at: Date;
  updated_at: Date;
}

const CAMPOS_CLASE = {
  id: true,
  teacher_id: true,
  name: true,
  code: true,
  status: true,
  created_at: true,
  updated_at: true,
} as const;

const CAMPOS_PROFESOR = {
  id: true,
} as const;

/**
 * Fila cruda de la búsqueda $queryRaw. El driver adapter puede devolver
 * el BIGINT como bigint/number/string según su parser, así que el mapper
 * normaliza con String()/Number()/new Date() en lugar de asumir un tipo.
 */
interface FilaClaseEncontrada {
  id: bigint | number | string;
  name: string;
  status: class_status;
  created_at: Date | string;
  first_name: string;
  last_name: string;
}

/** Inscripción leída con los datos de identidad del estudiante. */
interface InscripcionEncontrada {
  id: bigint;
  status: enrollment_status;
  enrolled_at: Date;
  users: {
    id: bigint;
    username: string;
    first_name: string;
    last_name: string;
  };
}

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autorizacion: AutorizacionService,
  ) {}

  /**
   * Crea una clase a nombre del profesor autenticado. El código de unión
   * lo genera la BD con el DEFAULT de classes.code (AGENTS.md §7: no se
   * envía) y el nombre duplicado falla por el índice único lower(name)
   * (P2002 → el filtro global lo traduce a 409). El teacher_id sale del
   * token, nunca del body, para impedir la creación en nombre de otro.
   */
  async crear(
    nombre: string,
    usuario: UsuarioAutenticado,
  ): Promise<ClaseCreadaRespuestaDto> {
    let idProfesor: bigint;
    try {
      idProfesor = BigInt(usuario.id);
    } catch {
      throw new UnauthorizedException('No autenticado o sesión expirada.');
    }

    // Defensa en profundidad: el token pudo firmarse antes de que el
    // profesor fuera desactivado o eliminado; la BD se re-verifica aquí.
    const profesor = await this.prisma.users.findFirst({
      where: { id: idProfesor, role: 'teacher', is_active: true },
      select: CAMPOS_PROFESOR,
    });
    if (profesor === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const clase = await this.prisma.classes.create({
      data: { teacher_id: idProfesor, name: nombre },
      select: CAMPOS_CLASE,
    });

    return {
      mensaje: mensajeClaseCreada(clase.code),
      clase: this.aClaseRespuesta(clase),
    };
  }

  /**
   * Devuelve la ficha completa de una clase OWN del profesor para el
   * detalle del panel (T5.6.4). Es el único endpoint que expone el
   * `codigo` de unión a la vista de detalle: el listado de búsqueda lo
   * omite a propósito (ver ClaseListadoDto) para que nadie pueda
   * auto-inscribirse sin que el profesor comparta el código.
   *
   * Segunda capa de pertenencia (AGENTS.md §8): el guard HTTP ya filtró
   * las clases ajenas con 404, y aquí se re-verifica con
   * AutorizacionService (que además descarta ids no numéricos con el
   * mismo 404 estándar). El NotFoundException del final es defensa en
   * profundidad: entre la comprobación de pertenencia y la lectura la
   * clase pudo desaparecer y el cliente debe recibir el 404 estándar en
   * lugar de un error de mapeo sobre una fila ausente.
   */
  async obtener(
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    await this.autorizacion.verificarPertenencia('clase', id, usuario);

    const clase = await this.prisma.classes.findFirst({
      where: { id: BigInt(id) },
      select: CAMPOS_CLASE,
    });

    if (clase === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    return this.aClaseRespuesta(clase);
  }

  /**
   * Edita parcialmente una clase del profesor autenticado: nombre y/o
   * estado ('archived' archiva, 'active' reactiva). Segunda capa de
   * pertenencia (AGENTS.md §8): re-verifica con AutorizacionService la
   * misma regla que el guard HTTP, de modo que el service también es
   * seguro en flujos internos. updated_at jamás se setea a mano (trigger
   * fn_set_updated_at) y el nombre duplicado falla por el índice
   * lower(name) (P2002 → 409 vía el filtro global).
   */
  async actualizar(
    id: string,
    dto: ActualizarClaseDto,
    usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    // También descarta ids no numéricos con el 404 estándar.
    await this.autorizacion.verificarPertenencia('clase', id, usuario);

    if (dto.nombre === undefined && dto.estado === undefined) {
      throw new BadRequestException(MENSAJE_ACTUALIZACION_VACIA);
    }

    // Solo los campos presentes: ni updated_at (trigger BD) ni campos
    // de identidad (teacher_id) pasan al UPDATE.
    const data: { name?: string; status?: class_status } = {};
    if (dto.nombre !== undefined) {
      data.name = dto.nombre;
    }
    if (dto.estado !== undefined) {
      data.status = dto.estado;
    }

    const clase = await this.prisma.classes.update({
      where: { id: BigInt(id) },
      data,
      select: CAMPOS_CLASE,
    });

    return this.aClaseRespuesta(clase);
  }

  /**
   * Busca clases por nombre con pg_trgm: coincide por similitud de
   * trigramas (operador %, tolera errores de tipeo) o por subcadena
   * (ILIKE, cubre términos cortos cuya similitud cae bajo el umbral
   * 0.3); ambos caminos usan el índice GIN idx_classes_name_trgm.
   *
   * La pertenencia del profesor NO se resuelve con @PerteneceA (ese
   * guard valida un recurso individual por :id de ruta y una búsqueda
   * es una colección sin id): la misma regla (classes.teacher_id =
   * usuario.id) se aplica aquí como filtro de la consulta. El estudiante
   * solo ve clases activas de SU organización (regla del trigger
   * fn_validate_enrollment) y el admin, como rol global, ve todo.
   *
   * $queryRaw tipado con tagged template parametrizado (AGENTS.md §7:
   * prohibido $queryRawUnsafe). El total se cuenta en una query aparte:
   * un count(*) OVER() perdería el total en páginas sin filas.
   */
  async buscar(
    dto: BuscarClasesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoClasesDto> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const patron = `%${this.escaparLike(dto.q)}%`;
    const condicion = this.condicionPorRol(usuario);
    const offset = (page - 1) * limit;

    const filas = await this.prisma.$queryRaw<FilaClaseEncontrada[]>(Prisma.sql`
      SELECT c.id, c.name, c.status, c.created_at, u.first_name, u.last_name
      FROM classes c
      JOIN users u ON u.id = c.teacher_id
      WHERE (c.name % ${dto.q} OR c.name ILIKE ${patron})
        AND ${condicion}
      ORDER BY similarity(c.name, ${dto.q}) DESC, c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const conteo = await this.prisma.$queryRaw<
      { total: bigint | number | string }[]
    >(Prisma.sql`
      SELECT count(*) AS total
      FROM classes c
      JOIN users u ON u.id = c.teacher_id
      WHERE (c.name % ${dto.q} OR c.name ILIKE ${patron})
        AND ${condicion}
    `);

    return {
      data: filas.map((fila) => this.aClaseListado(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }

  private aClaseListado(fila: FilaClaseEncontrada): ClaseListadoDto {
    return {
      id: String(fila.id),
      nombre: fila.name,
      estado: fila.status,
      profesorNombre: `${fila.first_name} ${fila.last_name}`,
      creadoEn: new Date(fila.created_at).toISOString(),
    };
  }

  /**
   * Lista los estudiantes inscritos en una clase del profesor
   * autenticado, con paginación estándar { data, meta }. El guard HTTP
   * (@PerteneceA('clase', 'id')) ya garantizó que la clase es suya;
   * aquí va la segunda capa (AGENTS.md §8): la misma regla re-verificada
   * con AutorizacionService, que además descarta ids no numéricos con el
   * 404 estándar. Solo identidad y estado de la inscripción — sin monedas
   * ni email: el select de Prisma ni siquiera los lee (mínima
   * exposición). coins_available es columna generada y de solo lectura,
   * así que cualquier dato de monedas futuro también se limitaría a
   * leerse, jamás escribirse (AGENTS.md §6).
   */
  async listarEstudiantes(
    id: string,
    dto: ListarEstudiantesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoEstudiantesDto> {
    await this.autorizacion.verificarPertenencia('clase', id, usuario);

    const idClase = BigInt(id);
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const inscripciones = await this.prisma.enrollments.findMany({
      where: { class_id: idClase },
      select: {
        id: true,
        status: true,
        enrolled_at: true,
        users: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { users: { first_name: 'asc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.enrollments.count({
      where: { class_id: idClase },
    });

    return {
      data: inscripciones.map((i) => this.aEstudianteInscrito(i)),
      meta: { total, page, limit },
    };
  }

  private aEstudianteInscrito(
    inscripcion: InscripcionEncontrada,
  ): EstudianteInscritoDto {
    return {
      id: inscripcion.id.toString(),
      estudianteId: inscripcion.users.id.toString(),
      username: inscripcion.users.username,
      nombre: `${inscripcion.users.first_name} ${inscripcion.users.last_name}`,
      estado: inscripcion.status,
      inscritoEn: inscripcion.enrolled_at.toISOString(),
    };
  }

  /** Escapa los wildcards de ILIKE (% y _) para que busquen literal. */
  private escaparLike(valor: string): string {
    return valor.replace(/[\\%_]/g, '\\$&');
  }

  /**
   * Filtro de la búsqueda según el rol del usuario autenticado
   * (misma regla de pertenencia que AutorizacionService aplica por
   * recurso individual, expresada como WHERE para una colección).
   */
  private condicionPorRol(usuario: UsuarioAutenticado): Prisma.Sql {
    if (usuario.role === 'teacher') {
      let idProfesor: bigint;
      try {
        idProfesor = BigInt(usuario.id);
      } catch {
        throw new UnauthorizedException('No autenticado o sesión expirada.');
      }
      return Prisma.sql`c.teacher_id = ${idProfesor}`;
    }
    if (usuario.role === 'student') {
      // Sin organización no puede inscribirse en ninguna clase: la
      // búsqueda no debe devolverle nada.
      if (usuario.organizacionId === null) {
        return Prisma.sql`false`;
      }
      return Prisma.sql`u.organization_id = ${BigInt(
        usuario.organizacionId,
      )} AND c.status = 'active'`;
    }
    // admin: rol global, sin filtro adicional.
    return Prisma.sql`true`;
  }

  private aClaseRespuesta(clase: ClaseCreada): ClaseRespuestaDto {
    return {
      id: clase.id.toString(),
      profesorId: clase.teacher_id.toString(),
      nombre: clase.name,
      codigo: clase.code,
      estado: clase.status,
      creadoEn: clase.created_at.toISOString(),
      actualizadoEn: clase.updated_at.toISOString(),
    };
  }
}
