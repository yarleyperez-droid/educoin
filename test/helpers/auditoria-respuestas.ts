/**
 * Auditoría de filtraciones de secretos (H6.1 / PRO-292 · CA 3).
 *
 * Recorre un cuerpo de respuesta en profundidad y **falla** si aparece
 * alguno de los campos prohibidos, con la ruta exacta del hallazgo.
 * Pensada como prueba reproducible y **reutilizable en H6.3 (T6.3.3)**:
 * futuras suites (p. ej. actividades con `is_correct`/`expected_answer`)
 * solo tienen que invocarla sobre cada respuesta.
 */

/** Campos que nunca deben aparecer en una respuesta HTTP. */
export const CAMPOS_PROHIBIDOS = [
  'password_hash',
  'is_correct',
  'expected_answer',
] as const;

const CAMPOS = new Set<string>(CAMPOS_PROHIBIDOS);

/**
 * Lanza `Error` si `cuerpo` contiene algún campo prohibido (nombres exactos,
 * en cualquier nivel de anidación). No lanza si todo está limpio.
 *
 * @param cuerpo Cuerpo JSON de la respuesta (objeto, array o primitivo).
 * @param contexto Identificador usado en el mensaje de error (p. ej. `'login 200'`).
 */
export function auditarSinSecretos(cuerpo: unknown, contexto: string): void {
  const hallazgos: string[] = [];
  recorrer(cuerpo, '$', hallazgos, new Set<object>());

  if (hallazgos.length > 0) {
    throw new Error(
      `Auditoría de filtraciones falló en "${contexto}": ` +
        `campos prohibidos ${hallazgos.join(', ')}`,
    );
  }
}

function recorrer(
  valor: unknown,
  ruta: string,
  hallazgos: string[],
  vistos: Set<object>,
): void {
  if (valor === null || typeof valor !== 'object') {
    return;
  }
  // Defensa contra referencias cíclicas (JSON puro no las trae, pero el
  // helper no debe colgar si se le pasa un objeto en memoria).
  if (vistos.has(valor)) {
    return;
  }
  vistos.add(valor);

  if (Array.isArray(valor)) {
    valor.forEach((elemento, indice) =>
      recorrer(elemento, `${ruta}[${indice}]`, hallazgos, vistos),
    );
    return;
  }

  for (const [clave, hijo] of Object.entries(
    valor as Record<string, unknown>,
  )) {
    if (CAMPOS.has(clave)) {
      hallazgos.push(`${ruta}.${clave}`);
    }
    recorrer(hijo, `${ruta}.${clave}`, hallazgos, vistos);
  }
}
