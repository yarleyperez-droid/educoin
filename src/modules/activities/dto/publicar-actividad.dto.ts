import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Publica una actividad (draft → published). El cuerpo es opcional:
 * publicar sin campos publica con la fecha de cierre que la actividad
 * ya tenga (o sin cierre). Si viaja `cierraEn`, se establece/actualiza
 * la fecha de cierre en el mismo UPDATE.
 *
 * El Service setea `published_at` (ningún trigger de la BD lo hace) y
 * valida que la fecha de cierre efectiva sea posterior al momento de
 * publicar — la misma regla que ck_activity_dates (closes_at >
 * published_at) pero con un mensaje amigable antes de que la BD falle.
 */
export class PublicarActividadDto {
  /** Fecha de cierre opcional (closes_at, TIMESTAMPTZ ISO 8601). */
  @IsOptional()
  @IsISO8601()
  cierraEn?: string;
}
