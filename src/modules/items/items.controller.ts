import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ItemsService } from './items.service';
import {
  ActualizarItemDto,
  CrearItemDto,
  ItemDto,
  ListarItemsQueryDto,
} from './dto/item.dto';

/**
 * Catálogo de ítems canjeables bajo /api/v1/items (H4.1 / PRO-279):
 * CRUD del profesor sobre los ítems de sus clases (T4.1.1), validación
 * por tipo → 422 (T4.1.2) y propiedad ajena → 403 (CA 3 / T4.1.3).
 * Solo rol `teacher` en los 4 endpoints; documentado en el contrato
 * H1.3 con tag `items`.
 */
@ApiTags('items')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description:
    'Rol distinto de teacher, o clase/ítem ajeno o inexistente (403, uniforme por CA 3).',
})
@Roles('teacher')
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  /**
   * Crea un ítem en la clase (CA 1 `fun_activity`, CA 2 `grade_bonus`).
   *
   * @param dto Datos del ítem.
   * @param usuario Profesor autenticado.
   * @returns El ítem creado.
   */
  @ApiCreatedResponse({
    type: ItemDto,
    description: 'Ítem creado (201). La propiedad de la clase se verifica primero (403 si es ajena).',
  })
  @ApiBadRequestResponse({ description: 'Cuerpo estructuralmente inválido (400, whitelist).' })
  @ApiUnprocessableEntityResponse({
    description:
      'Regla de negocio por tipo violada: costo ≤ 0, fun_activity sin stock/stock negativo, grade_bonus sin grade_points (422, CA 4 y T4.1.2).',
  })
  @ApiConflictResponse({ description: 'Nombre ya usado en la clase, P2002 → 409.' })
  @Post()
  crear(
    @Body() dto: CrearItemDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ItemDto> {
    return this.itemsService.crear(dto, usuario);
  }

  /**
   * Lista los ítems de una clase (sin los borrados lógicos).
   *
   * @param dto Query con `classId`.
   * @param usuario Profesor dueño de la clase.
   * @returns Ítems en orden de alta.
   */
  @ApiOkResponse({
    type: ItemDto,
    isArray: true,
    description: 'Ítems de la clase con status != deleted (activos e inactivos).',
  })
  @ApiQuery({ name: 'classId', description: 'Clase a listar (BIGINT como número).' })
  @Get()
  listar(
    @Query() dto: ListarItemsQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ItemDto[]> {
    return this.itemsService.listar(dto, usuario);
  }

  /**
   * Edita un ítem; el resultado mergeado se revalida por tipo (422).
   *
   * @param id Id del ítem.
   * @param dto Campos a cambiar.
   * @param usuario Profesor dueño de la clase del ítem.
   * @returns El ítem actualizado.
   */
  @ApiOkResponse({ type: ItemDto, description: 'Ítem actualizado (200).' })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o campo no editable (400).' })
  @ApiUnprocessableEntityResponse({ description: 'El merge deja el ítem inválido por tipo (422).' })
  @ApiConflictResponse({ description: 'Nombre duplicado en la clase (409).' })
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarItemDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ItemDto> {
    return this.itemsService.actualizar(id, dto, usuario);
  }

  /**
   * Borra lógicamente un ítem (`status = 'deleted'`); idempotente.
   *
   * @param id Id del ítem.
   * @param usuario Profesor dueño de la clase del ítem.
   * @returns El ítem borrado.
   */
  @ApiOkResponse({
    type: ItemDto,
    description: 'Ítem con status deleted (200): el histórico de canjes queda intacto.',
  })
  @Delete(':id')
  borrar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ItemDto> {
    return this.itemsService.borrar(id, usuario);
  }
}
