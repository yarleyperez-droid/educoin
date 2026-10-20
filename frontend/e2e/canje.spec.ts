/**
 * Pruebas E2E de canje del estudiante (T5.7.4 / PRO-393): CA 2 y CA 3 de
 * H5.7 (PRO-288) contra la **API real** — sin mocks ni interceptación de
 * red, igual que `estudiante-cuestionario.spec.ts`.
 *
 * Flujo (un solo test serial, como `panel-profesor.spec.ts`):
 * 1. Login del estudiante del seed (el fixture deja el flag de cambio
 *    obligatorio en FALSE para convivir con el guard H2.2 del backend,
 *    mismo criterio que el fix de fixtures 1454163).
 * 2. Resolver la actividad del seed correctamente → 120 monedas
 *    (`fn_award_coins` al auto-calificar).
 * 3. **CA 2:** en `/student/canje`, canjear el ítem de 100 monedas del
 *    seed → confirmación con costo/saldo/stock → éxito → el saldo se
 *    refresca desde la API en **20** al instante.
 * 4. **CA 3:** intentar el ítem de 50 monedas con solo 20 → la
 *    previsualización del backend marca `puedeCanjear=false` con su
 *    motivo, el botón queda deshabilitado y el saldo permanece en 20.
 *
 * Repetibilidad (fixture con `psql` contra la `DATABASE_URL` del `.env`,
 * mismo patrón que el spec del cuestionario): borra la entrega previa de
 * la actividad 1 y sus movimientos, borra los `redemptions` de la
 * inscripción 1 y sus movimientos de canje (FK `redemption_id`), **resetea
 * los contadores** de la inscripción a 0 (son la fuente del saldo en
 * `student_coins`; los deletes no los rebajan solos) y restaura el stock
 * del ítem divertido del seed. Es fixture de test, no producción.
 *
 * Selectores por accesibilidad sobre los textos reales de las vistas de
 * H5.7 (`/student/canje`, `/student/actividades/1`).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  CONTRASENA_ESTUDIANTE,
  irALogin,
  login,
  limpiarSesion,
  USUARIO_ESTUDIANTE,
} from "./helpers";

/** Id de la actividad publicada del seed (`activities.id = 1`). */
const ID_ACTIVIDAD_SEED = "1";

/** Inscripción de est.perez en la clase de esa actividad (`enrollments.id = 1`). */
const ID_INSCRIPCION_SEED = 1;

/** Nombres reales de los ítems del seed (`db/002_seed.sql`). */
const ITEM_BONO_SEED = "+0.5 on the midterm";
const ITEM_DIVERTIDO_SEED = "Trivia game in class";

/** Costos reales del seed: 100 (bono, sin stock) y 50 (divertido, stock 5). */
const COSTO_BONO = 100;
const COSTO_DIVERTIDO = 50;

/** Recompensa de la actividad del seed (`reward_coins = 120`). */
const RECOMPENSA_ACTIVIDAD = 120;

/** Respuestas correctas del seed (mismas que `estudiante-cuestionario.spec.ts`). */
const OPCION_SEED_PREGUNTA_1 = "Opción 2: 3";
const RESPUESTA_SEED_PREGUNTA_2 = "4";
const ENUNCIADO_PREGUNTA_1 = "What is x in 2x + 4 = 10?";
const ENUNCIADO_PREGUNTA_2 = "the solution of x + 1 = 5 is x =";

/**
 * Lee la `DATABASE_URL` del `.env` de la raíz (misma fuente de verdad que
 * Nest/Prisma) para el fixture vía `psql`.
 *
 * @returns Connection string listo para `psql`.
 */
function leerDatabaseUrl(): string {
  const archivoEnv = join(__dirname, "..", "..", ".env");
  const contenido = readFileSync(archivoEnv, "utf8");
  const linea = contenido
    .split("\n")
    .find((candidata) => candidata.startsWith("DATABASE_URL="));

  if (linea === undefined) {
    throw new Error(`DATABASE_URL no encontrada en ${archivoEnv}.`);
  }

  return linea.slice("DATABASE_URL=".length).trim();
}

/**
 * Resetea el fixture del canje para que cada corrida parta de cero:
 * sin entrega previa, sin canjes, saldo 0 y stock del ítem divertido en 5.
 */
