import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Query del historial de la billetera (H4.2 / PRO-280, T4.2.2).
 *
 * `studentId` es opcional y SOLO sirve para poder rechazar explícitamente
 * la consulta ajena con 403 (CA 3): sin él, la API siempre devuelve los
 * datos del propio token (no existe ruta `:id`).
 */
export class HistorialBilleteraQueryDto {
  /** Página 1-indexada. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Filas por página (tope 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Id de estudiante a consultar; si difiere del token → 403. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'studentId debe ser un identificador numérico.' })
  studentId?: string;
}
