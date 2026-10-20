/**
 * Fachada de unión a clase por código (H3.2 → T5.7.3 / PRO-392).
 *
 * ## Contrato SUPUESTO de H3.2 (PRO-274, aún NO implementada)
 *
 * Se implementa contra el siguiente contrato, acordado en la planificación
 * de H5.7 y **pendiente de validar** con la spec de H3.2 al integrar:
 *
 * - `POST /api/v1/classes/join` con cuerpo `{ code: string }` y rol
 *   `student`.
 * - Códigos inexistentes / ya inscritos → error con `message` legible.
 *
 * Mientras el endpoint no exista, la API responde `404` (Nest: "Cannot
 * POST /api/v1/classes/join") y aquí se traduce al mensaje amable
 * {@link MENSAJE_UNION_PENDIENTE} para que el dashboard no muestre el 404
 * crudo. Cuando H3.2 aterrice, el único punto de ajuste es este archivo
 * (AGENTS.md §10.11: sin mocks; el contrato futuro está declarado).
 */

import { ApiError, apiPlano } from "@/lib/api-client";

/** Mensaje mostrado mientras `POST /classes/join` no exista (H3.2). */
export const MENSAJE_UNION_PENDIENTE =
  "El servicio de unión a clases aún no está disponible.";

/**
 * Intenta unir al estudiante a una clase con el código de unión.
 *
 * @param codigo Código autogenerado de la clase (`classes.code`).
 * @returns Vacío en éxito (2xx).
 * @throws {ApiError} Con el mensaje del backend, salvo el `404` de H3.2
 *   pendiente, que sale como {@link MENSAJE_UNION_PENDIENTE}.
 */
export async function unirseAClase(codigo: string): Promise<void> {
  try {
    await apiPlano.post<void>("classes/join", { code: codigo });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(MENSAJE_UNION_PENDIENTE, 404, error.detalles);
    }
    throw error;
  }
}
