/**
 * Fachada de billetera del estudiante (H4.2 → T5.7.1 / PRO-390).
 *
 * Punto único entre la vista de `/student/billetera` y el transporte
 * (`@/lib/api-client`). Habla con la **API real de H4.2**
 * (`src/modules/wallet/`), cuyo contrato fue verificado así:
 *
 * - `GET /api/v1/wallet` (`@Roles('student')`) → `SaldoBilleteraDto`
 *   **en plano** (sin envoltura `{ data, meta }`): se usa `apiPlano`.
 * - `GET /api/v1/wallet/movements?page&limit` →
 *   `HistorialBilleteraDto` que **sí** trae `{ data, meta }`: se usa `api`.
 *
 * El saldo sale de la vista `student_coins` (suma global de todas las
 * inscripciones); el desglose por clase vive en `claseNombre` de cada
 * movimiento. Tras un canje o un error, la vista vuelve a llamar a estas
 * funciones: el front **nunca** recalcula el saldo (H4.2 / spec §supuestos).
 *
 * Los errores salen como `ApiError` con `message` en español (H5.1).
 */

import { api, apiPlano } from "@/lib/api-client";

import type {
  HistorialBilletera,
  MovimientoBilletera,
  SaldoBilletera,
} from "../contrato/billetera";

/** `MovimientoBilleteraDto` tal cual sale del backend (ids ya string). */
type MovimientoBilleteraBackend = Omit<MovimientoBilletera, "id" | "claseId"> & {
  id: string | number;
  claseId: string | number;
};

/**
 * Traduce un movimiento del backend al tipo de dominio, normalizando los
 * IDs a `string` (defensa: el backend ya los emite como string, pero el
 * mapeo absorbe cualquier variante numérica sin romper la vista).
 *
 * @param backend Movimiento crudo del DTO de H4.2.
 * @returns El movimiento con ids como `string`.
 */
function aMovimiento(backend: MovimientoBilleteraBackend): MovimientoBilletera {
  return {
    id: String(backend.id),
    tipo: backend.tipo,
    cantidad: backend.cantidad,
    descripcion: backend.descripcion,
    claseId: String(backend.claseId),
    claseNombre: backend.claseNombre,
    creadoEn: backend.creadoEn,
  };
}

/**
 * Obtiene el saldo agregado del estudiante (`GET /wallet`, plano).
 *
 * @returns El saldo con los tres totales de la vista `student_coins`.
 * @throws {ApiError} Si la API falla o responde 401/403/500.
 */
export async function obtenerSaldo(): Promise<SaldoBilletera> {
  return apiPlano.get<SaldoBilletera>("wallet");
}

/**
 * Obtiene una página del historial de movimientos
 * (`GET /wallet/movements`, `{ data, meta }`).
 *
 * @param page Página solicitada (≥ 1).
 * @param limit Tamaño de página (1–100; por defecto 20 en el backend).
 * @returns El historial paginado con el contexto de clase por movimiento.
 * @throws {ApiError} Si la API falla o responde 401/403/500.
 */
export async function obtenerHistorial(
  page: number,
  limit: number,
): Promise<HistorialBilletera> {
  const respuesta = await api.get<MovimientoBilleteraBackend[]>(
    `wallet/movements?page=${page}&limit=${limit}`,
  );

  return {
    data: respuesta.data.map(aMovimiento),
    meta: respuesta.meta ?? { total: respuesta.data.length, page, limit },
  };
}
