/**
 * Usuarios de prueba del mock de autenticación (T5.4.1).
 *
 * **DATOS DE DESARROLLO MOCK — desaparecen con T5.4.3/H2.1.** Este archivo
 * existe solo para que la vista de login y su capa de auth se puedan
 * desarrollar y probar sin backend. La contraseña vive en texto plano
 * **únicamente porque es un mock de desarrollo**: nunca usar texto plano en
 * producción (AGENTS.md §9.3 — las contraseñas reales se guardan hasheadas
 * con argon2 y solo las emite el backend).
 *
 * Contrato con el backend (para no cazar bugs cuando llegue H2.1):
 * - T5.4.3 (PRO-381) elimina este archivo y reemplaza el interior de
 *   `features/auth/api/auth.ts` por `api.post('auth/login', …)`.
 * - La forma de {@link UsuarioMock} imita la fila de la tabla real `users`
 *   (`db/001_schema.sql`): `id` → `userId` como `string` (es `BIGINT` en la
 *   BD; `string` evita pérdida de precisión de `Number`), `username` y
 *   `email` (`CITEXT`, unicidad insensible a mayúsculas),
 *   `must_change_password` → `mustChangePassword`.
 * - La comparación del mock es insensible a mayúsculas para reflejar `CITEXT`.
 * - **T5.4.2 (PRO-379):** `cambiarContrasena` muta los campos `contrasena` y
 *   `mustChangePassword` de las entradas de {@link USUARIOS_MOCK} **en
 *   memoria** (el array es de solo lectura, pero sus elementos no). Ese estado
 *   vive únicamente en la memoria del proceso (dev server o test) y se pierde
 *   al reiniciar/recargar — límite aceptable del mock hasta T5.4.3, donde el
 *   cambio manda en la BD (plan §7).
 */

import type { Rol } from "@/lib/auth";

/**
 * Usuario de prueba tal como lo consume el mock de autenticación.
 *
 * Espejo de fila de `users` (`db/001_schema.sql`) con la contraseña en claro
 * solo para el mock de desarrollo (ver docstring del archivo).
 */
export interface UsuarioMock {
  /** ID simulado del usuario (`string` aunque en la BD sea `BIGINT`). */
  userId: string;

  /** Nombre de usuario (`username` en la BD, `CITEXT`). */
  username: string;

  /** Correo electrónico (`email` en la BD, `CITEXT`). */
  email: string;

  /** Nombre completo visible. */
  nombre: string;

  /** ID de la organización (`string` aunque en la BD sea `BIGINT`). */
  organizationId: string;

  /** Rol del usuario (`users.role`: `admin` | `teacher` | `student`). */
  rol: Rol;

  /**
   * Contraseña **en texto plano SOLO porque es mock de desarrollo**.
   *
   * DATOS DE DESARROLLO MOCK — desaparece con T5.4.3/H2.1; nunca usar texto
   * plano en producción (AGENTS.md §9.3).
   */
  contrasena: string;

  /**
   * Simula `users.must_change_password` de `db/001_schema.sql`.
   *
   * `true` para el estudiante demo, de modo que T5.4.2 (PRO-379) pueda
   * ejercitar el bloqueo del panel hasta el cambio de contraseña inicial.
   */
  mustChangePassword: boolean;
}

/**
 * Usuarios demo disponibles en el mock de login.
 *
 * Exportado para que los tests (`features/auth/api/auth.test.ts`) puedan
 * inspeccionar los datos de referencia sin duplicarlos.
 *
 * Los tres comparten la contraseña de desarrollo `Password123!` (SOLO mock;
 * ver docstring del archivo) y la organización `"10"`.
 *
 * El array es de solo lectura, pero sus elementos se **mutan en memoria**:
 * T5.4.2 actualiza `contrasena` y `mustChangePassword` al cambiar la
 * contraseña (el estado no persiste; ver docstring del archivo).
 */
export const USUARIOS_MOCK: readonly UsuarioMock[] = [
  {
    userId: "1",
    username: "profesor.demo",
    email: "profesor.demo@demo.com",
    nombre: "Profesor Demo",
    organizationId: "10",
    rol: "teacher",
    contrasena: "Password123!",
    mustChangePassword: false,
  },
  {
    userId: "2",
    username: "estudiante.demo",
    email: "estudiante.demo@demo.com",
    nombre: "Estudiante Demo",
    organizationId: "10",
    rol: "student",
    contrasena: "Password123!",
    mustChangePassword: true,
  },
  {
    userId: "3",
    username: "admin.demo",
    email: "admin.demo@demo.com",
    nombre: "Admin Demo",
    organizationId: "10",
    rol: "admin",
    contrasena: "Password123!",
    mustChangePassword: false,
  },
];
