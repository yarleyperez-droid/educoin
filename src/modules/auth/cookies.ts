export const NOMBRE_COOKIE_REFRESH = 'refresh_token';
const RUTA_COOKIE = '/api/v1/auth';

/**
 * Extrae el valor de una cookie del encabezado Cookie de la petición,
 * sin depender de cookie-parser (evita una dependencia extra).
 */
export function parsearCookie(
  encabezadoCookie: string | undefined,
  nombre: string,
): string | null {
  if (typeof encabezadoCookie !== 'string' || encabezadoCookie === '') {
    return null;
  }
  for (const parte of encabezadoCookie.split(';')) {
    const [clave, ...valores] = parte.trim().split('=');
    if (clave === nombre) {
      const valor = valores.join('=');
      return valor.length > 0 ? valor : null;
    }
  }
  return null;
}

/**
 * Convierte una expiración tipo JWT ("15m", "7d", "12h", "90s") a segundos,
 * para el atributo Max-Age de la cookie de refresh.
 */
export function expiracionASegundos(expiracion: string): number {
  const coincidencia = /^(\d+)\s*([smhd])$/i.exec(expiracion.trim());
  if (coincidencia === null) {
    throw new Error(`Formato de expiración no soportado: "${expiracion}".`);
  }
  const cantidad = Number(coincidencia[1]);
  const unidad = coincidencia[2].toLowerCase() as 's' | 'm' | 'h' | 'd';
  const factores: Record<'s' | 'm' | 'h' | 'd', number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return cantidad * factores[unidad];
}

/**
 * Cabecera Set-Cookie para el refresh token: httpOnly + SameSite=Lax, con
 * Path limitado a /api/v1/auth. Secure solo en producción porque en
 * desarrollo el frontend corre sobre http://localhost.
 */
export function construirCookieRefresh(
  token: string,
  expiracion: string,
  esProduccion: boolean,
): string {
  const atributos = [
    `${NOMBRE_COOKIE_REFRESH}=${token}`,
    `Path=${RUTA_COOKIE}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${expiracionASegundos(expiracion)}`,
  ];
  if (esProduccion) {
    atributos.push('Secure');
  }
  return atributos.join('; ');
}

/** Cabecera Set-Cookie que expira/borra la cookie de refresh. */
export function construirCookieLogout(esProduccion: boolean): string {
  const atributos = [
    `${NOMBRE_COOKIE_REFRESH}=`,
    `Path=${RUTA_COOKIE}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (esProduccion) {
    atributos.push('Secure');
  }
  return atributos.join('; ');
}
