import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { ErrorRespuestaDto } from '../../common/dto/error-respuesta.dto';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ActivitiesService } from './activities.service';
import { CrearActividadDto } from './dto/crear-actividad.dto';
import { ActualizarActividadDto } from './dto/actualizar-actividad.dto';
import { PublicarActividadDto } from './dto/publicar-actividad.dto';
import {
  ListarActividadesPublicadasQueryDto,
  ListarActividadesQueryDto,
} from './dto/listar-actividades.dto';
import {
  ActividadCreadaRespuestaDto,
  ActividadEstudianteRespuestaDto,
  ActividadRespuestaDto,
  ListadoActividadesDto,
} from './dto/actividad-respuesta.dto';

/**
 * Endpoints de actividades: flujo del PROFESOR (mutaciones y listado por
 * clase — rol teacher) y LECTURA del estudiante inscrito (rol student).
 * El admin gestiona organizaciones/usuarios, no aulas (403 aquí).
 *
 * Profesor:
 * - POST   /classes/:claseId/activities → crea la actividad como 'draft'
 *          (default de la BD) con sus preguntas JSONB validadas por zod.
 * - GET    /classes/:claseId/activities → lista SUS actividades de esa
 *          clase (paginado, filtro ?estado opcional).
 * - GET    /activities/:id              → detalle COMPLETO (el dueño ve
 *          el JSONB entero, con opciones correctas).
 * - PATCH  /activities/:id              → edita el borrador; en publicada
 *          solo cierraEn (409 en lo demás).
 * - POST   /activities/:id/publicar      → draft → published (setea
 *          published_at; sin despublicar).
 * - DELETE /activities/:id              → borrado lógico (deleted + deleted_at).
 *
 * Estudiante (solo lectura, sin respuestas correctas — AGENTS.md §9.5):
 * - GET    /enrollments/:inscripcionId/activities → actividades published
 *          de la clase de SU inscripción (paginado, filas sin preguntas).
 * - GET    /activities/:id → detalle SANITIZADO: mismas rutas que el
 *          profesor, DTO distinto por rol (is_correct/expected_answer
 *          jamás viajan al estudiante).
 *
 * La creación es la única ruta anidada de escritura y NO usa @PerteneceA
 * con el id de la actividad (aún no existe): verifica con @PerteneceA(
 * 'clase', 'claseId') que la clase SEA SUYA antes de crear dentro de
 * ella. Las mutaciones declaran @PerteneceA('actividad', 'id') (la clase
 * de la actividad es suya); las lecturas usan @PerteneceA('actividadVisible',
 * 'id') (dueño o estudiante con inscripción activa en clase de actividad
 * published) y el listado del estudiante @PerteneceA('inscripcion',
 * 'inscripcionId') — reglas de AutorizacionService. El Service re-verifica
 * la misma regla como segunda capa (AGENTS.md §8) y los errores de la BD
 * los traduce el filtro global (P2025→404, RAISE de ck_activity_dates→422).
 *
 * Rutas sin @PerteneceA no existen en este módulo: toda operación toca
 * un recurso con dueño (la clase al crear, la actividad/inscripción en
 * el resto).
 */
