import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CambiarContrasenaDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  contrasenaActual!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  contrasenaNueva!: string;
}
