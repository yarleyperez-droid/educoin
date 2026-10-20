import { Injectable } from '@nestjs/common';

/**
 * Registro EN MEMORIA de las sesiones activas: `userId → Set<jti>`.
 *
 * Cada token (access y refresh) viaja con un `jti` (JWT ID) único que se
 * genera al firmarlo; aquí queda registrado al emitirse y se consulta en
 * JwtAuthGuard (access) y AuthService.refrescar (refresh). Un token
 * correctamente firmado cuya sesión ya no está registrada responde 401:
 * la sesión fue cerrada por seguridad.
 *
 * Decisiones (docs/endpoint_perfil_me.md):
 * - EN MEMORIA y sin tocar la BD (decisión del equipo): un reinicio del
 *   servidor vacía el registro → TODAS las sesiones existentes quedan
 *   muertas y todos los usuarios vuelven a iniciar sesión, repoblándose
 *   el registro con cada login. Es el cierre de sesión global que se
 *   aceptó como comportamiento diseñado.
 * - El refresh es de USO ÚNICO: refrescar consume el `jti` de la cookie
 *   usada y registra el par nuevo (rotación real, no solo de cliente).
 * - Cambiar credenciales (usuario/correo/contraseña) elimina TODAS las
 *   sesiones del usuario en todos los dispositivos (revocarUsuario).
 * - Las entradas de access tokens caducados quedan huérfanas en el
 *   mapa: son cadenas de texto minúsculas y el token muerto ya no pasa
 *   la verificación de expiración del guard; nunca autorizan nada.
 */
@Injectable()
export class SesionesActivasService {
  private readonly sesiones = new Map<string, Set<string>>();

  /** Registra los jti de los tokens que acaba de emitir un login/refresh. */
  registrar(idUsuario: string, ...jtis: string[]): void {
    let propias = this.sesiones.get(idUsuario);
    if (propias === undefined) {
      propias = new Set<string>();
      this.sesiones.set(idUsuario, propias);
    }
    for (const jti of jtis) {
      propias.add(jti);
    }
  }

  /** ¿Sigue viva la sesión identificada por (idUsuario, jti)? */
  esValida(idUsuario: string, jti: string): boolean {
    return this.sesiones.get(idUsuario)?.has(jti) === true;
  }

  /** Elimina UNA sesión (uso único del refresh en rotación y logout). */
  consumir(idUsuario: string, jti: string): void {
    this.sesiones.get(idUsuario)?.delete(jti);
  }

  /** Elimina TODAS las sesiones del usuario (cambio de credenciales). */
  revocarUsuario(idUsuario: string): void {
    this.sesiones.delete(idUsuario);
  }
}
