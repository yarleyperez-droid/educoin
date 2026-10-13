/**
 * Pruebas E2E del flujo de login y cambio obligatorio de contraseña (T5.4.4,
 * PRO-382; corren contra la API real desde T5.4.3 / PRO-381).
 *
 * Cubren los 5 escenarios de aceptación de H5.4 contra la app real
 * (`next dev` en el 3001) **y el backend Nest real** (H2.1 en el 3000): el
 * login usa los usuarios del seed (`db/002_seed.sql`) con sus contraseñas
 * reales (hash argon2). Sin interceptación de red (spec §Contrato con el
 * backend, punto 1). Requisito: la BD Docker (`educoin-db`) corriendo.
 *
 * Aislamiento (plan §4): cada test corre en su propio `BrowserContext` y
 * `beforeEach` limpia las cookies (incluida `educoins_sesion`) vía
 * `limpiarSesion`. El escenario 4 hace su propio login: no depende del estado
 * del escenario 2.
 *
 * Nota sobre el escenario 4: el cambio de contraseña sigue resolviéndose con
 * el **mock documentado** de `cambiarContrasena` (H2.2 no existe todavía):
 * el frontend reescribe su cookie con `debeCambiarContrasena: false` y el
 * middleware deja pasar. La BD no cambia, así que el escenario es repetible.
 *
 * Selectores: API de accesibilidad (`getByLabel`/`getByRole`) con `exact`
 * donde los labels se solapan por subcadena (ver `helpers.ts`).
 *
 * Dos peculiaridades de Playwright/Next que estos tests ya tienen en cuenta:
 * - El glob de dos asteriscos y barra seguido de la ruta (p. ej. dos
 *   asteriscos y `/ruta`), pasado a `expect(page).toHaveURL, se resuelve
 *   contra `baseURL` y resulta en `http://localhost:3001/` más ese glob, que
 *   **no** matchea `http://localhost:3001/ruta`. Para asserts de URL se usan
 *   `page.waitForURL` con el glob escrito como cadena de texto (glob puro, sí
 *   funciona) o regex en `toHaveURL` (sin resolución de baseURL).
 * - Next inyecta un route announcer (`#__next-route-announcer__`) que también
 *   tiene `role="alert"`, por lo que `getByRole("alert")` a secas viola el
 *   strict mode; las asserts filtran el alert por su texto.
 */

import { expect, test } from "@playwright/test";

import {
  CONTRASENA_ESTUDIANTE,
  CONTRASENA_PROFESOR,
  irALogin,
  login,
  limpiarSesion,
  USUARIO_ESTUDIANTE,
  USUARIO_PROFESOR,
} from "./helpers";

/**
 * Mensaje real de credenciales inválidas (constante
 * `MENSAJE_CREDENCIALES_INVALIDAS` del backend, H2.1).
 */
const MENSAJE_CREDENCIALES_INVALIDAS =
  "El usuario o la contraseña son erróneos.";

/** Nueva contraseña válida del escenario 4 (≥ 8 caracteres y distinta de la actual). */
const NUEVA_CONTRASENA_DEMO = "NuevaClave2026!";

test.beforeEach(async ({ context }) => {
  // Cada escenario arranca sin cookies de sesión (aislamiento, plan §4).
  await limpiarSesion(context);
});

test("Login válido de profesor redirige al panel /teacher", async ({
  page,
}) => {
  await irALogin(page);
  await login(page, USUARIO_PROFESOR, CONTRASENA_PROFESOR);

  // El login real redirige al panel del rol (rutaPorRol).
  await page.waitForURL("**/teacher");
});

test("Estudiante con cambio obligatorio queda bloqueado en /cambiar-contrasena", async ({
  page,
}) => {
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);

  // debeCambiarContrasena en true (BD), el middleware redirige al cambio.
  await page.waitForURL("**/cambiar-contrasena");

  // Intentar saltar al panel tampoco funciona: vuelve a /cambiar-contrasena.
  await page.goto("/student");
  await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  await expect(
    page.getByRole("button", { name: "Cambiar contraseña" }),
  ).toBeVisible();
});

test("Credenciales inválidas muestran error claro y permanecen en /login", async ({
  page,
}) => {
  await irALogin(page);
  await login(page, "usuario.inventado", "clave-incorrecta");

  // Mensaje real del backend (sin enumerar usuarios) en el área role="alert".
  // Se filtra por texto porque el route announcer de Next también es alert.
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: MENSAJE_CREDENCIALES_INVALIDAS }),
  ).toHaveText(MENSAJE_CREDENCIALES_INVALIDAS);
  await expect(page).toHaveURL(/\/login$/);
});

test("Cambio de contraseña completo desbloquea el panel /student", async ({
  page,
}) => {
  // Este escenario hace su propio login (no depende del escenario 2).
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  await page.waitForURL("**/cambiar-contrasena");

  // Datos válidos: actual real, nueva distinta (≥ 8) y confirmación igual.
  // El cambio lo resuelve el mock documentado de cambiarContrasena (H2.2
  // pendiente): reescribe la cookie con debeCambiarContrasena: false.
  await page
    .getByLabel("Contraseña actual", { exact: true })
    .fill(CONTRASENA_ESTUDIANTE);
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill(NUEVA_CONTRASENA_DEMO);
  await page
    .getByLabel("Confirmar la nueva contraseña", { exact: true })
    .fill(NUEVA_CONTRASENA_DEMO);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();

  // Con el flag ya en false, el middleware deja entrar al panel del rol.
  await page.waitForURL("**/student");
});

test("Campos vacíos muestran validación de cliente sin navegar", async ({
  page,
}) => {
  await irALogin(page);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // Validación de cliente: ni se llama a la capa de auth ni se navega.
  // Se filtra por texto porque el route announcer de Next también es alert.
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "Ingresa tu usuario o correo y tu contraseña para continuar.",
      }),
  ).toHaveText("Ingresa tu usuario o correo y tu contraseña para continuar.");
  await expect(page).toHaveURL(/\/login$/);
});
