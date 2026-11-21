import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { RedemptionsService } from './redemptions.service';
import { CrearCanjeDto } from './dto/crear-canje.dto';
import { ListarCanjesQueryDto } from './dto/listar-canjes.query.dto';
import { PrevisualizarCanjeQueryDto } from './dto/previsualizar-canje.query.dto';
import {
  CanjeRespuestaDto,
  ListadoCanjesDto,
  PrevisualizacionCanjeDto,
  ResolucionCanjeDto,
} from './dto/canje-respuesta.dto';

/**
 * Endpoints de canje bajo /api/v1/redemptions (H4.4 / PRO-282 + H7.2 /
 * PRO-447, contrato en `docs/propuesta_canje_revisable.md` §3):
 *
 * Estudiante (`student`, del `@Roles` de clase):
 * - GET  /preview?itemId=  → costo, saldo y stock ANTES de confirmar (T4.4.1).
 * - POST /                 → solicitud atómica en `pending` (o `approved`
 *                            con auto-aprobación del ítem; T4.4.2 + T7.2.2).
 * - GET  /mine             → historial propio paginado (T7.2.5).
 * - POST /:id/reverse      → anulación legacy de un canje `completed`
 *                            (T4.4.3; el resto de estados → 409).
 *
 * Profesor (`teacher`, `@Roles` a nivel de método pisa el de clase —
 * `RolesGuard` usa `getAllAndOverride`):
 * - GET  /pending                  → cola de pendientes de SUS clases (T7.2.4).
 * - POST /:id/approve|reject|deliver → resolución del canje (T7.2.3).
 *
 * El service vuelve a verificar dueño/inscripción/propiedad (segunda
 * capa, AGENTS.md §8). Documentado en el contrato de H1.3 con
 * `@ApiTags` + `@ApiBearerAuth`.
 */
