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
} from './dto/clase-respuesta.dto';
import { ListadoEstudiantesDto } from './dto/estudiante-inscrito-respuesta.dto';

/**
 * Endpoints de clases bajo /api/v1/classes (AGENTS.md §8):
 * - GET   /                → busca clases por nombre (pg_trgm) paginado.
 * - GET   /:id/estudiantes → lista los estudiantes inscritos en la clase
 *                            OWN :id del profesor autenticado.
 * - POST  /                → crea una clase con código de unión generado por la BD.
 * - PATCH /:id             → edita nombre y/o estado (archivar/reactivar).
 *
 * La creación NO declara @PerteneceA: ese guard verifica recursos
 * EXISTENTES por id de ruta y aquí la clase aún no existe (no hay :id),
 * así que solo exigiría un parámetro ausente y fallaría siempre
 * (docs/guard_pertenencia.md §3). La autorización se resuelve con el rol
 * teacher (@Roles) y la identidad del token (@UsuarioActual): el
 * teacher_id nunca se acepta del body.
 *
 * La edición sí declara @PerteneceA('clase', 'id'): una clase ajena o
 * inexistente responde 404 estándar antes de llegar al handler, y el
 * service re-verifica con la misma regla (segunda capa, AGENTS.md §8).
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
