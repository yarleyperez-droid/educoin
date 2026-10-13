import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Credenciales de inicio de sesión: nombre de usuario O correo electrónico
 * (la BD usa CITEXT, así que la comparación es insensible a mayúsculas)
 * junto con la contraseña en texto plano.
 */
export class IniciarSesionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  usuarioOEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  contrasena!: string;
}
