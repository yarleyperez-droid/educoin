/**
 * Configuración de Playwright para las pruebas E2E del frontend (T5.4.4,
 * PRO-382).
 *
 * Las pruebas corren contra la app real (`next dev`) usando el mock de auth
 * de T5.4.1/T5.4.2 (sin interceptación de red): ver
 * `spec/features/012-t5-4-4-pruebas-e2e-login/spec.md`.
 *
 * Decisiones de configuración:
 *
 * - **Puerto 3001:** es el puerto del script `dev` de `frontend/package.json`
 *   (`next dev --port 3001`), el mismo con el que se trabaja día a día. Fijar
 *   el `baseURL` aquí evita que los tests escriban URLs absolutas y permite
 *   usar rutas relativas (`page.goto("/login")`).
 *
 * - **`reuseExistingServer: true`:** si el desarrollador ya tiene `pnpm dev`
 *   levantado en el 3001 (caso habitual mientras se programa), Playwright
 *   reutiliza ese servidor en vez de fallar por el puerto ocupado o levantar
 *   un segundo Next duplicado. Si nadie lo está usando, Playwright lo levanta
 *   él solo (`command: "pnpm dev"`) y lo apaga al terminar.
 *
 * - **Proyecto único Chromium (headless):** el alcance de T5.4.4 es el flujo
 *   de login/cambio de contraseña, no la matriz de navegadores (ver plan §2).
 *
 * - **Aislamiento:** cada test corre en su propio `BrowserContext` (cookies y
 *   memoria del mock limpias); además `login.spec.ts` limpia cookies en
 *   `test.beforeEach` (plan §4).
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3001",
  },
  // Proyecto único: Chromium headless (device "Desktop Chrome").
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3001",
    // Reutiliza el `pnpm dev` que ya pueda estar corriendo en el 3001.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
