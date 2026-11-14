/**
 * Lógica pura de la billetera (H4.2 / PRO-280, T4.2.1–T4.2.2).
 *
 * `verificarPropio` implementa el CA 3 (solo el propio estudiante) y
 * `aMovimientoBilletera` mapea una fila cruda de `coin_movements` al DTO
 * (BigInt → string, fechas ISO, AGENTS.md §7).
 *
 * @packageDocumentation
 */

import { ForbiddenException } from '@nestjs/common';

import type { movement_type } from '../../generated/prisma/client';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import type { MovimientoBilleteraDto } from './dto/saldo-billetera.dto';

/** Mensaje del 403 cuando se pide la billetera ajena. */
export const MENSAJE_SOLO_PROPIO =
  'Solo puedes consultar tu propia billetera.';

/**
 * Rechaza con 403 cualquier intento de consultar la billetera de otro
 * estudiante (CA 3). Sin parámetro, la API ya es "solo el propio": no
 * existe una ruta `:id` que permita apuntar a otra persona.
 *
 * @param studentIdQuery `?studentId=` opcional de la query.
 * @param usuario Usuario autenticado (rol student garantizado por @Roles).
 * @throws ForbiddenException 403 si el id pedido no es el del token.
 */
export function verificarPropio(
  studentIdQuery: string | undefined,
  usuario: UsuarioAutenticado,
): void {
  if (studentIdQuery !== undefined && studentIdQuery !== usuario.id) {
    throw new ForbiddenException(MENSAJE_SOLO_PROPIO);
  }
}

/** Fila cruda del historial (join `coin_movements` + `enrollments` + `classes`). */
export interface FilaMovimiento {
  id: bigint | number;
  type: movement_type;
  quantity: number;
  description: string | null;
  class_id: bigint | number;
  class_name: string;
  created_at: Date | string;
}

/**
 * Mapea una fila cruda al DTO del historial.
 *
 * @param fila Fila del join de movimientos con su clase.
 * @returns DTO serializado (ids string, fecha ISO).
 */
export function aMovimientoBilletera(
  fila: FilaMovimiento,
): MovimientoBilleteraDto {
  return {
    id: String(fila.id),
    tipo: fila.type,
    cantidad: Number(fila.quantity),
    descripcion: fila.description,
    claseId: String(fila.class_id),
    claseNombre: fila.class_name,
    creadoEn: new Date(fila.created_at).toISOString(),
  };
}
