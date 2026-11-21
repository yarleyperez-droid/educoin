/**
 * Fachada de canje del estudiante (H4.4 → T5.7.2 / PRO-391, ampliada por
 * el canje revisable de H7.3).
 *
 * Punto único entre `/student/canje` y el transporte. Habla con la API
 * real cuyo contrato fue verificado contra los controllers:
 *
 * - `GET /api/v1/items?classId=` → `ItemDto[]` **en plano** (array sin
 *   envoltura `{ data, meta }`): `apiPlano.get`. Desde T5.7.2 el
 *   estudiante inscrito puede listarlo (solo ítems `active`).
 * - `GET /api/v1/redemptions/preview?itemId=` →
 *   `PrevisualizacionCanjeDto` **en plano**: `apiPlano.get`.
 * - `POST /api/v1/redemptions` `{ itemId }` → `CanjeRespuestaDto` en
 *   plano (201). La BD congela el costo y descuenta el stock: el front
 *   no calcula nada y, tras cualquier resultado, vuelve a pedir el saldo
 *   a la API (H4.4: rollback total garantizado por la BD). Con el canje
 *   revisable la fila nace `pending` (o `approved` si el ítem tiene
 *   auto-aprobación: `aprobacionAutomatica: true`).
 * - `GET /api/v1/redemptions/mine?page&limit` → historial propio con la
 *   envoltura `{ data, meta }` (`ListadoCanjesDto`, T7.2.5): `api.get`.
 *
 * El estudiante **no envía** costo, saldo ni stock: solo el `itemId`.
 * Los errores (`ApiError` de H5.1) salen con el `message` en español del
 * backend (422 de saldo insuficiente/sin stock, 409 de conflicto).
 */

import { api, apiPlano } from "@/lib/api-client";

import type {
  Canje,
  CanjeListado,
  ItemCanje,
  ListadoCanjes,
  PrevisualizacionCanje,
} from "../contrato/canje";

/** `ItemDto` del backend; el contrato de dominio omite campos de gestión. */
interface ItemBackend {
  id: string;
  classId: string;
  /** Nombre de la clase (join del backend, H10.3 / T10.3.1). */
  className: string | null;
  name: string;
  description: string | null;
  type: ItemCanje["type"];
  costCoins: number;
  gradePoints: number | null;
  stock: number | null;
  status: string;
}

/**
 * Traduce un ítem del backend al tipo de dominio de la tienda.
 *
 * @param backend `ItemDto` crudo (el backend ya filtra `deleted`).
 * @returns El ítem con los campos que la vista necesita.
 */
function aItemCanje(backend: ItemBackend): ItemCanje {
  return {
    id: String(backend.id),
    claseId: String(backend.classId),
    claseNombre: backend.className ?? "",
    name: backend.name,
    description: backend.description,
    type: backend.type,
    costCoins: backend.costCoins,
    gradePoints: backend.gradePoints,
    stock: backend.stock,
  };
}

/**
 * Lista los ítems canjeables del estudiante.
 *
 * Sin `classId` el backend devuelve los ítems `active` de todas las
 * clases con inscripción `active` (T5.7.2); vacío si no hay inscripciones.
 *
 * @returns Ítems activos de las clases del estudiante.
 * @throws {ApiError} Si la API falla o responde 401/403/500.
 */
export async function listarItems(): Promise<ItemCanje[]> {
  const items = await apiPlano.get<ItemBackend[]>("items");
  return items.map(aItemCanje);
}

/**
 * Previsualiza un canje ANTES de confirmar (`GET /redemptions/preview`).
 *
 * @param itemId Id del ítem a canjear.
 * @returns Costo, saldo, stock y `puedeCanjear` con su `motivo`.
 * @throws {ApiError} Si el ítem no existe o la API falla.
 */
export async function previsualizarCanje(
  itemId: string,
): Promise<PrevisualizacionCanje> {
  return apiPlano.get<PrevisualizacionCanje>(
    `redemptions/preview?itemId=${encodeURIComponent(itemId)}`,
  );
}

/**
 * Confirma un canje (`POST /redemptions`).
 *
 * Con el canje revisable (H7.2/T7.2.2) el resultado nace `pending`
 * (pendiente de aprobación del profesor) o `approved` cuando el ítem
 * tiene auto-aprobación (`aprobacionAutomatica: true`); el legado
 * instantáneo devolvía `completed`.
 *
 * @param itemId Id del ítem canjeado.
 * @returns El canje registrado con su estado real (`pending`/`approved`).
 * @throws {ApiError} 422 (saldo insuficiente / sin stock / ítem
 *   inactivo), 409 u otros; el mensaje del backend se propaga tal cual.
 */
export async function canjear(itemId: string): Promise<Canje> {
  return apiPlano.post<Canje>("redemptions", { itemId });
}

/**
 * Lista una página del historial de canjes del estudiante
 * (`GET /redemptions/mine`, `{ data, meta }`, T7.2.5).
 *
 * @param page Página solicitada (≥ 1).
 * @param limit Tamaño de página (1–100; por defecto 20 en el backend).
 * @returns Sus canjes ordenados por `solicitadoEn` descendente.
 * @throws {ApiError} Si la API falla o responde 401/403/500.
 */
export async function listarMisCanjes(
  page: number,
  limit: number,
): Promise<ListadoCanjes> {
  const respuesta = await api.get<CanjeListado[]>(
    `redemptions/mine?page=${page}&limit=${limit}`,
  );

  return {
    data: respuesta.data,
    meta: respuesta.meta ?? { total: respuesta.data.length, page, limit },
  };
}
