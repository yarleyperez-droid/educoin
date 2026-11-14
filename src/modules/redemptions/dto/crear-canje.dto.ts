import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Datos para confirmar un canje (H4.4 / T4.4.2).
 *
 * El estudiante no envía costo, saldo ni stock: esos valores los lee y
 * congela la BD (triggers §12.6–12.8). El único dato de entrada es el ítem.
 */
export class CrearCanjeDto {
  /** Id del ítem canjeable (BIGINT como string; BigInt no viaja en JSON). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'itemId debe ser un identificador numérico.' })
  itemId!: string;
}
