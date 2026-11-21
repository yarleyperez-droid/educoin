import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ClassesService } from './classes.service';
import { CrearClaseDto } from './dto/crear-clase.dto';
import { ActualizarClaseDto } from './dto/actualizar-clase.dto';
import { BuscarClasesQueryDto } from './dto/buscar-clases.dto';
import { ListarEstudiantesQueryDto } from './dto/listar-estudiantes.dto';
import {
  ClaseCreadaRespuestaDto,
  ClaseRespuestaDto,
  ListadoClasesDto,
  UnirseClaseRespuestaDto,
} from './dto/clase-respuesta.dto';
import { ListadoEstudiantesDto } from './dto/estudiante-inscrito-respuesta.dto';
import { UnirseClaseDto } from './dto/unirse-clase.dto';

/**
 * Endpoints de clases bajo /api/v1/classes (AGENTS.md §8):
 * - GET   /                → lista las clases del usuario; si se envía `q`
 *                            (≥ 3 caracteres) filtra por nombre (pg_trgm),
 *                            si no, devuelve todas ordenadas por creación.
 * - GET   /:id             → devuelve la clase OWN :id del profesor.
 * - GET   /:id/estudiantes → lista los estudiantes inscritos en la clase
 *                            OWN :id del profesor autenticado.
 * - POST  /                → crea una clase con código de unión generado por la BD.
 * - POST  /join            → el estudiante se une a una clase con su código (H3.2).
 * - PATCH /:id             → edita nombre y/o estado (archivar/reactivar).
 *
 * La creación NO declara @PerteneceA: ese guard verifica recursos
 * EXISTENTES por id de ruta y aquí la clase aún no existe (no hay :id),
 * así que solo exigiría un parámetro ausente y fallaría siempre
 * (docs/guard_pertenencia.md §3). La autorización se resuelve con el rol
 * teacher (@Roles) y la identidad del token (@UsuarioActual): el
 * teacher_id nunca se acepta del body.
 *
 * La lectura del detalle y la edición sí declaran @PerteneceA('clase',
 * 'id'): una clase ajena o inexistente responde 404 estándar antes de
 * llegar al handler, y el service re-verifica con la misma regla
 * (segunda capa, AGENTS.md §8).
 *
 * La búsqueda tampoco usa @PerteneceA (es una COLECCIÓN sin :id): la
 * pertenencia del profesor se aplica como filtro de la consulta
 * (teacher_id = usuario.id, misma regla de AutorizacionService) y el
 * estudiante queda acotado a su organización. Sin @Roles: los tres roles
 * pueden buscar; el rol cambia el FILTRO, no el permiso de entrada.
 *
 * Documentación OpenAPI (H1.3 / PRO-267): todo el controlador está
 * protegido por los guards globales, así que el security bearer y los
 * errores 401/403 se declaran una vez a nivel de clase y se heredan en
 * cada ruta; los 409 (P2002), 422 (regla de BD), 400 (validación) y 404
 * (@PerteneceA) se documentan por método.
 */
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description: 'Rol insuficiente para la operación (403).',
})
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOkResponse({
    type: ListadoClasesDto,
    description:
      'Clases del usuario con paginación estándar { data, meta } (meta = { total, page, limit }).',
  })
  @Get()
  buscar(
    @Query() query: BuscarClasesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoClasesDto> {
    return this.classesService.buscar(query, usuario);
  }

  // Detalle de UNA clase. Va antes de ':id/estudiantes' para que el orden
  // de declaración de rutas sea el natural (del más simple al más anidado).
  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @Get(':id')
  obtener(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    return this.classesService.obtener(id, usuario);
  }

  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @ApiOkResponse({
    type: ListadoEstudiantesDto,
    description:
      'Inscriptos de la clase con paginación estándar { data, meta }.',
  })
  @ApiBadRequestResponse({
    description: 'Paginación fuera de rango (page o limit inválidos).',
  })
  @ApiNotFoundResponse({
    description: 'Clase inexistente o ajena (respuesta estándar anti-enumeración).',
  })
  @Get(':id/estudiantes')
  listarEstudiantes(
    @Param('id') id: string,
    @Query() query: ListarEstudiantesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoEstudiantesDto> {
    return this.classesService.listarEstudiantes(id, query, usuario);
  }

  @Roles('teacher')
  @ApiCreatedResponse({
    type: ClaseCreadaRespuestaDto,
    description: 'Clase creada; incluye el código de unión generado por la BD.',
  })
  @ApiBadRequestResponse({ description: 'Datos inválidos (400).' })
  @ApiConflictResponse({
    description: 'Ya existe una clase con ese nombre para el profesor (409, P2002).',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Regla de negocio rechazada por la BD (422, RAISE EXCEPTION).',
  })
  @Post()
  crear(
    @Body() dto: CrearClaseDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseCreadaRespuestaDto> {
    return this.classesService.crear(dto.nombre, usuario);
  }

  /**
   * POST /join (H3.2): el estudiante se une con el código que le
   * compartió su profesor. NO declara @PerteneceA: la ruta no tiene :id
   * y el guard global solo actúa sobre handlers con el decorator
   * (pertenencia.guard.ts §"rutas sin @PerteneceA", costo cero si no
   * hay regla). La autorización es @Roles('student'); la verificación
   * completa (estudiante activo, clase por código, estados de la
   * inscripción) vive en el service.
   *
   * [Punto de inserción documentado para T2.3.3: si se decidiera pasar
   * a verificación por :id de la clase en el futuro, sería aquí.]
   *
   * Las reglas de inscripción siguen siendo de la BD: el UNIQUE
   * uq_enrollment (409) y el trigger fn_validate_enrollment (422 por
   * organización) actúan aunque el service pre-valide; traducir esos
   * errores a mensajes amables es exactamente lo que hace el service.
   */
  @Roles('student')
  @ApiCreatedResponse({
    type: UnirseClaseRespuestaDto,
    description:
      'Inscripción creada con status active; incluye clase e inscripción.',
  })
  @ApiBadRequestResponse({
    description:
      'Body inválido: codigo ausente, vacío, no string o de más de 12 caracteres (400).',
  })
  @ApiNotFoundResponse({
    description:
      'Código inexistente o clase no activa (404, respuesta anti-enumeración).',
  })
  @ApiConflictResponse({
    description: 'Ya inscripto con status active (409).',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Inscripción withdrawn/blocked (422) u organización distinta (422, regla de la BD).',
  })
  @Post('join')
  unirse(
    @Body() dto: UnirseClaseDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UnirseClaseRespuestaDto> {
    return this.classesService.unirse(dto.codigo, usuario);
  }

  @Roles('teacher')
  @PerteneceA('clase', 'id')
  @ApiOkResponse({
    type: ClaseRespuestaDto,
    description: 'Clase actualizada (nombre y/o estado: archivar/reactivar).',
  })
  @ApiBadRequestResponse({ description: 'Datos inválidos (400).' })
  @ApiNotFoundResponse({
    description: 'Clase inexistente o ajena (404, @PerteneceA).',
  })
  @ApiConflictResponse({
    description: 'El nuevo nombre ya existe para el profesor (409, P2002).',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Regla de negocio rechazada por la BD (422).',
  })
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarClaseDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ClaseRespuestaDto> {
    return this.classesService.actualizar(id, dto, usuario);
  }
}
