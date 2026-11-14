import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { RankingsService } from './rankings.service';
import { RankingQueryDto } from './dto/ranking.query.dto';
import { RankingDto } from './dto/ranking.dto';

/**
 * Rankings global y por clase bajo /api/v1/rankings (H4.3 / PRO-281):
 * - GET /            → ranking global por monedas GANADAS (T4.3.1).
 * - GET /classes/:id → ranking de una clase (solo inscripciones active).
 *
 * Solo lectura sobre las vistas `global_ranking` / `class_ranking`:
 * canjear no baja de puesto porque el orden es por monedas ganadas
 * (CA 2). Cualquier rol autenticado consulta (S3); el alcance por
 * organización (S2) y el acceso por clase (S4) se resuelven en el
 * service — sin `@PerteneceA`, cuya regla `'clase'` es teacher-only.
 * Documentado en el contrato H1.3 con tag `rankings`.
 */
@ApiTags('rankings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description: 'Rol distinto de student, teacher o admin (403).',
})
@Roles('student', 'teacher', 'admin')
@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  /**
   * Ranking global paginado por monedas ganadas (CA 1, 2, 5 y 6).
   *
   * @param query Paginación opcional (page/limit).
   * @param usuario Usuario autenticado.
   * @returns Filas ordenadas con la envoltura `{ data, meta }`.
   */
  @ApiOkResponse({
    type: RankingDto,
    description:
      'Ranking global (vista global_ranking) ordenado por monedasGanadas descendente; student/teacher solo ven su organización y admin ve todas.',
  })
  @ApiBadRequestResponse({
    description: 'Query inválida: page/limit fuera de rango o campos extra (400).',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página (default 20, tope 100).',
  })
  @Get()
  global(
    @Query() query: RankingQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RankingDto> {
    return this.rankingsService.global(usuario, query.page, query.limit);
  }

  /**
   * Ranking de una clase, solo inscripciones active (CA 3, 4 y 7).
   *
   * @param id Id de la clase (no numérico → 404 anti-enumeración).
   * @param query Paginación opcional (page/limit).
   * @param usuario Usuario autenticado.
   * @returns Filas ordenadas con la envoltura `{ data, meta }`.
   */
  @ApiOkResponse({
    type: RankingDto,
    description:
      'Ranking de la clase (vista class_ranking) con solo las inscripciones active, ordenado por monedasGanadas descendente.',
  })
  @ApiBadRequestResponse({
    description: 'Query inválida: page/limit fuera de rango o campos extra (400).',
  })
  @ApiNotFoundResponse({
    description:
      'Clase inexistente, ajena o sin acceso para el rol (404, anti-enumeración).',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Filas por página (default 20, tope 100).',
  })
  @Get('classes/:id')
  porClase(
    @Param('id') id: string,
    @Query() query: RankingQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<RankingDto> {
    return this.rankingsService.porClase(id, usuario, query.page, query.limit);
  }
}
