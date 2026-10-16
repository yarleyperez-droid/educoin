/**
 * Lógica pura del canje (H4.4 / PRO-282, T4.4.1).
 *
 * Separada del service para poder probarla sin BD: decide si un canje es
 * posible (costo vs saldo vs stock vs estado del ítem) y traduce esa
 * decisión a mensajes claros en español. Las reglas FUERTES (congelado del
 * costo, descuento de stock, gasto de monedas, reversión) viven en los
 * triggers de la BD (`db/001_schema.sql` §12.6–12.8); esto es solo la capa
 * de UX previa y el mapeo a DTO.
 *
 * @packageDocumentation
 */

import type { redemption_status } from '../../generated/prisma/client';
import type { CanjeRespuestaDto } from './dto/canje-respuesta.dto';

/** Motivo por el que un canje no puede ejecutarse aún. */
export type MotivoBloqueo =
  | 'item-no-disponible'
  | 'sin-stock'
  | 'saldo-insuficiente';

/** Datos de entrada para evaluar si un canje es posible. */
export interface EntradaEvaluacion {
  /** Costo del ítem en monedas (`cost_coins`). */
  costoMonedas: number;
  /** Saldo disponible del estudiante en la clase (`coins_available`). */
  monedasDisponibles: number;
  /** Stock del ítem; `null` = ilimitado. */
  stock: number | null;
  /** `true` si el ítem está `active`. */
  disponible: boolean;
}

/** Resultado de la evaluación (unión discriminada para que TS sepa que `puedeCanjear: false` implica motivo). */
export type EvaluacionCanje =
  | { puedeCanjear: true; motivo: null }
  | { puedeCanjear: false; motivo: MotivoBloqueo };

/**
 * Decide si un canje es ejecutable con los datos actuales.
 *
 * Orden de los bloqueos (el primero que aplica manda): ítem inactivo →
 * stock agotado → saldo insuficiente. Stock `null` significa ilimitado y
 * nunca bloquea.
 *
 * @param entrada Costo, saldo, stock y disponibilidad del ítem.
 * @returns Si puede canjear y el motivo del bloqueo (si lo hay).
 */
export function evaluarCanje(entrada: EntradaEvaluacion): EvaluacionCanje {
  if (!entrada.disponible) {
    return { puedeCanjear: false, motivo: 'item-no-disponible' };
  }
  if (entrada.stock !== null && entrada.stock <= 0) {
    return { puedeCanjear: false, motivo: 'sin-stock' };
  }
  if (entrada.monedasDisponibles < entrada.costoMonedas) {
    return { puedeCanjear: false, motivo: 'saldo-insuficiente' };
  }
  return { puedeCanjear: true, motivo: null };
}

/**
 * Traduce un bloqueo a un mensaje legible para la persona estudiante.
 *
 * @param motivo Bloqueo detectado por `evaluarCanje`.
 * @param costoMonedas Costo del ítem (para el mensaje de saldo).
 * @param monedasDisponibles Saldo actual (para el mensaje de saldo).
 * @returns Mensaje en español.
 */
export function mensajeDeMotivo(
  motivo: MotivoBloqueo,
  costoMonedas: number,
  monedasDisponibles: number,
): string {
  switch (motivo) {
    case 'item-no-disponible':
      return 'El ítem no está disponible.';
    case 'sin-stock':
      return 'El ítem se quedó sin stock.';
    case 'saldo-insuficiente':
      return `No tienes monedas suficientes: necesitas ${costoMonedas} y tienes ${monedasDisponibles}.`;
  }
}

/**
 * Convierte `grade_points` a texto seguro para la UI.
 *
 * Viene como `string` desde una query cruda (NUMERIC de pg), como `Decimal`
 * de Prisma (objeto con `toString`) o `null` para `fun_activity`. Nunca se
 * usa `String(valor)` a ciegas: así se evita un `[object Object]`.
 *
 * @param valor Valor crudo de `grade_points`.
 * @returns Texto del puntaje o `null`.
 */
export function aTextoPuntos(valor: unknown): string | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor === 'string' || typeof valor === 'number') {
    return String(valor);
  }
  if (typeof valor === 'object' && 'toString' in valor) {
    // Decimal de Prisma: su toString() da el texto del NUMERIC.
    const texto = (valor as { toString(): string }).toString();
    return typeof texto === 'string' ? texto : null;
  }
  return null;
}

/**
 * Fila de `redemptions` en sus formas posibles (crudo de BD o modelo Prisma,
 * donde `id`/`item_id` son `BigInt` y `grade_points` un `Decimal`).
 */
export interface FilaCanje {
  id: bigint | number;
  item_id: bigint | number;
  cost_coins: number;
  grade_points: unknown;
  status: redemption_status;
  redeemed_at: Date | string;
  reversed_at: Date | string | null;
}

/**
 * Mapea una fila de canje al DTO de respuesta.
 *
 * Los IDs viajan como `string` porque `BigInt` no se serializa a JSON
 * (AGENTS.md §7) y las fechas en ISO; `grade_points` se documenta como
 * texto para no exponer el `Decimal` de Prisma.
 *
 * @param fila Canje (modelo Prisma o fila cruda).
 * @param nombreItem Nombre del ítem canjeado (se lee aparte: el modelo no trae la relación).
 * @returns DTO listo para responder.
 */
export function aCanjeRespuesta(
  fila: FilaCanje,
  nombreItem: string,
): CanjeRespuestaDto {
  return {
    id: String(fila.id),
    itemId: String(fila.item_id),
    nombreItem,
    costoMonedas: Number(fila.cost_coins),
    puntosNota: aTextoPuntos(fila.grade_points),
    estado: fila.status,
    canjeadoEn: new Date(fila.redeemed_at).toISOString(),
    reversadoEn:
      fila.reversed_at === null ? null : new Date(fila.reversed_at).toISOString(),
  };
}
