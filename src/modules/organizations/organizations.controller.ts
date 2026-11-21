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
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { OrganizationsService } from './organizations.service';
import { CrearOrganizacionDto } from './dto/crear-organizacion.dto';
import { ActualizarOrganizacionDto } from './dto/actualizar-organizacion.dto';
import { ListarOrganizacionesQueryDto } from './dto/listar-organizaciones.dto';
import type {
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
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Roles('admin')
  @Post()
  crear(
    @Body() dto: CrearOrganizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionCreadaRespuestaDto> {
    return this.organizationsService.crear(dto, usuario);
  }

  @Roles('admin')
  @Get()
  listar(
    @Query() query: ListarOrganizacionesQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoOrganizacionesDto> {
    return this.organizationsService.listar(query, usuario);
  }

  @Roles('admin')
  @Get(':id')
  buscarPorId(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    return this.organizationsService.buscarPorId(id, usuario);
  }

  @Roles('admin')
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarOrganizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<OrganizacionRespuestaDto> {
    return this.organizationsService.actualizar(id, dto, usuario);
  }

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.organizationsService.eliminar(id, usuario);
  }
}