@ApiTags('redemptions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@Roles('student')
@Controller('redemptions')
export class RedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  /**
   * Previsualiza el canje de un ítem para el estudiante autenticado.
   *
   * @param query `itemId` del ítem.
   * @param usuario Estudiante autenticado.
   * @returns Costo, saldo, stock y la decisión `puedeCanjear`.
   */
  @ApiOkResponse({
    type: PrevisualizacionCanjeDto,
    description:
      'Previsualización del canje: costo, saldo y stock antes de confirmar (T4.4.1).',
  })
  @ApiBadRequestResponse({ description: 'itemId no numérico (400).' })
  @ApiForbiddenResponse({ description: 'Rol distinto de student (403).' })
  @ApiNotFoundResponse({
    description: 'Ítem inexistente o sin inscripción activa en su clase (404).',
  })
  @Get('preview')
  previsualizar(
    @Query() query: PrevisualizarCanjeQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PrevisualizacionCanjeDto> {
    return this.redemptionsService.previsualizarCanje(query.itemId, usuario);
  }

  /**
   * Cola de pendientes del profesor autenticado (T7.2.4): solo los canjes
   * `pending` de SUS clases, ordenados por `redeemed_at` (FIFO) y
   * paginados con la envoltura estándar `{ data, meta }`.
   *
   * @param query Paginación opcional (`page`, `limit`).
   * @param usuario Profesor autenticado.
   * @returns Pendientes de sus clases con `{ data, meta }`.
   */
  @Roles('teacher')
  @ApiOkResponse({
    type: ListadoCanjesDto,
    description:
      'Canjes pending de las clases del profesor, ordenados por solicitud (T7.2.4).',
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida (400).' })
  @ApiForbiddenResponse({ description: 'Rol distinto de teacher (403).' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página, tope 100 (default 20).',
  })
  @Get('pending')
  colaPendientes(
    @Query() query: ListarCanjesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoCanjesDto> {
    return this.redemptionsService.colaPendientes(query, usuario);
  }

  /**
   * Historial de canjes del estudiante autenticado (T7.2.5): solo los de
   * SUS inscripciones, ordenados por solicitud descendente y paginados
   * con `{ data, meta }`.
   *
   * @param query Paginación opcional (`page`, `limit`).
   * @param usuario Estudiante autenticado.
   * @returns Sus canjes con `{ data, meta }`.
   */
  @Roles('student')
  @ApiOkResponse({
    type: ListadoCanjesDto,
    description:
      'Canjes de las inscripciones del estudiante, más recientes primero (T7.2.5).',
  })
  @ApiBadRequestResponse({ description: 'Paginación inválida (400).' })
  @ApiForbiddenResponse({ description: 'Rol distinto de student (403).' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página, tope 100 (default 20).',
  })
  @Get('mine')
  historial(
    @Query() query: ListarCanjesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoCanjesDto> {
    return this.redemptionsService.historial(query, usuario);
  }

  /**
   * Solicita el canje de un ítem (atómico: costo congelado, stock y
   * saldo). La fila nace en `pending` (o `approved` si el ítem tiene
   * auto-aprobación, §2.6 de la propuesta).
   *
   * @param dto `{ itemId }`.
   * @param usuario Estudiante autenticado.
   * @returns El canje `pending` (o `approved`).
   */
  @ApiCreatedResponse({
    type: CanjeRespuestaDto,
    description:
      'Canje solicitado (pending, o approved con auto-aprobación): costo congelado y saldo/stock descontados por la BD (T4.4.2 + T7.2.2).',
  })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido (400).' })
  @ApiForbiddenResponse({ description: 'Rol distinto de student (403).' })
  @ApiNotFoundResponse({ description: 'Ítem o inscripción inexistente (404).' })
  @ApiUnprocessableEntityResponse({
    description:
      '422 con los mensajes exactos del contrato: `Saldo insuficiente`, `Sin stock disponible` o `El ítem no está disponible.` Sin crear la fila.',
  })
  @Post()
  canjear(
    @Body() dto: CrearCanjeDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    return this.redemptionsService.canjear(dto.itemId, usuario);
  }

  /**
   * Aprueba un canje `pending` (transición 1 del contrato §3.2). Escribe
   * `status` + `resolved_by` + `resolved_at` en un solo UPDATE; sin
   * movimientos ni cambios de monedas/stock.
   *
   * @param id Id del canje.
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `approved` con su `resueltoEn`.
   */
  @Roles('teacher')
  @ApiOkResponse({
    type: ResolucionCanjeDto,
    description: 'Canje aprobado (approved) con su auditoría de resolución.',
  })
  @ApiForbiddenResponse({
    description:
      'No imparte la clase del canje → `No tienes permiso para resolver este canje` (403).',
  })
  @ApiNotFoundResponse({
    description: 'Canje inexistente → `El canje solicitado no existe.` (404).',
  })
  @ApiConflictResponse({
    description: 'Ya resuelto → `El canje ya fue resuelto` (409).',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  aprobar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.redemptionsService.aprobar(id, usuario);
  }

  /**
   * Rechaza un canje `pending` (transición 3 del contrato §3.2). La
   * devolución íntegra de monedas y stock la hace el trigger de la BD en
   * la misma transacción (1 solo `reversal`); `reversed_at` no se toca.
   *
   * @param id Id del canje.
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `rejected` con su `resueltoEn`.
   */
  @Roles('teacher')
  @ApiOkResponse({
    type: ResolucionCanjeDto,
    description:
      'Canje rechazado (rejected): monedas y stock devueltos por el trigger de BD.',
  })
  @ApiForbiddenResponse({
    description:
      'No imparte la clase del canje → `No tienes permiso para resolver este canje` (403).',
  })
  @ApiNotFoundResponse({
    description: 'Canje inexistente → `El canje solicitado no existe.` (404).',
  })
  @ApiConflictResponse({
    description: 'Ya resuelto → `El canje ya fue resuelto` (409).',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  rechazar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.redemptionsService.rechazar(id, usuario);
  }

  /**
   * Marca un canje `approved` como entregado (transición 2 del contrato
   * §3.2): siempre manual (la auto-aprobación no entrega) y sin
   * movimientos; la auditoría ya quedó al aprobar.
   *
   * @param id Id del canje.
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `delivered`.
   */
  @Roles('teacher')
  @ApiOkResponse({
    type: ResolucionCanjeDto,
    description: 'Canje entregado (delivered); resueltoEn = su aprobación.',
  })
  @ApiForbiddenResponse({
    description:
      'No imparte la clase del canje → `No tienes permiso para resolver este canje` (403).',
  })
  @ApiNotFoundResponse({
    description: 'Canje inexistente → `El canje solicitado no existe.` (404).',
  })
  @ApiConflictResponse({
    description:
      'No venía de approved → `El canje ya fue resuelto` (409).',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/deliver')
  entregar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.redemptionsService.entregar(id, usuario);
  }

  /**
   * Anula un canje propio **`completed`** (legado del MVP: el flujo
   * instantáneo se retira en H7.2 — decisión 5; la reversión de un canje
   * nuevo solo la dispara el rechazo del profesor). El trigger revierte
   * monedas/stock.
   *
   * @param id Id del canje.
   * @param usuario Estudiante dueño.
   * @returns El canje `reversed`.
   */
  @Roles('student')
  @ApiOkResponse({
    type: CanjeRespuestaDto,
    description:
      'Canje anulado (reversed): monedas y stock revueltos por el trigger de BD (T4.4.3).',
  })
  @ApiForbiddenResponse({ description: 'Rol distinto de student (403).' })
  @ApiNotFoundResponse({
    description:
      'Canje inexistente o ajeno → `El canje solicitado no existe.` (404).',
  })
  @ApiConflictResponse({
    description: 'No está en completed → `El canje ya fue resuelto` (409).',
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/reverse')
  anular(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    return this.redemptionsService.anular(id, usuario);
  }
}
