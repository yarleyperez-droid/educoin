import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Datos para crear una clase. El código de unión NO viaja aquí: lo genera
 * internamente la BD (DEFAULT de classes.code) y jamás se acepta del
 * cliente (AGENTS.md §7). El profesor tampoco se envía: sale del token.
 */
export class CrearClaseDto {
  /** Nombre visible de la clase (la BD exige VARCHAR(150) NOT NULL). */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(150)
  nombre!: string;
}
