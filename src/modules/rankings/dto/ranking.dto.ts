/**
 * Rankings global y por clase (H4.3 / PRO-281). DTOs de salida sin
 * `@ApiProperty` (el plugin CLI de Swagger los documenta solo, S11) y con
 * los IDs como `string` porque BigInt no se serializa a JSON (AGENTS §7).
 */

/** Una fila del ranking (vistas `global_ranking` / `class_ranking`). */
export class FilaRankingDto {
  /** RANK() de la vista: puede repetirse ante empates de monedas ganadas. */
  posicion!: number;
  estudianteId!: string;
  nombres!: string;
  /** Orden del ranking: gastar (canjear) no las modifica (CA 2). */
  monedasGanadas!: number;
  monedasDisponibles!: number;
}

/** Meta de la paginación estándar { data, meta }. */
export class MetaRankingDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Ranking paginado, ordenado por monedas ganadas descendente. */
export class RankingDto {
  data!: FilaRankingDto[];
  meta!: MetaRankingDto;
}
