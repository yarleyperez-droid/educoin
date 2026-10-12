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
import type { Request, Response } from 'express';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
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
import type {
  SesionRespuestaDto,
  UsuarioRespuestaDto,
} from './dto/sesion-respuesta.dto';

/**
 * Endpoints de sesión bajo /api/v1/auth (AGENTS.md §8: prefijo /api/v1):
 * - POST /login   → 201 con access token; refresh en cookie httpOnly.
 * - POST /refresh → canjea la cookie de refresh por una sesión nueva.
 * - POST /logout  → 204 y expira la cookie de refresh.
 * - GET  /perfil  → requiere JWT; devuelve el usuario autenticado.
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
  @SkipThrottle({ [THROTTLER_REFRESH]: true })
  @UseGuards(AuthThrottlerGuard, AuthGuard('local'))
  @Post('login')
  async iniciarSesion(
    @Body() _credenciales: IniciarSesionDto,
    @UsuarioActual() usuario: UsuarioRespuestaDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<SesionRespuestaDto> {
    return this.armarSesion(await this.authService.login(usuario), respuesta);
  }

  @SkipThrottle({ [THROTTLER_LOGIN]: true })
  @UseGuards(AuthThrottlerGuard)
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

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  cerrarSesion(@Res({ passthrough: true }) respuesta: Response): void {
    respuesta.setHeader(
      'Set-Cookie',
      construirCookieLogout(this.esProduccion()),
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('perfil')
  async obtenerPerfil(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UsuarioRespuestaDto> {
    return this.authService.obtenerPerfil(usuario.id);
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
