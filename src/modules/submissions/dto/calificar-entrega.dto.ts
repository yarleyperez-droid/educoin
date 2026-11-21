import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Decisiones de calificación del profesor sobre una entrega 'submitted':
 * la aprueba (graded) o la rechaza (rejected). El estado JAMÁS viaja
 * suelto: 'decision' es la transición explícita y única que se permite
 * desde la cola de revisión — el enum real submission_status de la BD
 * restringe los demás caminos (in_progress nunca se recalifica, y un
 * 'graded'/'rejected' ya no se toca: el UPDATE atómico filtra por
 * status='submitted', así el trigger fn_award_coins no puede otorgar
 * dos veces las monedas de la misma entrega).
 */
export const DECISIONES_CALIFICACION = ['graded', 'rejected'] as const;

/** Decisiones válidas: subset de submission_status con transición desde submitted. */
export type DecisionCalificacion = (typeof DECISIONES_CALIFICACION)[number];

/**
 * Datos para calificar una entrega
 * (POST /api/v1/activities/:id/submissions/:entregaId/calificar).
 *
 * - `decision='graded'` exige `puntaje` (el Service valida 0..total de
 *   la actividad); el trigger fn_award_coins acredita las monedas y
 *   setea graded_at — el backend jamás los escribe.
 * - `decision='rejected'` PROHÍBE `puntaje` (400 del Service): el
 *   puntaje queda null y el estudiante deberá reenviar cuando exista
 *   ese flujo (docs/flujo_entregas.md §10). Sin monedas: el trigger
 *   solo dispara en → graded.
 * - `feedback` es opcional en ambos: la retroalimentación que el
 *   estudiante verá en su entrega (submissions.feedback, TEXT).
 */
export class CalificarEntregaDto {
  /** Transición a aplicar: 'graded' (aprobar) o 'rejected' (rechazar). */
  @IsIn(DECISIONES_CALIFICACION)
  decision!: DecisionCalificacion;

  /**
   * Puntaje total de la actividad (NUMERIC(6,2), hasta 2 decimales).
   * Obligatorio SOLO con decision='graded' (la condicional la aplica el
   * Service con mensajes claros); con 'rejected' se rechaza.
   */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El puntaje admite hasta 2 decimales.' },
  )
  @Min(0)
  @Max(9999.99)
  puntaje?: number;

  /** Retroalimentación para el estudiante (TEXT; opcional en ambas decisiones). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  feedback?: string;
}
