/**
 * Helper de portapapeles del panel docente (T5.6.1, PRO-385).
 *
 * Extraído de la vista para poder probarlo en node (Vitest corre sin DOM,
 * `vitest.config.mts`) y para que la página no mezcle efectos de interfaz
 * con acceso a APIs del navegador.
 *
 * `navigator.clipboard.writeText` requiere contexto seguro (HTTPS o
 * localhost; el dev server de Next cumple) y puede rechazar la promesa si el
 * permiso del navegador está denegado. Por eso la función **nunca lanza** y
 * devuelve `false` cuando no pudo copiar: la vista entonces muestra el
 * fallback (el código queda en un campo de solo lectura, seleccionable a
 * mano — spec §Supuestos 3).
 */

/**
 * Copía un texto al portapapeles del usuario.
 *
 * @param texto Texto a copiar (p. ej. el código de unión de una clase).
 * @returns `true` si el portapapeles aceptó el texto; `false` si no hay API
 *   de portapapeles disponible o el navegador la rechazó (nunca lanza).
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return false;
    }

    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
