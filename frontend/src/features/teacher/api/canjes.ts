/**
 * Fachada de canjes del profesor (cola revisable H7.4 / T7.2.3-T7.2.4).
 *
 * Punto único entre la cola de canjes del panel docente y el transporte
 * (`@/lib/api-client`). Habla con la API real de H7.2
 * (`src/modules/redemptions/redemptions.controller.ts`), verificada antes
 * de escribir esta fachada (AGENTS.md §10.2):
 *
 * - `GET /api/v1/redemptions/pending?page&limit` (`@Roles('teacher')`) →
 *   cola FIFO de los canjes `pending` de SUS clases con la envoltura
 *   `{ data, meta }` (`ListadoCanjesDto`): `api.get`.
 * - `POST /api/v1/redemptions/:id/approve|reject|deliver` →
 *   `ResolucionCanjeDto` **en plano** (200): `apiPlano.post`. Códigos del
 *   contrato: `403` "No tienes permiso para resolver este canje",
 *   `404` inexistente/ajeno, `409` "El canje ya fue resuelto".
 *
 * Los tipos compartidos (`CanjeListado`, `Meta`, `ResolucionCanje`…) viven
 * en `@/features/billetera/contrato/canje` — el contrato de canje es uno
 * solo para estudiante y profesor, espejo de
 * `src/modules/redemptions/dto/canje-respuesta.dto.ts`.
 *
 * El profesor **solo** resuelve (aprobar/rechazar/entregar): las monedas,
 * el stock y los movimientos los escriben los triggers de la BD en la
 * misma transacción. Los errores (`ApiError` de H5.1) salen con el
 * `message` en español del backend (403/404/409 incluidos).
 */

import { api, apiPlano } from "@/lib/api-client";

import type {
  CanjeListado,
  ListadoCanjes,
  ResolucionCanje,
} from "@/features/billetera/contrato/canje";

/** Acciones de resolución del profesor sobre un canje. */
type AccionResolucion = "approve" | "reject" | "deliver";

/**
 * Lista una página de la cola de pendientes del profesor
 * (`GET /redemptions/pending`, `{ data, meta }`, T7.2.4).
 *
 * @param page Página solicitada (≥ 1).
 * @param limit Tamaño de página (1–100; por defecto 20 en el backend).
 * @returns Los canjes `pending` de sus clases, ordenados por solicitud.
 * @throws {ApiError} Si la API falla o responde 401/403/500.
 */
export async function listarPendientes(
  page: number,
  limit: number,
): Promise<ListadoCanjes> {
  const respuesta = await api.get<CanjeListado[]>(
    `redemptions/pending?page=${page}&limit=${limit}`,
  );

  return {
    data: respuesta.data,
    meta: respuesta.meta ?? { total: respuesta.data.length, page, limit },
  };
}

/**
 * Resuelve un canje con la acción dada (`POST /redemptions/:id/:accion`).
 *
 * Comparte el transporte de las tres resoluciones (aprobar, rechazar,
 * entregar): el backend responde `200` con `ResolucionCanjeDto` en plano y
 * **sin cuerpo de entrada**. El `409` ("El canje ya fue resuelto") se
 * propaga como `ApiError` con el mensaje del backend: la vista lo muestra
 * y recarga la cola.
 *
 * @param id Id del canje a resolver.
 * @param accion `approve` (pending → approved), `reject` (pending →
 *   rejected, con devolución de monedas/stock) o `deliver` (approved →
 *   delivered).
 * @returns El canje tal como queda tras la transición.
 * @throws {ApiError} 403 sin permiso, 404 inexistente/ajeno, 409 ya
 *   resuelto; los mensajes del backend se propagan tal cual.
 */
async function resolverCanje(
  id: string,
  accion: AccionResolucion,
): Promise<ResolucionCanje> {
  return apiPlano.post<ResolucionCanje>(
    `redemptions/${encodeURIComponent(id)}/${accion}`,
    {},
  );
}

/**
 * Aprueba un canje `pending` (`POST /redemptions/:id/approve`).
 *
 * @param id Id del canje.
 * @returns El canje `approved` con su `resueltoEn`.
 * @throws {ApiError} 403/404/409 del backend con su mensaje en español.
 */
export async function aprobarCanje(id: string): Promise<ResolucionCanje> {
  return resolverCanje(id, "approve");
}

/**
 * Rechaza un canje `pending` (`POST /redemptions/:id/reject`): el trigger
 * de la BD devuelve las monedas y el stock en la misma transacción.
 *
 * @param id Id del canje.
 * @returns El canje `rejected` con su `resueltoEn`.
 * @throws {ApiError} 403/404/409 del backend con su mensaje en español.
 */
export async function rechazarCanje(id: string): Promise<ResolucionCanje> {
  return resolverCanje(id, "reject");
}

/**
 * Marca un canje `approved` como entregado (`POST /redemptions/:id/deliver`).
 *
 * @param id Id del canje (debe estar `approved`).
 * @returns El canje `delivered`.
 * @throws {ApiError} 403/404/409 del backend con su mensaje en español.
 */
export async function entregarCanje(id: string): Promise<ResolucionCanje> {
  return resolverCanje(id, "deliver");
}
