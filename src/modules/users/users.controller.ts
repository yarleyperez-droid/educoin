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
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
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
import { construirCookieLogout } from '../auth/cookies';
import { UsersService } from './users.service';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import { ListarUsuariosQueryDto } from './dto/listar-usuarios.dto';
import {
  ListadoUsuariosDto,
  PerfilActualizadoRespuestaDto,
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
 * - PATCH  /me   → el usuario edita SU PROPIO perfil (docs/endpoint_perfil_
 *                 me.md): sin @Roles, cualquier rol autenticado; el
 *                 objetivo sale del token (pertenencia estructural) y
 *                 cambiar credenciales cierra TODAS sus sesiones.
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
@ApiTags('Users')
// Todas las rutas de users son protegidas: guards GLOBALES (JWT + roles).
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Roles('admin')
  @ApiOperation({
    summary: 'Crear una cuenta teacher/student',
    description:
      "Solo admin. La contraseña inicial la GENERA el servidor y se devuelve UNA sola vez en la respuesta (viaja en el hash argon2; el usuario nace con debeCambiarContrasena=true y debe cambiarla en su primer inicio). Solo se crean roles 'teacher' y 'student' — la especialidad es exclusiva de teachers.",
  })
  @ApiCreatedResponse({
    description:
      'Cuenta creada: comparte contrasenaInicial con su dueño UNA sola vez.',
    type: UsuarioCreadoRespuestaDto,
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'DTO inválido o especialidad con rol student (la especialidad es solo de profesores).',
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
    description: 'La organización indicada no existe.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'Usuario o correo ya registrados (la BD los exige únicos).',
  })
  @Post()
  crear(
    @Body() dto: CrearUsuarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioCreadoRespuestaDto> {
    return this.usersService.crear(dto, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Listar usuarios',
    description:
      'Solo admin. Listado paginado { data, meta } con filtros opcionales de texto (busca en usuario, correo, nombre y apellido), rol, organización y estado activo.',
  })
  @ApiOkResponse({ description: 'Listado paginado.', type: ListadoUsuariosDto })
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
    @Query() query: ListarUsuariosQueryDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ListadoUsuariosDto> {
    return this.usersService.listar(query, usuario);
  }

  // DECLARADO ANTES de @Patch(':id'): Express casa las rutas en orden de
  // declaración y ':id' capturaría la cadena 'me'. Sin @Roles: cualquier
  // usuario autenticado edita su propio perfil (RolesGuard solo exige
  // autenticación cuando la ruta no declara roles).
  @ApiOperation({
    summary: 'Editar el propio perfil',
    description:
      'El usuario edita SU cuenta: el objetivo sale del token, nunca de la petición. Los campos genéricos (nombre/apellido/especialidad) exigen la contraseña actual; las credenciales (usuario/correo/contrasenaNueva) exigen además correoActual y un access token reciente. Cambiar credenciales cierra TODAS las sesiones del usuario (sesionCerrada=true) y expira la cookie del refresh. rol y organizacionId son rechazados (solo el admin los gestiona).',
  })
  @ApiOkResponse({
    description:
      'Perfil actualizado. Con sesionCerrada=true el cliente debe descartar sus tokens y volver al login.',
    type: PerfilActualizadoRespuestaDto,
    headers: {
      'Set-Cookie': {
        description:
          'Solo cuando cambian credenciales (sesionCerrada=true): expira la cookie httpOnly refresh_token (Max-Age=0).',
      },
    },
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'DTO inválido, cuerpo vacío, correoActual ausente al cambiar credenciales, o especialidad con rol student/admin.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description:
      'Sin access token, expirado, cerrado en el servidor, o token NO reciente al cambiar credenciales.',
  })
  @ApiForbiddenResponse({
    type: ErrorRespuestaDto,
    description: 'La contraseña actual o el correoActual no coinciden.',
  })
  @ApiConflictResponse({
    type: ErrorRespuestaDto,
    description: 'Usuario o correo ya registrados.',
  })
  @Patch('me')
  async actualizarPerfil(
    @Body() dto: ActualizarPerfilDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<PerfilActualizadoRespuestaDto> {
    const resultado = await this.usersService.actualizarPerfil(usuario, dto);
    // Cambio de credenciales → la sesión murió en el servidor: se expira
    // también la cookie del refresh en esta misma respuesta (el cliente
    // además descarta su access token y vuelve al login).
    if (resultado.sesionCerrada) {
      respuesta.setHeader(
        'Set-Cookie',
        construirCookieLogout(this.esProduccion()),
      );
    }
    return resultado;
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Desactivar una cuenta (borrado lógico)',
    description:
      'Solo admin, y solo sobre cuentas teacher/student. Pone is_active=false (nunca hay DELETE físico); responde 204 y es idempotente. La cuenta se reactiva con PATCH /users/:id { activa: true }.',
  })
  @ApiParam({
    name: 'id',
    description:
      'Id numérico de la cuenta teacher/student (BigInt como string).',
    example: '3',
  })
  @ApiNoContentResponse({ description: 'Cuenta desactivada.' })
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
    description:
      'Cuenta inexistente (un admin o un id ajeno reciben el mismo 404 anti-enumeración).',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  eliminar(
    @Param('id') id: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    return this.usersService.eliminar(id, usuario);
  }

  @Roles('admin')
  @ApiOperation({
    summary: 'Activar/desactivar una cuenta',
    description:
      'Solo admin. { activa: true } reactiva la cuenta y { activa: false } la desactiva (mismo borrado lógico que DELETE, pero devolviendo la fila). Hoy es el único campo editable de la cuenta; un cuerpo vacío responde 400.',
  })
  @ApiParam({
    name: 'id',
    description:
      'Id numérico de la cuenta teacher/student (BigInt como string).',
    example: '3',
  })
  @ApiOkResponse({
    description: 'La cuenta tal como quedó.',
    type: UsuarioRespuestaDto,
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
    description: 'Cuenta inexistente (o admin: no son objetivos válidos).',
  })
  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioRespuestaDto> {
    return this.usersService.actualizar(id, dto, usuario);
  }

  private esProduccion(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }
}
