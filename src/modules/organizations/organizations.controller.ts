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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { ErrorRespuestaDto } from '../../common/dto/error-respuesta.dto';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { OrganizationsService } from './organizations.service';
import { CrearOrganizacionDto } from './dto/crear-organizacion.dto';
import { ActualizarOrganizacionDto } from './dto/actualizar-organizacion.dto';
import { ListarOrganizacionesQueryDto } from './dto/listar-organizaciones.dto';
import {
  ListadoOrganizacionesDto,
  OrganizacionCreadaRespuestaDto,
  OrganizacionRespuestaDto,
} from './dto/organizacion-respuesta.dto';

/**
 * Endpoints de organizaciones bajo /api/v1/organizations (AGENTS.md §8):
 * - POST   /     → crea una organización (AGENTS.md §5: solo el admin).
 * - GET    /     → listado paginado con filtros de nombre/tipo/estado.
 * - GET    /:id  → detalle de una organización.
 * - PATCH  /:id  → edita nombre, tipo, ciudad y/o estado activo.
 * - DELETE /:id  → borrado LÓGICO: is_active=false; nunca DELETE físico
 *                  (la tabla no tiene deleted_at y ninguna tabla se
 *                  vacía a mano; la reactivación solo vía PATCH).
 *
 * La autorización es SOLO de rol: los guards GLOBALES del AuthModule
 * (JwtAuthGuard → RolesGuard) protegen cada ruta y @Roles('admin') la
 * restringe al administrador. No se usa @PerteneceA porque las
 * organizaciones no tienen dueño por usuario — son un recurso global
 * del admin, que pasa siempre ese guard (docs/guard_pertenencia.md §4).
 * La segunda capa vive en el service: re-verifica el rol y, al crear,
 * que el admin del token siga activo en la BD (AGENTS.md §8).
 */
@ApiTags('Organizations')
// Todas las rutas son de admin: guards GLOBALES (JWT + roles).
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Roles('admin')
  @ApiOperation({
    summary: 'Crear una organización',
    description:
      'Solo admin. Nace activa (is_active es DEFAULT TRUE de la BD: no se acepta del cliente). El nombre es único en la BD.',
  })
  @ApiCreatedResponse({
    description: 'Organización creada.',
    type: OrganizacionCreadaRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'DTO inválido (nombre 3-200, tipo del enum).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es admin.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'Ya existe una organización con ese nombre.',
  })
  @Post()
  crear(
    @Body() dto: CrearOrganizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionCreadaRespuestaDto> {
    return this.organizationsService.crear(dto, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Listar organizaciones',
    description:
      'Solo admin. Listado paginado { data, meta } con filtros opcionales de nombre (contains insensible), tipo y estado activo.',
  })
  @ApiOkResponse({
    description: 'Listado paginado.',
    type: ListadoOrganizacionesDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Parámetros de consulta inválidos (paginación/filtros).',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es admin.',
  })
  @Get()
  listar(
    @Query() query: ListarOrganizacionesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoOrganizacionesDto> {
    return this.organizationsService.listar(query, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Detalle de una organización',
    description: 'Solo admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la organización (BigInt como string).',
    example: '1',
  })
  @ApiOkResponse({
    description: 'La organización.',
    type: OrganizacionRespuestaDto,
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es admin.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Organización inexistente o desactivada.',
  })
  @Get(':id')
  buscarPorId(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    return this.organizationsService.buscarPorId(id, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Editar una organización',
    description:
      'Solo admin. Edición parcial: nombre, tipo, ciudad (null la limpia) y/o estado activo. Debe llegar AL MENOS un campo: un cuerpo vacío responde 400. activa=false es el borrado lógico del recurso.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la organización (BigInt como string).',
    example: '1',
  })
  @ApiOkResponse({
    description: 'La organización tal como quedó.',
    type: OrganizacionRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description: 'Cuerpo vacío o campos inválidos.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es admin.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Organización inexistente.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'El nombre nuevo ya existe.',
  })
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarOrganizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    return this.organizationsService.actualizar(id, dto, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Desactivar una organización (borrado lógico)',
    description:
      'Solo admin. Pone is_active=false (nunca hay DELETE físico). La reactivación es con PATCH /organizations/:id { activa: true }.',
  })
  @ApiParam({
    name: 'id',
    description: 'Id numérico de la organización (BigInt como string).',
    example: '1',
  })
  @ApiNoContentResponse({ description: 'Organización desactivada.' })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token o sesión expirada.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'El rol del token no es admin.',
  })
  @ApiNotFoundResponse({
    type: ErrorRespuestaDto,
    description: 'Organización inexistente.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.organizationsService.eliminar(id, usuario);
  }
}