@ApiTags('Activities')
// Todas las rutas son protegidas: guards GLOBALES (JWT + roles).
@ApiBearerAuth()
@Controller()
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Roles('teacher')
  @PerteneceA('clase', 'claseId')
  @ApiOperation({
    summary: 'Crear una actividad en una clase propia',
    description:
      "Solo teacher, y solo dentro de UNA CLASE PROPIA (ajena/inexistente → 404 anti-enumeración). La actividad nace 'draft': los estudiantes solo ven publicadas. Las preguntas JSONB se validan en profundidad con zod (posiciones secuenciales, una única opción correcta por test, expected_answer en completion…).",
  })
  @ApiParam({
    name: 'claseId',
    description: 'Id numérico de la clase (BigInt como string).',
    example: '5',
  })
  @ApiCreatedResponse({
    description: 'Actividad creada como borrador (draft).',
    type: ActividadCreadaRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'DTO inválido o preguntas JSONB que no pasan la validación zod.',
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
  @ApiUnprocessableEntityResponse({
    type: ErrorRespuestaDto,
    description:
      'La operación infringe una regla de la BD (p. ej. closes_at en el pasado).',
  })
  @Post('classes/:claseId/activities')
  crear(
    @Param('claseId') claseId: string,
    @Body() dto: CrearActividadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ActividadCreadaRespuestaDto> {
    return this.activitiesService.crear(claseId, dto, usuario);
  }

  @Roles('teacher')
  @PerteneceA('clase', 'claseId')
  @ApiOperation({
    summary: 'Listar las actividades de una clase propia',
    description:
      'Solo teacher dueño de la clase. Listado paginado { data, meta } con filtro opcional ?estado (draft/published/deleted). Filas de resumen SIN preguntas: el JSONB completo está en GET /activities/:id.',
  })
  @ApiParam({
    name: 'claseId',
    description: 'Id numérico de la clase (BigInt como string).',
    example: '5',
  })
  @ApiOkResponse({
    description: 'Actividades de la clase (filas de resumen).',
    type: ListadoActividadesDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Parámetros de consulta inválidos (paginación/estado).',
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
  @Get('classes/:claseId/activities')
  listar(
    @Param('claseId') claseId: string,
    @Query() query: ListarActividadesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoActividadesDto> {
    return this.activitiesService.listar(claseId, query, usuario);
  }

  /**
   * Detalle con DTO POR ROL (AGENTS.md §9.5):
   * - teacher dueño → JSONB completo (con opciones correctas).
   * - student inscrito → vista sanitizada SIN is_correct/expected_answer.
   * La regla 'actividadVisible' (AutorizacionService) resuelve ambos
   * roles en el guard; el Service vuelve a verificarla y ramifica el
   * DTO según el rol del token — la respuesta correcta NUNCA sale al
   * estudiante (AGENTS.md §9.5), ni siquiera si el JSONB tuviera campos
   * inesperados: el mapper copia con allow-list.
   */
  @Roles('teacher', 'student')
  @PerteneceA('actividadVisible', 'id')
  @ApiExtraModels(ActividadRespuestaDto, ActividadEstudianteRespuestaDto)
  @ApiOperation({
    summary: 'Detalle de una actividad (DTO por rol)',
    description:
      'Misma ruta, DTO POR ROL: el teacher dueño recibe el JSONB completo (con opciones correctas y expected_answer); el estudiante inscrito recibe la vista sanitizada SIN nada de lo correcto (AGENTS.md §9.5). Actividad ajena/borrador sin inscripción/inexistente → 404 anti-enumeración.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description:
      'Vista del profesor dueño (completa) o del estudiante inscrito (sanitizada), según el rol del token.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ActividadRespuestaDto) },
        { $ref: getSchemaPath(ActividadEstudianteRespuestaDto) },
      ],
    },
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es teacher ni student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description:
      'Actividad inexistente, no publicada o sin inscripción activa del estudiante.',
  })
  @Get('activities/:id')
  detalle(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto | ActividadEstudianteRespuestaDto> {
    return this.activitiesService.detalle(id, usuario);
  }

  /**
   * Vista del ESTUDIANTE: actividades published de la clase de SU
   * inscripción (solo rol student; el profesor tiene su propio listado
   * por clase). @PerteneceA('inscripcion') verifica que la inscripción
   * sea suya; el Service exige además que esté activa y fija el filtro
   * published. Las filas no llevan preguntas (igual que el listado del
   * profesor): el detalle sanitizado está en GET /activities/:id.
   */
  @Roles('student')
  @PerteneceA('inscripcion', 'inscripcionId')
  @ApiOperation({
    summary: 'Actividades publicadas de la clase de mi inscripción',
    description:
      'Solo student, y solo de UNA INSCRIPCIÓN PROPIA y activa (ajena/inexistente → 404 anti-enumeración). Listado paginado { data, meta } de las actividades published; sin filtro ?estado a propósito. Filas SIN preguntas: el detalle sanitizado está en GET /activities/:id.',
  })
  @ApiParam({
    name: 'inscripcionId',
    description: 'Id numérico de la inscripción (BigInt como string).',
    example: '12',
  })
  @ApiOkResponse({
    description: 'Actividades publicadas de la clase.',
    type: ListadoActividadesDto,
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
    description: 'El rol del token no es student.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Inscripción inexistente, ajena o no activa.',
  })
  @Get('enrollments/:inscripcionId/activities')
  listarPublicadas(
    @Param('inscripcionId') inscripcionId: string,
    @Query() query: ListarActividadesPublicadasQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoActividadesDto> {
    return this.activitiesService.listarPublicadas(
      inscripcionId,
      query,
      usuario,
    );
  }

  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @ApiOperation({
    summary: 'Editar una actividad propia',
    description:
      'Solo teacher dueño de la actividad. Edición parcial: en un borrador se toca todo; en una PUBLICADA solo cierraEn (lo demás responde 409). Las preguntas, si viajan, REEMPLAZAN el JSONB completo. Cuerpo vacío responde 400.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description: 'La actividad tal como quedó.',
    type: ActividadRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Cuerpo vacío o preguntas JSONB que no pasan la validación zod.',
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
    description: 'Actividad inexistente o ajena al profesor del token.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'La actividad ya está publicada: solo cierraEn es editable.',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorRespuestaDto,
    description: 'La operación infringe una regla de la BD (p. ej. fechas).',
  })
  @Patch('activities/:id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarActividadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto> {
    return this.activitiesService.actualizar(id, dto, usuario);
  }

  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  // 200 y no el 201 por defecto de POST: no crea un recurso nuevo,
  // transiciona uno existente (draft → published) y lo devuelve.
  @ApiOperation({
    summary: 'Publicar una actividad propia',
    description:
      'Solo teacher dueño. Transición definitiva draft → published: setea published_at, la fecha a partir de la cual los estudiantes inscritos la ven. El cuerpo es opcional (solo cierraEn). No hay despublicar: una actividad publicada ya no vuelve a draft.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiOkResponse({
    description: 'La actividad ya publicada.',
    type: ActividadRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'cierraEn con formato inválido o no posterior a la publicación.',
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
    description: 'Actividad inexistente o ajena al profesor del token.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'La actividad ya está publicada (o eliminada).',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorRespuestaDto,
    description:
      'La operación infringe una regla de la BD (p. ej. closes_at ≤ published_at).',
  })
  @HttpCode(HttpStatus.OK)
  @Post('activities/:id/publicar')
  publicar(
    @Param('id') id: string,
    @Body() dto: PublicarActividadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ActividadRespuestaDto> {
    return this.activitiesService.publicar(id, dto, usuario);
  }

  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @ApiOperation({
    summary: 'Eliminar una actividad propia (borrado lógico)',
    description:
      "Solo teacher dueño. Borrado LÓGICO: pone status='deleted' y deleted_at (nunca hay DELETE físico). Los estudiantes dejan de verla y las entregas existentes conservan su historial.",
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la actividad (BigInt como string).',
    example: '7',
  })
  @ApiNoContentResponse({ description: 'Actividad eliminada (deleted).' })
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
    description: 'Actividad inexistente o ajena al profesor del token.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('activities/:id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.activitiesService.eliminar(id, usuario);
  }
}
