import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Datos para unirse a una clase (POST /api/v1/classes/join): solo el
 * código de unión que el profesor comparte con sus estudiantes. Se
 * normaliza a mayúsculas sin espacios exteriores porque la BD genera
 * códigos de 8 caracteres en mayúsculas (DEFAULT de classes.code) y el
 * tipeo del estudiante puede variar; un valor no string conserva su
 * tipo y cae en el 400 del ValidationPipe global.
 */
export class UnirseClaseDto {
  /** Código de unión de la clase (VARCHAR(12): de 1 a 12 caracteres). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  codigo!: string;
}
