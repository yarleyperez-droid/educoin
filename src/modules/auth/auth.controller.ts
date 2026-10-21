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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsuarioActual } from '../../common/decorators/usuario-actual.decorator';
import { Publico } from '../../common/decorators/publico.decorator';
import { ErrorRespuestaDto } from '../../common/dto/error-respuesta.dto';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { SEGURIDAD_COOKIE_REFRESH } from '../../swagger';
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
import {
  SesionRespuestaDto,
  UsuarioRespuestaDto,
} from './dto/sesion-respuesta.dto';

/**
 * Endpoints de sesión bajo /api/v1/auth (AGENTS.md §8: prefijo /api/v1):
 * - POST /login   → PÚBLICO; 201 con access token; refresh en cookie httpOnly.
 * - POST /refresh → PÚBLICO; canjea la cookie de refresh (se autentica por
 *                   el JWT firmado dentro de la cookie, no por un Bearer).
 * - POST /logout  → PÚBLICO; 204 y expira la cookie; además consume la
 *                   sesión del refresh en el servidor (revocación real).
 * - GET  /perfil  → protegido por los guards GLOBALES (JWT + roles).
 */
@ApiTags('Auth')
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
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'PÚBLICO. Valida las credenciales (nombre de usuario O correo — insensible a mayúsculas — y contraseña) y devuelve el access token. La contraseña inicial la genera el servidor al crear la cuenta; si `debeCambiarContrasena=true`, el usuario debe cambiarla con PATCH /users/me.',
  })
  @ApiCreatedResponse({
    description:
      'Sesión iniciada: access token en el cuerpo y refresh token en la cookie httpOnly.',
    type: SesionRespuestaDto,
    headers: {
      'Set-Cookie': {
        description: `Cookie httpOnly ${NOMBRE_COOKIE_REFRESH}=<jwt> (Path=/api/v1/auth, SameSite=Lax): el refresh token de la sesión.`,
      },
    },
  })
  @ApiBadRequestResponse({
    type: ErrorRespuestaDto,
    description:
      'Cuerpo inválido: usuarioOEmail (3-255 caracteres) o contrasena (8-128) fuera de las reglas.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Credenciales incorrectas o cuenta desactivada.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorRespuestaDto,
    description: 'Rate limit: 5 intentos de login por minuto por IP.',
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
  @ApiOperation({
    summary: 'Refrescar la sesión',
    description:
      'PÚBLICO. Canjea la cookie httpOnly `refresh_token` (no un Bearer) por una sesión nueva: access token renovado y refresh token rotado en la misma cookie. La sesión se valida contra el servidor (jti): una cookie revocada por logout o por cambio de credenciales responde 401.',
  })
  @ApiSecurity(SEGURIDAD_COOKIE_REFRESH)
  @ApiCreatedResponse({
    description:
      'Sesión refrescada: nuevo access token y cookie de refresco rotada.',
    type: SesionRespuestaDto,
    headers: {
      'Set-Cookie': {
        description: `Nueva cookie httpOnly ${NOMBRE_COOKIE_REFRESH} (rotación del refresh token).`,
      },
    },
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin cookie de refresco, expirada o revocada en el servidor.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorRespuestaDto,
    description: 'Rate limit: 5 refrescos por minuto por IP.',
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
  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'PÚBLICO e idempotente. Revoca la sesión del refresh EN EL SERVIDOR (consume el jti de la cookie) y expira la cookie en el navegador. Sin cookie válida no hay nada que revocar y responde 204 igual.',
  })
  @ApiNoContentResponse({
    description: 'Sesión cerrada (o no había sesión activa).',
    headers: {
      'Set-Cookie': {
        description: 'Expira la cookie httpOnly refresh_token (Max-Age=0).',
      },
    },
  })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cerrarSesion(
    @Req() request: Request,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    // El logout también mata la sesión EN EL SERVIDOR: consume el jti del
    // refresh de la cookie (revocación real, no solo expirar la cookie en
    // el navegador). Un token inválido/expirado no lanza: sin cookie
    // válida no hay nada que revocar (docs/endpoint_perfil_me.md).
    const refreshToken = parsearCookie(
      request.headers.cookie,
      NOMBRE_COOKIE_REFRESH,
    );
    if (refreshToken !== null) {
      await this.authService.cerrarSesion(refreshToken);
    }
    respuesta.setHeader(
      'Set-Cookie',
      construirCookieLogout(this.esProduccion()),
    );
  }

  // Protegido automáticamente por los guards globales (APP_GUARD) registrados
  // en AuthModule: JWT con caducidad + RolesGuard.
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Perfil del usuario autenticado',
    description:
      'Datos de la cuenta dueña del access token. Sirve para hidratar la sesión del frontend tras el login; `debeCambiarContrasena=true` exige el cambio de contraseña inicial (PATCH /users/me).',
  })
  @ApiOkResponse({
    description: 'Datos del usuario autenticado.',
    type: UsuarioRespuestaDto,
  })
  @ApiUnauthorizedResponse({
    type: ErrorRespuestaDto,
    description: 'Sin access token, expirado o sesión cerrada en el servidor.',
  })
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
