import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { Publico } from '../../common/decorators/publico.decorator';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { AuthService, type SesionInterna } from './auth.service';
import {
  NOMBRE_COOKIE_REFRESH,
  construirCookieLogout,
  construirCookieRefresh,
  parsearCookie,
} from './cookies';
import {
  AuthThrottlerGuard,
  THROTTLER_LOGIN,
  THROTTLER_REFRESH,
} from './guards/auth-throttler.guard';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto';
import { CambiarContrasenaDto } from './dto/cambiar-contrasena.dto';
import {
  SesionRespuestaDto,
  UsuarioRespuestaDto,
} from './dto/sesion-respuesta.dto';

/**
 * Endpoints de sesión bajo /api/v1/auth (AGENTS.md §8: prefijo /api/v1):
 * - POST /login   → PÚBLICO; 201 con access token; refresh en cookie httpOnly.
 * - POST /refresh → PÚBLICO; canjea la cookie de refresh (se autentica por
 *                   el JWT firmado dentro de la cookie, no por un Bearer).
 * - POST /logout  → PÚBLICO; 204 y expira la cookie (debe funcionar incluso
 *                   con el access token vencido para poder cerrar sesión).
 * - GET  /perfil  → protegido por los guards GLOBALES (JWT + roles).
 *
 * Documentación OpenAPI (H1.3 / PRO-267): login/refresh/logout son públicos
 * (sin bearer en la spec); /perfil declara el security bearer y el 401. Las
 * respuestas de sesión se documentan con `SesionRespuestaDto`.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // El throttler va PRIMERO: las peticiones bloqueadas por rate limit ni
  // llegan a argon2 ni a la BD. @SkipThrottle evita que el contador de
  // 'refresh' aplique también a esta ruta (throttler nombrado independiente).
  @Publico()
  @SkipThrottle({ [THROTTLER_REFRESH]: true })
  @UseGuards(AuthThrottlerGuard, AuthGuard('local'))
  @ApiCreatedResponse({
    type: SesionRespuestaDto,
    description:
      'Sesión iniciada: access token en el cuerpo y refresh token en la cookie httpOnly.',
  })
  @ApiBadRequestResponse({
    description: 'Credenciales con formato inválido (400).',
  })
  @ApiUnauthorizedResponse({
    description:
      'Credenciales erróneas o cuenta inactiva (401, mensaje genérico).',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit de login: 5 intentos por minuto por IP (429).',
  })
  @Post('login')
  async iniciarSesion(
    @Body() _credenciales: IniciarSesionDto,
    @UsuarioActual() usuario: UsuarioRespuestaDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<SesionRespuestaDto> {
    return this.armarSesion(await this.authService.login(usuario), respuesta);
  }

  @Publico()
  @SkipThrottle({ [THROTTLER_LOGIN]: true })
  @UseGuards(AuthThrottlerGuard)
  @ApiCreatedResponse({
    type: SesionRespuestaDto,
    description:
      'Nueva sesión: access token nuevo y refresh token rotado en la cookie.',
  })
  @ApiUnauthorizedResponse({
    description: 'Sin cookie refresh, o token inválido/expirado (401).',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit de refresh: 5 intentos por minuto por IP (429).',
  })
  @Post('refresh')
  async refrescarSesion(
    @Req() request: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<SesionRespuestaDto> {
    const refreshToken = parsearCookie(
      request.headers.cookie,
      NOMBRE_COOKIE_REFRESH,
    );
    if (refreshToken === null) {
      throw new UnauthorizedException('No hay sesión activa que refrescar.');
    }
    return this.armarSesion(
      await this.authService.refrescar(refreshToken),
      respuesta,
    );
  }

  @Publico()
  @ApiNoContentResponse({
    description: 'Sesión cerrada y cookie de refresh expirada (204).',
  })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  cerrarSesion(@Res({ passthrough: true }) respuesta: Response): void {
    respuesta.setHeader(
      'Set-Cookie',
      construirCookieLogout(this.esProduccion()),
    );
  }

  // Protegido automáticamente por los guards globales (APP_GUARD) registrados
  // en AuthModule: JWT con caducidad + RolesGuard. Declara el security bearer
  // de la spec (H1.3) porque es el único endpoint de auth que lo exige.
  @ApiBearerAuth()
  @ApiOkResponse({
    type: UsuarioRespuestaDto,
    description: 'Perfil del usuario autenticado (sin password_hash).',
  })
  @ApiUnauthorizedResponse({
    description: 'Sin token, token inválido o expirado (401).',
  })
  @Get('perfil')
  async obtenerPerfil(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioRespuestaDto> {
    return this.authService.obtenerPerfil(usuario.id);
  }

  @Post('cambiar-contrasena')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({
    description: 'Sesión inválida o contraseña actual incorrecta.',
  })
  async cambiarContrasena(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() dto: CambiarContrasenaDto,
  ): Promise<void> {
    await this.authService.cambiarContrasena(
      usuario.id,
      dto.contrasenaActual,
      dto.contrasenaNueva,
    );
  }
  private armarSesion(
    sesion: SesionInterna,
    respuesta: Response,
  ): SesionRespuestaDto {
    respuesta.setHeader(
      'Set-Cookie',
      construirCookieRefresh(
        sesion.refreshToken,
        this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
        this.esProduccion(),
      ),
    );
    return {
      accessToken: sesion.accessToken,
      tipoToken: 'Bearer',
      expiraEn: sesion.expiraEn,
      usuario: sesion.usuario,
    };
  }

  private esProduccion(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }
}
