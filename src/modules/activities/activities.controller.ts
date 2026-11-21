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
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ActivitiesService } from './activities.service';
import { CrearActividadDto } from './dto/crear-actividad.dto';
import { ActualizarActividadDto } from './dto/actualizar-actividad.dto';
import { PublicarActividadDto } from './dto/publicar-actividad.dto';
import {
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
@Controller()
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Roles('teacher')
  @PerteneceA('clase', 'claseId')
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('activities/:id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.activitiesService.eliminar(id, usuario);
  }
}
