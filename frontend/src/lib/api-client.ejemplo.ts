import { api } from "./api-client";

/**
 * Ejemplo de consumo tipado del cliente HTTP.
 *
 * Este archivo demuestra que los tipos `ApiEnvelope<T>` y `api.get` se usan
 * correctamente y compilan sin casts. No se importa desde ninguna vista: su
 * único propósito es servir de comprobación estática mientras no existen
 * pantallas que consuman la API.
 */

/** Representación mínima de una clase para el ejemplo de tipado. */
interface ClaseResumen {
  /** Identificador único de la clase. */
  id: string;

  /** Nombre visible de la clase. */
  nombre: string;
}

/**
 * Ejemplo de listado paginado consumido a través del cliente HTTP.
 *
 * @returns Cadena descriptiva con la cantidad de clases y el total paginado.
 * @throws {import("./api-client").ApiError} Si la API responde con error.
 */
export async function ejemploListarClases(): Promise<string> {
  const { data, meta } = await api.get<ClaseResumen[]>("classes");

  const total = meta?.total ?? 0;

  return `Clases cargadas: ${data.length} de ${total}`;
}
