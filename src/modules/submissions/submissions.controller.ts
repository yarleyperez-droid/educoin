import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PerteneceA } from '../../common/decorators/pertenece-a.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { SubmissionsService } from './submissions.service';
import { CrearEntregaDto } from './dto/crear-entrega.dto';
import { GuardarBorradorDto } from './dto/guardar-borrador.dto';
import type {
  BorradorGuardadoRespuestaDto,
  EntregaBorradorRespuestaDto,
  EntregaCreadaRespuestaDto,
  EntregaRespuestaDto,
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
}
