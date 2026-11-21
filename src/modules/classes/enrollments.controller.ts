import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { ClassesService } from './classes.service';
import { ListarInscripcionesQueryDto } from './dto/listar-inscripciones.dto';
import { ListadoInscripcionesDto } from './dto/inscripcion-respuesta.dto';

/**
 * Endpoints de inscripciones bajo /api/v1/enrollments.
 *
 * - GET / → inscripciones activas del estudiante autenticado (rol
 *   `student`). Permite al frontend descubrir los `inscripcionId` que
 *   necesita para `GET /enrollments/:inscripcionId/activities` (H3.3).
 *
 * No expone el código de unión de la clase ni datos internos del
 * profesor/organización: solo id de la inscripción, id y nombre de la
 * clase, estado y fecha de inscripción (mínima exposición, AGENTS.md §8).
 */
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Sin token, token inválido o expirado (401).',
})
@ApiForbiddenResponse({
  description: 'Rol insuficiente para la operación (403).',
})
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly classesService: ClassesService) {}

  /**
   * GET /enrollments: clases en las que el estudiante está inscrito y
   * activo. El listado solo incluye inscripciones `active` de clases
   * `active`; archivadas/retiradas/bloqueadas no aparecen aquí.
   */
  @Roles('student')
  @ApiOkResponse({
    type: ListadoInscripcionesDto,
    description:
      'Inscripciones activas del estudiante con paginación estándar { data, meta }.',
  })
  @ApiBadRequestResponse({
    description: 'Parámetros de paginación inválidos (400).',
  })
  @Get()
  listar(
    @Query() query: ListarInscripcionesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoInscripcionesDto> {
    return this.classesService.listarInscripciones(query, usuario);
  }
}
