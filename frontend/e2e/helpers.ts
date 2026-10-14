/**
 * Helpers compartidos de las pruebas E2E (T5.4.4, PRO-382; actualizados en
 * T5.4.3 / PRO-381 para usar la API real).
 *
 * Centralizan las **credenciales reales del seed** (`db/002_seed.sql`, ya
 * pobladas en la BD Docker) y los pasos repetidos de navegación/login, para
 * que los flujos solo tengan que tocar **un solo lugar** si las
 * credenciales cambian.
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
 * Usuario profesor del seed (id 2).
 *
 * Su sesión real trae `debeCambiarContrasena: false`
 * (`must_change_password = FALSE` en la BD), así que el login redirige
 * directo al panel `/teacher`.
 */
export const USUARIO_PROFESOR = "prof.lopez";

/** Contraseña real del profesor del seed (hash argon2 en la BD). */
export const CONTRASENA_PROFESOR = "Prof123!";

/**
 * Usuario estudiante del seed (id 3).
 *
 * Su sesión real trae `debeCambiarContrasena: true`
 * (`must_change_password = TRUE` en la BD), así que el middleware lo bloquea
 * en `/cambiar-contrasena` hasta completar el cambio obligatorio.
 */
export const USUARIO_ESTUDIANTE = "est.perez";

/** Contraseña real del estudiante del seed (hash argon2 en la BD). */
export const CONTRASENA_ESTUDIANTE = "Estudiante123!";

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
 * @param identificador Usuario o correo (p. ej. `USUARIO_PROFESOR`).
 * @param contrasena Contraseña real del seed (p. ej. `CONTRASENA_PROFESOR`).
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
