/**
 * Fachada de unión a clase por código (H3.2 → T5.7.3 / PRO-392).
 *
 * Implementa el contrato real de H3.2 (PRO-274), validado contra la spec:
 *
 * - `POST /api/v1/classes/join` con cuerpo `{ codigo: string }` y rol
 *   `student`. El DTO `UnirseClaseDto` normaliza trim+mayúsculas y el
 *   ValidationPipe global corre con `whitelist` + `forbidNonWhitelisted`,
 *   así que cualquier otro nombre de campo (p. ej. `code`) devuelve 400.
 * - 404 código inexistente o clase no activa (respuesta anti-enumeración),
 *   409 ya inscripto, 422 inscripción withdrawn/blocked u organización
 *   distinta.
 */

import { apiPlano } from "@/lib/api-client";

/** Confirmación de `POST /classes/join` (`UnirseClaseRespuestaDto`). */
export interface UnionAClase {
  mensaje: string;
  clase: { id: string; nombre: string };
  inscripcion: { estado: string; inscritoEn: string };
}

/**
 * Intenta unir al estudiante a una clase con el código de unión.
 *
 * @param codigo Código autogenerado de la clase (`classes.code`).
 * @returns La confirmación del backend (mensaje, clase e inscripción).
 * @throws {ApiError} Con el mensaje del backend (404/409/422/400).
 */
export async function unirseAClase(codigo: string): Promise<UnionAClase> {
  return apiPlano.post<UnionAClase>("classes/join", { codigo });
}
