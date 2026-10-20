/**
 * Reglas puras del catálogo de ítems (H4.1 / PRO-279, T4.1.2).
 *
 * Separadas del service para probarlas sin BD (mismo esquema que
 * `evaluarCanje` en `redemptions/canje.util.ts`). La BD tiene CHECKs
 * (`cost_coins > 0`, `stock >= 0`, `grade_bonus` exige `grade_points`),
 * pero una violación de CHECK llegaría como P2004 **sin mapear** en el
 * filtro global → 500; por eso TODA regla de tipo se decide AQUÍ, antes
 * de tocar la BD, y el service la traduce a **422** (CA 1, 2, 4 y
 * T4.1.2).
 *
 * @packageDocumentation
 */

import type { item_type } from '../../generated/prisma/client';
import type { ItemDto } from './dto/item.dto';

/**
 * Fila de `redeemable_items` en sus formas posibles (modelo Prisma, con
 * `id`/`class_id` como `BigInt` y `grade_points` un `Decimal`).
 */
export interface FilaItemCatalogo {
  id: bigint | number;
  class_id: bigint | number;
  name: string;
  description: string | null;
  type: item_type;
  cost_coins: number;
  grade_points: unknown;
  stock: number | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Mapea una fila de `redeemable_items` al DTO de respuesta.
 *
 * IDs como `string` y fechas ISO (AGENTS §7); `grade_points` (Decimal de
 * Prisma o texto crudo) se normaliza a `number | null` con `Number()`,
 * nunca `String()` a ciegas.
 *
 * @param fila Ítem (modelo Prisma o fila cruda).
 * @returns DTO listo para responder.
 */
export function aItemRespuesta(fila: FilaItemCatalogo): ItemDto {
  return {
    id: String(fila.id),
    classId: String(fila.class_id),
    name: fila.name,
    description: fila.description,
    type: fila.type,
    costCoins: Number(fila.cost_coins),
    gradePoints:
      fila.grade_points === null || fila.grade_points === undefined
        ? null
        : Number(fila.grade_points),
    stock: fila.stock === null ? null : Number(fila.stock),
    status: fila.status as ItemDto['status'],
    creadoEn: new Date(fila.created_at).toISOString(),
    actualizadoEn: new Date(fila.updated_at).toISOString(),
  };
}

/** Datos del ítem en su forma ya normalizada (alta pura o alta+merge). */
export interface DatosItem {
  type: item_type;
  /** Entero > 0. */
  costCoins: number;
  /** Puntaje de nota; `null` si no aplica. */
  gradePoints: number | null;
  /** Existencias; `null` si no aplica (ilimitado solo en canje). */
  stock: number | null;
}

/**
 * Resultado de la evaluación (unión discriminada: `valido: false`
 * implica `motivo` presente).
 */
export type EvaluacionItem =
  | { valido: true; motivo: null }
  | { valido: false; motivo: string };

/**
 * Valida las reglas de negocio de un ítem según su tipo.
 *
 * Orden (la primera que aplica manda):
 * 1. Costo: entero > 0 (siempre, cualquier tipo).
 * 2. `fun_activity`: exige `stock` entero ≥ 0 y prohíbe `gradePoints`.
 * 3. `grade_bonus`: exige `gradePoints` > 0 y prohíbe `stock`.
 *
 * @param datos Tipo, costo, puntos y stock ya combinados (merge en PATCH).
 * @returns Si es válido o el motivo de rechazo (→ 422 en español).
 */
export function evaluarItemPorTipo(datos: DatosItem): EvaluacionItem {
  if (!Number.isInteger(datos.costCoins) || datos.costCoins <= 0) {
    return {
      valido: false,
      motivo: 'El costo en monedas debe ser un entero mayor que 0.',
    };
  }

  if (datos.type === 'fun_activity') {
    if (datos.stock === null || datos.stock === undefined) {
      return {
        valido: false,
        motivo: 'La actividad lúdica (fun_activity) requiere un stock.',
      };
    }
    if (!Number.isInteger(datos.stock) || datos.stock < 0) {
      return {
        valido: false,
        motivo: 'El stock de la actividad lúdica no puede ser negativo.',
      };
    }
    if (datos.gradePoints !== null && datos.gradePoints !== undefined) {
      return {
        valido: false,
        motivo: 'La actividad lúdica (fun_activity) no admite grade_points.',
      };
    }
    return { valido: true, motivo: null };
  }

  // grade_bonus
  if (datos.gradePoints === null || datos.gradePoints === undefined) {
    return {
      valido: false,
      motivo: 'El bono de nota (grade_bonus) requiere grade_points.',
    };
  }
  if (!(datos.gradePoints > 0)) {
    return {
      valido: false,
      motivo: 'grade_points debe ser un número mayor que 0.',
    };
  }
  if (datos.stock !== null && datos.stock !== undefined) {
    return {
      valido: false,
      motivo: 'El bono de nota (grade_bonus) no admite stock.',
    };
  }
  return { valido: true, motivo: null };
}
