import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import type { UsuarioRespuestaDto } from '../dto/sesion-respuesta.dto';

/**
 * Estrategia passport-local para POST /api/v1/auth/login. Los nombres de los
 * campos coinciden con IniciarSesionDto; la validación de credenciales y el
 * error 401 genérico los resuelve AuthService.validarUsuario.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'usuarioOEmail', passwordField: 'contrasena' });
  }

  async validate(
    usuarioOEmail: string,
    contrasena: string,
  ): Promise<UsuarioRespuestaDto> {
    return this.authService.validarUsuario(usuarioOEmail, contrasena);
  }
}
