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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { ErrorRespuestaDto } from '../../common/dto/error-respuesta.dto';
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
 */
@ApiTags('Classes')
// Todas las rutas son protegidas: guards GLOBALES (JWT + roles).
@ApiBearerAuth()
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({
    summary: 'Buscar clases por nombre',
    description:
      'Busca clases por similitud de nombre (pg_trgm), paginado { data, meta }. Sin @Roles: los tres roles pueden buscar; el rol cambia el FILTRO (teacher → solo sus clases; student/admin → clases activas de su organización). Las filas NO traen el código de unión: verlo en una búsqueda permitiría auto-inscribirse.',
  })
  @ApiOkResponse({
    description: 'Clases coincidentes (sin código de unión).',
    type: ListadoClasesDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Falta q o tiene menos de 3 caracteres (mínimo del índice trigram).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
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
  @ApiOperation({
    summary: 'Listar los estudiantes de una clase propia',
    description:
      'Solo teacher, y solo de UNA CLASE PROPIA: una clase ajena o inexistente responde el 404 estándar anti-enumeración. Filas de resumen (username, nombre, estado de la inscripción): sin monedas ni correo.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la clase (BigInt como string).',
    example: '5',
  })
  @ApiOkResponse({
    description: 'Estudiantes inscritos en la clase.',
    type: ListadoEstudiantesDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Parámetros de paginación inválidos.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Clase inexistente o ajena al profesor del token.',
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
  @ApiOperation({
    summary: 'Crear una clase',
    description:
      'Solo teacher. La clase nace activa y la BD genera el código de unión de 8 caracteres, que la respuesta destaca para que el profesor lo comparta con sus estudiantes. El profesor sale del token: no viaja en el cuerpo.',
  })
  @ApiCreatedResponse({
    description: 'Clase creada con su código de unión.',
    type: ClaseCreadaRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Nombre inválido (8-150 caracteres).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
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
  @ApiOperation({
    summary: 'Editar una clase propia',
    description:
      'Solo teacher dueño de la clase (ajena/inexistente → 404 anti-enumeración). Edición parcial de nombre y/o estado: estado=archived archiva y estado=active reactiva. Debe llegar AL MENOS un campo: cuerpo vacío responde 400. El código de unión no es editable (lo posee la BD).',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la clase (BigInt como string).',
    example: '5',
  })
  @ApiOkResponse({
    description: 'La clase tal como quedó.',
    type: ClaseRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Cuerpo vacío o campos inválidos.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Clase inexistente o ajena al profesor del token.',
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