function resetearCanjeDelSeed(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DELETE FROM coin_movements WHERE redemption_id IN (SELECT id FROM redemptions WHERE enrollment_id = ${ID_INSCRIPCION_SEED});`,
      "-c",
      `DELETE FROM redemptions WHERE enrollment_id = ${ID_INSCRIPCION_SEED};`,
      "-c",
      `DELETE FROM coin_movements WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id = ${ID_ACTIVIDAD_SEED} AND enrollment_id = ${ID_INSCRIPCION_SEED});`,
      "-c",
      `DELETE FROM submissions WHERE activity_id = ${ID_ACTIVIDAD_SEED} AND enrollment_id = ${ID_INSCRIPCION_SEED};`,
      "-c",
      `UPDATE enrollments SET coins_earned = 0, coins_spent = 0 WHERE id = ${ID_INSCRIPCION_SEED};`,
      "-c",
      `UPDATE redeemable_items SET stock = 5 WHERE name = '${ITEM_DIVERTIDO_SEED}';`,
      // El guard H2.2 del backend (JwtAuthGuard) bloquea TODA llamada a la
      // API cuando el JWT trae `debeCambiarContrasena: true`, y el mock de
      // `cambiarContrasena` solo reescribe la cookie del navegador — igual
      // que en el fix de fixtures 1454163, la corrida parte con el flag en
      // FALSE para que el login vaya directo al panel y el access token
      // permita la API real.
      "-c",
      `UPDATE users SET must_change_password = FALSE WHERE username = '${USUARIO_ESTUDIANTE}';`,
    ],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  resetearCanjeDelSeed();
});

test.afterAll(() => {
  // Restaura el estado del seed: `login.spec.ts` y
  // `estudiante-cuestionario.spec.ts` dependen de que est.perez tenga
  // `must_change_password = TRUE` (el guard H2.2 de su flujo).
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `UPDATE users SET must_change_password = TRUE WHERE username = '${USUARIO_ESTUDIANTE}';`,
    ],
    { stdio: "pipe" },
  );
});

test.beforeEach(async ({ context }) => {
  await limpiarSesion(context);
});

test("Canje exitoso descuenta al instante y canje sin saldo muestra el error sin tocar el saldo", async ({
  page,
}) => {
  // Login + cambio + actividad + catálogo + previsualización + canje:
  // varias rutas se compilan en frío en `next dev`, así que se amplía el
  // timeout (el del config son 30s), igual que en el spec del cuestionario.
  test.setTimeout(180_000);

  // 1) Login real del estudiante del seed. El fixture deja el flag de
  // cambio obligatorio en FALSE (ver `resetearCanjeDelSeed`): el guard
  // H2.2 del backend rechazaría cualquier llamada real con el JWT en
  // `debeCambiarContrasena: true`, y el mock de cambio solo toca la cookie.
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  await page.waitForURL("**/student");

  // 2) Ganar monedas: resolver la actividad del seed con 2/2 correctas
  // (≥ 80% del umbral → auto-calificación → 120 monedas).
  await page.goto(`/student/actividades/${ID_ACTIVIDAD_SEED}`);
  const pregunta1 = page
    .getByRole("article")
    .filter({ hasText: ENUNCIADO_PREGUNTA_1 });
  const pregunta2 = page
    .getByRole("article")
    .filter({ hasText: ENUNCIADO_PREGUNTA_2 });
  await pregunta1.getByRole("radio", { name: OPCION_SEED_PREGUNTA_1 }).check();
  await pregunta2
    .getByLabel("Tu respuesta", { exact: true })
    .fill(RESPUESTA_SEED_PREGUNTA_2);
  await page.getByRole("button", { name: "Enviar respuestas" }).click();
  await expect(page.getByText("Calificada", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // 3) CA 2: abrir la tienda y verificar el saldo recién ganado.
  await page.goto("/student/canje");
  await expect(page.getByTestId("saldo-canje")).toHaveText(
    String(RECOMPENSA_ACTIVIDAD),
    { timeout: 15_000 },
  );
  const tarjetaBono = page
    .getByRole("listitem")
    .filter({ hasText: ITEM_BONO_SEED });
  await expect(tarjetaBono).toBeVisible();

  // Seleccionar el ítem de 100 monedas: la confirmación congela costo,
  // saldo y stock ANTES de descontar (CA 2).
  await tarjetaBono.getByRole("button", { name: "Canjear" }).click();
  const confirmacion = page.getByRole("region", { name: "Confirmar canje" });
  await expect(confirmacion).toBeVisible();
  await expect(confirmacion).toContainText(`${COSTO_BONO} monedas`);
  await expect(confirmacion).toContainText(
    `${RECOMPENSA_ACTIVIDAD} monedas`,
  );
  await expect(confirmacion.getByRole("button", { name: "Confirmar canje" })).toBeEnabled();

  // Confirmar: el canje es instantáneo (H4.4) y el saldo visible se
  // refresca contra la API con el nuevo valor (el front no recalcula).
  await confirmacion.getByRole("button", { name: "Confirmar canje" }).click();
  await expect(page.getByText("Canje realizado", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("saldo-canje")).toHaveText(
    String(RECOMPENSA_ACTIVIDAD - COSTO_BONO),
  );

  // 4) CA 3: con el saldo restante, el ítem de 50 monedas no es canjeable.
  // La previsualización del backend responde `puedeCanjear=false` con su
  // motivo, el botón queda deshabilitado y el saldo NO cambia.
  const tarjetaDivertida = page
    .getByRole("listitem")
    .filter({ hasText: ITEM_DIVERTIDO_SEED });
  await expect(tarjetaDivertida).toBeVisible();
  await tarjetaDivertida.getByRole("button", { name: "Canjear" }).click();
  await expect(confirmacion).toBeVisible();
  await expect(
    confirmacion.getByRole("button", { name: "Confirmar canje" }),
  ).toBeDisabled();
  await expect(confirmacion.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("saldo-canje")).toHaveText(
    String(RECOMPENSA_ACTIVIDAD - COSTO_BONO),
  );
});
