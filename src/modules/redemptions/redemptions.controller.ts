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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { RedemptionsService } from './redemptions.service';
import { CrearCanjeDto } from './dto/crear-canje.dto';
import { PrevisualizarCanjeQueryDto } from './dto/previsualizar-canje.query.dto';
import {
  CanjeRespuestaDto,
  PrevisualizacionCanjeDto,
} from './dto/canje-respuesta.dto';

/**
 * Endpoints de canje instantáneo bajo /api/v1/redemptions (H4.4 / PRO-282):
 * - GET  /preview?itemId= → costo, saldo y stock ANTES de confirmar (T4.4.1).
 * - POST /                 → canje atómico con costo congelado (T4.4.2).
 * - POST /:id/reverse      → anula el canje propio; trigger revierte (T4.4.3).
 *
 * Solo el rol `student` (todo el controlador) y siempre sobre SU inscripción:
 * el service vuelve a verificar dueño/inscripción (segunda capa, AGENTS.md §8).
 * Documentado en el contrato de H1.3 con `@ApiTags` + `@ApiBearerAuth`.
 */
@ApiTags('redemptions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description: 'Rol distinto de student (403).',
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
   * Confirma el canje (atómico: costo congelado, stock y saldo).
   *
   * @param dto `{ itemId }`.
   * @param usuario Estudiante autenticado.
   * @returns El canje `completed`.
   */
  @ApiCreatedResponse({
    type: CanjeRespuestaDto,
    description:
      'Canje confirmado (completed): el costo queda congelado y saldo/stock descontados por la BD (T4.4.2).',
  })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido (400).' })
  @ApiNotFoundResponse({ description: 'Ítem o inscripción inexistente (404).' })
  @Post()
  canjear(
    @Body() dto: CrearCanjeDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    return this.redemptionsService.canjear(dto.itemId, usuario);
  }

  /**
   * Anula un canje propio `completed` (el trigger revierte monedas/stock).
   *
   * @param id Id del canje.
   * @param usuario Estudiante dueño.
   * @returns El canje `reversed`.
   */
  @ApiOkResponse({
    type: CanjeRespuestaDto,
    description:
      'Canje anulado (reversed): monedas y stock revueltos por el trigger de BD (T4.4.3).',
  })
  @ApiNotFoundResponse({ description: 'Canje inexistente o ajeno (404).' })
  @ApiConflictResponse({ description: 'El canje ya fue anulado (409).' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/reverse')
  anular(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    return this.redemptionsService.anular(id, usuario);
  }
}
