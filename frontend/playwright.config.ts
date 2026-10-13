/**
 * Configuración de Playwright para las pruebas E2E del frontend (T5.4.4,
 * PRO-382; actualizada en T5.4.3 / PRO-381 para correr contra la API real).
 *
 * Las pruebas corren contra la app real (`next dev` en `:3001`) **y el
 * backend Nest real** (`pnpm start:dev` en `:3000`, H2.1): el login de las
 * pruebas es un login real contra `POST /api/v1/auth/login` con los
 * usuarios del seed (`db/002_seed.sql`). Requisitos: la BD Docker
 * (`educoin-db`) debe estar corriendo y el `.env` del backend debe apuntar a
 * ella (ver `spec/features/013-t5-4-3-integracion-auth-real/plan.md`).
 *
 * Decisiones de configuración:
 *
 * - **`webServer` array:** Playwright levanta (o reutiliza) ambos servidores
 *   en orden: primero el backend Nest (`pnpm -C .. start:dev`, con cwd en la
 *   raíz para que cargue el `.env` del backend), después el frontend Next.
 *   `reuseExistingServer: true` en ambos reutiliza lo que ya esté corriendo
 *   (caso habitual: `pnpm start:dev` y `pnpm dev` abiertos mientras se
 *   programa) y los apaga solo si él los levantó.
 *
 * - **Puerto 3001:** es el puerto del script `dev` de `frontend/package.json`
 *   (`next dev --port 3001`), el mismo con el que se trabaja día a día. Fijar
 *   el `baseURL` aquí evita que los tests escriban URLs absolutas y permite
 *   usar rutas relativas (`page.goto("/login")`).
 *
 * - **Proyecto único Chromium (headless):** el alcance de T5.4.4 es el flujo
 *   de login/cambio de contraseña, no la matriz de navegadores (ver plan §2).
 *
 * - **Aislamiento:** cada test corre en su propio `BrowserContext` (cookies
 *   limpias); además `login.spec.ts` limpia cookies en `test.beforeEach`
 *   (plan §4).
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
  webServer: [
    {
      // Backend Nest (H2.1): cwd en la raíz para que cargue su `.env`.
      command: "pnpm -C .. start:dev",
      url: "http://localhost:3000/api/v1",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3001",
      // Reutiliza el `pnpm dev` que ya pueda estar corriendo en el 3001.
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
