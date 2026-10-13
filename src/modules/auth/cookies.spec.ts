import {
  NOMBRE_COOKIE_REFRESH,
  construirCookieLogout,
  construirCookieRefresh,
  expiracionASegundos,
  parsearCookie,
} from './cookies';

describe('cookies (auth)', () => {
  describe('parsearCookie', () => {
    it('devuelve null si no hay encabezado Cookie', () => {
      expect(parsearCookie(undefined, NOMBRE_COOKIE_REFRESH)).toBeNull();
      expect(parsearCookie('', NOMBRE_COOKIE_REFRESH)).toBeNull();
    });

    it('extrae la cookie buscada entre varias', () => {
      const encabezado = `tema=oscur; ${NOMBRE_COOKIE_REFRESH}=abc.def.ghi; idioma=es`;
      expect(parsearCookie(encabezado, NOMBRE_COOKIE_REFRESH)).toBe(
        'abc.def.ghi',
      );
    });

    it('tolera valores con "=" (los JWT base64url no, pero por robustez)', () => {
      expect(
        parsearCookie(`${NOMBRE_COOKIE_REFRESH}=a=b`, NOMBRE_COOKIE_REFRESH),
      ).toBe('a=b');
    });

    it('devuelve null para cookies sin valor o nombres inexistentes', () => {
      expect(
        parsearCookie(`${NOMBRE_COOKIE_REFRESH}=`, NOMBRE_COOKIE_REFRESH),
      ).toBeNull();
      expect(parsearCookie('otra=1', NOMBRE_COOKIE_REFRESH)).toBeNull();
    });
  });

  describe('expiracionASegundos', () => {
    it.each([
      ['30s', 30],
      ['15m', 900],
      ['12h', 43200],
      ['7d', 604800],
    ])('convierte "%s" a %i segundos', (expiracion, esperado) => {
      expect(expiracionASegundos(expiracion)).toBe(esperado);
    });

    it('lanza error con formatos no soportados', () => {
      expect(() => expiracionASegundos('una-semana')).toThrow(Error);
      expect(() => expiracionASegundos('')).toThrow(Error);
    });
  });

  describe('construirCookieRefresh', () => {
    it('genera la cabecera Set-Cookie con los atributos de seguridad', () => {
      const cookie = construirCookieRefresh('token-de-prueba', '7d', false);
      expect(cookie).toContain(`${NOMBRE_COOKIE_REFRESH}=token-de-prueba`);
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=604800');
      expect(cookie).not.toContain('Secure');
    });

    it('añade Secure solo en producción', () => {
      expect(construirCookieRefresh('t', '15m', true)).toContain('Secure');
    });
  });

  describe('construirCookieLogout', () => {
    it('expira la cookie con Max-Age=0', () => {
      const cookie = construirCookieLogout(false);
      expect(cookie).toContain(`${NOMBRE_COOKIE_REFRESH}=`);
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
    });
  });
});
