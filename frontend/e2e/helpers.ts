/**
 * Helpers compartidos de las pruebas E2E (T5.4.4, PRO-382).
 *
 * Centralizan las credenciales del mock de auth (T5.4.1/T5.4.2) y los pasos
 * repetidos de navegación/login, para que flujos como el de T5.4.3 (cambio a
 * usuarios reales del seed) solo tengan que tocar **un solo lugar**.
 *
 * Los selectores usan la API de accesibilidad de Playwright (`getByLabel`,
 * `getByRole`) sobre los labels reales de la UI, no selectores CSS frágiles
 * (plan §3).
 *
 * Nota sobre `exact: true` en `getByLabel`: por defecto Playwright hace
 * matching por subcadena, y "Nueva contraseña" es subcadena del label
 * "Confirmar la nueva contraseña" de `/cambiar-contrasena`; con `exact` se
 * garantiza que cada `fill` apunte a un único campo.
 */

import type { BrowserContext, Page } from "@playwright/test";

/**
 * Usuario profesor del mock (`usuarios-mock.ts`).
 *
 * Su sesión tiene `mustChangePassword: false`, así que el login redirige
 * directo al panel `/teacher`.
 */
export const USUARIO_PROFESOR = "profesor.demo";

/**
 * Usuario estudiante del mock (`usuarios-mock.ts`).
 *
 * Su sesión tiene `mustChangePassword: true`, así que el middleware lo
 * bloquea en `/cambiar-contrasena` hasta completar el cambio obligatorio.
 */
export const USUARIO_ESTUDIANTE = "estudiante.demo";

/**
 * Contraseña de desarrollo compartida por los usuarios mock.
 *
 * SOLO es válida contra el mock de T5.4.1/T5.4.2 (desaparece con T5.4.3 /
 * H2.1); si las credenciales cambian, se actualiza únicamente esta constante.
 */
export const CONTRASENA_DEMO = "Password123!";

/**
 * Abre la página de login (`/login`) y espera a que cargue.
 *
 * @param page Página de Playwright del test.
 */
export async function irALogin(page: Page): Promise<void> {
  await page.goto("/login");
}

/**
 * Completa y envía el formulario de login con las credenciales dadas.
 *
 * Usa los labels accesibles reales de `/login`: "Usuario o correo" y
 * "Contraseña", y el botón "Iniciar sesión". No espera la navegación
 * resultante: cada test decide qué URL le corresponde (panel, cambio
 * obligatorio o permanencia en `/login`).
 *
 * @param page Página de Playwright del test.
 * @param identificador Usuario o correo del mock (p. ej. `USUARIO_PROFESOR`).
 * @param contrasena Contraseña (p. ej. `CONTRASENA_DEMO`).
 */
export async function login(
  page: Page,
  identificador: string,
  contrasena: string,
): Promise<void> {
  await page.getByLabel("Usuario o correo", { exact: true }).fill(identificador);
  await page.getByLabel("Contraseña", { exact: true }).fill(contrasena);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

/**
 * Limpia las cookies del contexto (incluida `educoins_sesion`) para que cada
 * test parta sin sesión (plan §4: aislamiento entre escenarios).
 *
 * @param context Contexto de navegador del test.
 */
export async function limpiarSesion(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}
