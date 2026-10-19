import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { SubmissionsService } from './submissions.service';
import { CrearEntregaDto } from './dto/crear-entrega.dto';
import { GuardarBorradorDto } from './dto/guardar-borrador.dto';
import { ListarEntregasQueryDto } from './dto/listar-entregas.dto';
import { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import type {
  BorradorGuardadoRespuestaDto,
  CalificacionRespuestaDto,
  EntregaBorradorRespuestaDto,
  EntregaCreadaRespuestaDto,
  EntregaDetalleProfesorDto,
  EntregaRespuestaDto,
  ListadoEntregasDto,
} from './dto/entrega-respuesta.dto';

/**
 * Flujo de ENTREGAS del ESTUDIANTE (rol student) — AGENTS.md §11 y
 * docs/flujo_entregas.md:
 *
 * - PUT  /activities/:id/submissions → guarda/actualiza el BORRADOR
 *   (autosave por cada cambio; 'in_progress' en el enum real). Las
 *   respuestas pueden ser parciales e incluso vacías, y JAMÁS llevan
 *   is_correct/score (§9.5). 409 si la entrega ya fue enviada: nunca se
 *   baja de submitted a borrador.
 * - GET  /activities/:id/submissions → la entrega del estudiante: el
 *   borrador tal cual para retomarlo o el resultado enviado/calificado.
 *   404 si todavía no existe ninguna.
 * - POST /activities/:id/submissions → ENVÍA la entrega definitiva:
 *   zod exige completitud (toda la actividad respondida, menos file) y
 *   la auto-calificación decide si llega a 'graded' con las monedas
 *   (umbral del 80%, trigger fn_award_coins).
 *
 * Y la COLA DE CALIFICACIÓN del PROFESOR (rol teacher):
 * - GET  /activities/:id/submissions/queue → TODAS las entregas de su
 *   actividad (paginación estándar, filtro ?estado opcional — el caso
 *   principal es ?estado=submitted para calificar). Filas de resumen
 *   con los datos del estudiante; sin answers.
 * - GET  /activities/:id/submissions/:entregaId → VISTA DE REVISIÓN:
 *   la entrega con sus respuestas (veredicto por respuesta), el
 *   estudiante dueño y el feedback si ya fue calificada.
 * - POST /activities/:id/submissions/:entregaId/calificar → transición
 *   definitiva: submitted → graded (puntaje + feedback) o rejected
 *   (feedback). Las monedas y graded_at las escribe el trigger
 *   fn_award_coins; el UPDATE filtra por status='submitted', así una
 *   'graded' jamás se recalifica y el trigger no paga dos veces.
 *
 * @Roles('student'): teacher/admin reciben 403 (RolesGuard corre antes
 * que PertenenciaGuard). @PerteneceA('actividadVisible', 'id') es la
 * puerta del estudiante — actividad published + inscripción ACTIVA en
 * la clase de la actividad: quien no está inscrito (o la actividad es
 * draft/deleted) recibe el 404 estándar anti-enumeración antes de
 * llegar al handler. La inscripción NO viaja en la petición: el Service
 * la deriva del token, así que no hay id ajeno que suplantar (IDOR).
 * El Service re-verifica la misma regla (segunda capa, AGENTS.md §8) y
 * agrega las validaciones amigables; el INSERT queda protegido por
 * fn_validate_submission (422) y uq_submission (P2002 → 409) como red
 * de seguridad final.
 *
 * La cola invierte los roles (@Roles('teacher') +
 * @PerteneceA('actividad', 'id')): la clase de la actividad es suya —
 * un profesor ajeno recibe el mismo 404 estándar anti-enumeración.
 */
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @Get('activities/:id/submissions')
  miEntrega(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaBorradorRespuestaDto | EntregaRespuestaDto> {
    return this.submissionsService.miEntrega(id, usuario);
  }

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @Put('activities/:id/submissions')
  guardarBorrador(
    @Param('id') id: string,
    @Body() dto: GuardarBorradorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BorradorGuardadoRespuestaDto> {
    return this.submissionsService.guardarBorrador(id, dto, usuario);
  }

  @Roles('student')
  @PerteneceA('actividadVisible', 'id')
  @Post('activities/:id/submissions')
  entregar(
    @Param('id') id: string,
    @Body() dto: CrearEntregaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaCreadaRespuestaDto> {
    return this.submissionsService.entregar(id, dto, usuario);
  }

  /**
   * COLA DE CALIFICACIÓN del profesor: TODAS las entregas de SU
   * actividad, paginadas ({ data, meta }) y con filtro ?estado
   * opcional del enum submission_status — el caso principal es
   * ?estado=submitted: las que esperan su calificación. Filas de
   * resumen con los datos del estudiante (join enrollments → users),
   * SIN answers: el listado es un resumen (mismo criterio que el de
   * actividades) y el detalle de cada entrega llegará con el endpoint
   * de calificación (docs/flujo_entregas.md §10).
   *
   * @Roles('teacher'): student/admin reciben 403 (RolesGuard corre
   * antes de PertenenciaGuard). @PerteneceA('actividad', 'id') es la
   * puerta: la clase de la actividad es suya — un profesor ajeno (o un
   * id inexistente) recibe el 404 estándar anti-enumeración antes de
   * llegar al handler. El Service re-verifica la misma regla (segunda
   * capa, AGENTS.md §8).
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @Get('activities/:id/submissions/queue')
  cola(
    @Param('id') id: string,
    @Query() query: ListarEntregasQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoEntregasDto> {
    return this.submissionsService.cola(id, query, usuario);
  }

  /**
   * VISTA DE REVISIÓN de UNA entrega de su actividad: lo que la cola
   * no trae — el answers JSONB con veredicto por respuesta, el
   * estudiante dueño, y el resultado/feedback si ya fue calificada. Es
   * lo que el profesor mira ANTES de decidir la calificación (las
   * preguntas de la actividad, con las correctas, ya las tiene en
   * GET /activities/:id).
   *
   * @Roles('teacher'): student/admin reciben 403.
   * @PerteneceA('actividad', 'id'): la clase de la actividad es suya —
   * un profesor ajeno recibe el 404 estándar anti-enumeración; el
   * Service re-verifica (segunda capa) y exige además que la entrega
   * pertenezca a ESA actividad (si no: el mismo 404).
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  @Get('activities/:id/submissions/:entregaId')
  detalle(
    @Param('id') id: string,
    @Param('entregaId') entregaId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EntregaDetalleProfesorDto> {
    return this.submissionsService.detalle(id, entregaId, usuario);
  }

  /**
   * CALIFICA la entrega pendiente: submitted → graded (puntaje dentro
   * de 0..total de la actividad + feedback opcional) o rejected
   * (feedback opcional, sin puntaje). Solo el dueño de la actividad.
   *
   * La transición es ATÓMICA y unilateral (patrón del autosave): el
   * UPDATE filtra por status='submitted' — recalificar una entrega ya
   * 'graded' (o tocar un borrador) queda sin efecto y responde 409,
   * así el trigger fn_award_coins no puede otorgar dos veces las
   * monedas de la misma entrega. El backend JAMÁS escribe monedas ni
   * graded_at: los acredita el trigger en → graded (AGENTS.md §6) y la
   * respuesta devuelve la fila re-leída tal como quedó.
   *
   * Rechazos (precedencia): 400 DTO/condicional → 404 actividad ajena
   * /entrega inexistente o de otra actividad → 409 ya no está
   * 'submitted' → 422 puntaje fuera de 0..total.
   */
  @Roles('teacher')
  @PerteneceA('actividad', 'id')
  // 200 y no el 201 por defecto de POST: no crea un recurso nuevo,
  // transiciona uno existente y lo devuelve (mismo criterio que
  // POST /activities/:id/publicar).
  @HttpCode(HttpStatus.OK)
  @Post('activities/:id/submissions/:entregaId/calificar')
  calificar(
    @Param('id') id: string,
    @Param('entregaId') entregaId: string,
    @Body() dto: CalificarEntregaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CalificacionRespuestaDto> {
    return this.submissionsService.calificar(id, entregaId, dto, usuario);
  }
}
