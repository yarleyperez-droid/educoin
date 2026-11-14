/**
 * Lógica pura de los rankings (H4.3 / PRO-281, T4.3.1).
 *
 * `aFilaRanking` mapea una fila cruda de las vistas `global_ranking` /
 * `class_ranking` al DTO. El driver puede devolver los BIGINT/NUMERIC
 * como `bigint`, `number` o `string`, así que todo se normaliza con
 * `String()`/`Number()` en lugar de asumir un tipo (mismo criterio que
 * `wallet/billetera.util.ts`).
 *
 * @packageDocumentation
 */

import type { FilaRankingDto } from './dto/ranking.dto';

/** Fila cruda de las vistas `global_ranking` / `class_ranking`. */
export interface FilaRanking {
  position: bigint | number | string;
  student_id: bigint | number | string;
  first_name: string;
  last_name: string;
  coins_earned: bigint | number | string;
  coins_available: bigint | number | string;
}

/**
 * Mapea una fila cruda de las vistas al DTO del ranking.
 *
 * @param fila Fila de `global_ranking` o `class_ranking`.
 * @returns DTO serializado (ids string, montos number).
 */
export function aFilaRanking(fila: FilaRanking): FilaRankingDto {
  return {
    posicion: Number(fila.position),
    estudianteId: String(fila.student_id),
    nombres: `${fila.first_name} ${fila.last_name}`.trim(),
    monedasGanadas: Number(fila.coins_earned),
    monedasDisponibles: Number(fila.coins_available),
  };
}
