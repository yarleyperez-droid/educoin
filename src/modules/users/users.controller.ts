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
import { UsersService } from './users.service';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { ListarUsuariosQueryDto } from './dto/listar-usuarios.dto';
import type {
  ListadoUsuariosDto,
  UsuarioCreadoRespuestaDto,
  UsuarioRespuestaDto,
} from './dto/usuario-respuesta.dto';

/**
 * Endpoints de usuarios bajo /api/v1/users (AGENTS.md §8):
 * - POST   /     → crea una cuenta teacher/student (AGENTS.md §5: solo el
 *                 admin da de alta profesores y estudiantes). La contraseña
 *                 inicial la genera el servidor y se devuelve UNA sola vez;
 *                 el usuario nace con must_change_password TRUE (default de
 *                 la BD) y debe cambiarla en su primer inicio.
 * - GET    /     → listado paginado con filtros de texto, rol, organización
 *                 y estado activo.
 * - DELETE /:id  → borrado LÓGICO: is_active=false; nunca DELETE físico
 *                  (la tabla no tiene deleted_at y ninguna tabla se vacía a
 *                  mano). 204 idempotente; la reactivación solo vía PATCH.
 * - PATCH  /:id  → reactiva/desactiva con { activa } y devuelve la cuenta.
 *
 * La autorización es SOLO de rol: los guards GLOBALES del AuthModule
 * (JwtAuthGuard → RolesGuard) protegen cada ruta y @Roles('admin') la
 * restringe al administrador. No se usa @PerteneceA porque las cuentas
 * no tienen dueño por usuario — son un recurso global del admin, que
 * pasa siempre ese guard (docs/guard_pertenencia.md §4). Los objetivos
 * válidos de DELETE/PATCH son SOLO cuentas teacher/student (espejo del
 * POST): un admin o un inexistente reciben el mismo 404 estándar. La
 * segunda capa vive en el service: re-verifica el rol y que el admin
 * del token siga activo en la BD (AGENTS.md §8).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('admin')
  @Post()
  crear(
    @Body() dto: CrearUsuarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioCreadoRespuestaDto> {
    return this.usersService.crear(dto, usuario);
  }

  @Roles('admin')
  @Get()
  listar(
    @Query() query: ListarUsuariosQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoUsuariosDto> {
    return this.usersService.listar(query, usuario);
  }

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.usersService.eliminar(id, usuario);
  }

  @Roles('admin')
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioRespuestaDto> {
    return this.usersService.actualizar(id, dto, usuario);
  }
}
