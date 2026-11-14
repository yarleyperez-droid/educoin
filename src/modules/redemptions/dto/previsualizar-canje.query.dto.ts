import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Query de la previsualización del canje (H4.4 / T4.4.1).
 *
 * Mismas reglas que `CrearCanjeDto`: solo se aceptan ids numéricos, y el
 * saldo/stock/costo los calcula el server.
 */
export class PrevisualizarCanjeQueryDto {
  /** Id del ítem canjeable (BIGINT como string). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'itemId debe ser un identificador numérico.' })
  itemId!: string;
}
