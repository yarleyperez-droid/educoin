import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { class_status } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import type { ActualizarClaseDto } from './dto/actualizar-clase.dto';
import type {
  ClaseCreadaRespuestaDto,
  ClaseRespuestaDto,
} from './dto/clase-respuesta.dto';

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
