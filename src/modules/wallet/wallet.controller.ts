import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { WalletService } from './wallet.service';
import { HistorialBilleteraQueryDto } from './dto/historial-billetera.query.dto';
import {
  HistorialBilleteraDto,
  SaldoBilleteraDto,
} from './dto/saldo-billetera.dto';

/**
 * Billetera del estudiante bajo /api/v1/wallet (H4.2 / PRO-280):
 * - GET /            → saldo agregado desde la vista `student_coins` (T4.2.1).
 * - GET /movements   → historial paginado de `coin_movements` (T4.2.2).
 *
 * Solo el rol `student` y siempre los datos del PROPIO token: no existe
 * ruta `:id`; el query opcional `?studentId=` solo sirve para poder
 * responder 403 de forma explícita si alguien intenta el ajeno (CA 3).
 * Documentado en el contrato H1.3 con tag `wallet`.
 */
@ApiTags('wallet')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description: 'Rol distinto de student, o consulta de la billetera ajena (403).',
})
@Roles('student')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Saldo del estudiante autenticado (CA 1: igual a la vista `student_coins`).
   *
   * @param query Query opcional con `studentId` (403 si es ajeno).
   * @param usuario Estudiante autenticado.
   * @returns Ganadas, gastadas y disponibles.
   */
  @ApiOkResponse({
    type: SaldoBilleteraDto,
    description:
      'Saldo agregado de TODAS las inscripciones, leído de la vista student_coins (solo lectura).',
  })
  @ApiQuery({
    name: 'studentId',
    required: false,
    description: 'Solo para rechazar con 403 la billetera ajena (CA 3).',
  })
  @Get()
  saldo(
    @Query() query: { studentId?: string },
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SaldoBilleteraDto> {
    return this.walletService.saldo(usuario, query.studentId);
  }

  /**
   * Historial paginado de movimientos del propio estudiante (CA 2 y 4).
   *
   * @param query Paginación y `studentId` opcional.
   * @param usuario Estudiante autenticado.
   * @returns Movimientos con envoltura `{ data, meta }`.
   */
  @ApiOkResponse({
    type: HistorialBilleteraDto,
    description:
      'Historial de coin_movements (earning/spending/reversal/adjustment) en orden descendente, con la clase de cada movimiento.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página (default 20, tope 100).',
  })
  @ApiQuery({
    name: 'studentId',
    required: false,
    description: 'Solo para rechazar con 403 la billetera ajena (CA 3).',
  })
  @Get('movements')
  historial(
    @Query() query: HistorialBilleteraQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<HistorialBilleteraDto> {
    return this.walletService.historial(query, usuario);
  }
}
