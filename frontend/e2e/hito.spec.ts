/**
 * Pruebas E2E del hito de H5.9 (T5.9.4 / PRO-402, H5.9 / PRO-290): la
 * cadena completa **entrega → calificación del profesor → monedas →
 * canje** contra la **API real** — sin mocks ni interceptación de red.
 *
 * Flujo (un solo test serial, patrón de `canje.spec.ts`):
 * 1. est.perez entrega la actividad 1 del seed POR DEBAJO del umbral del
 *    80% (1/2 = 50%) → queda `submitted` SIN monedas.
 * 2. prof.lopez la revisa desde la cola (T5.9.1 + T5.9.2) y aprueba →
 *    `graded` → `fn_award_coins` acredita 120 monedas exactamente 1 vez
 *    (la anti-recalificación con 409 está cubierta en
 *    `calificacion-monedas.spec.ts`, no se repite aquí).
 * 3. El estudiante abre `/student/canje`: saldo 120 → canjea el ítem de
 *    100 monedas del seed → confirmación con costo/saldo → éxito → el
 *    saldo se refresca desde la API en **20** al instante.
 *
 * Presupuesto de refresh (`POST /auth/refresh`, throttler 5/min por IP):
 * solo 2 recargas con sesión (actividad inicial y tienda final); el
 * flujo del profesor navega por SPA (`next/link`) de punta a punta.
 *
 * Repetibilidad: fixture con `psql` contra la `DATABASE_URL` del `.env`
 * (mismas limpiezas que `calificacion-monedas.spec.ts` + `canje.spec.ts`):
 * sin entregas previas, sin canjes, contadores de la inscripción en 0,
 * stock del ítem divertido en 5, sin la basura `deleted` de corridas
 * anteriores y `must_change_password = FALSE` (guard H2.2).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/** Id de la actividad publicada del seed (`activities.id = 1`). */
const ID_ACTIVIDAD_SEED = "1";

/** Inscripción de est.perez en la clase de esa actividad (`enrollments.id = 1`). */
const ID_INSCRIPCION_SEED = 1;

/** Nombre de la clase del seed (`classes.name`, usada en la navegación SPA). */
const NOMBRE_CLASE_SEED = "Mathematics 10A";

/** Recompensa de la actividad del seed (`reward_coins = 120`). */
const RECOMPENSA_ACTIVIDAD = 120;

/** Ítem de 100 monedas del seed y su costo. */
const ITEM_BONO_SEED = "+0.5 on the midterm";
const COSTO_BONO = 100;

/** Saldo tras el canje: 120 − 100 = 20. */
const SALDO_FINAL_ESPERADO = RECOMPENSA_ACTIVIDAD - COSTO_BONO;

/** Nombre visible del estudiante del seed (fila de la cola del profesor). */
const FILA_ESTUDIANTE = "Juan Pérez";

// Textos reales de la vista del estudiante (`student/actividades/[id]`).
const MENSAJE_ENVIADO = "Respuestas enviadas";
const ETIQUETA_ENVIADA = "Enviada";
const ETIQUETA_CALIFICADA = "Calificada";

// Respuestas del seed: 1 correcta + 1 incorrecta → 50% < umbral 80%.
const ENUNCIADO_PREGUNTA_1 = "What is x in 2x + 4 = 10?";
const ENUNCIADO_PREGUNTA_2 = "the solution of x + 1 = 5 is x =";
const OPCION_SEED_PREGUNTA_1 = "Opción 2: 3";
const RESPUESTA_ERRONEA_PREGUNTA_2 = "999";

/**
 * Lee la `DATABASE_URL` del `.env` de la raíz (misma fuente que Nest/Prisma).
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
 * Fixture del hito: cada corrida parte sin entrega, sin canjes, saldo 0,
 * stock restaurado y sin la basura `deleted` que tapa la actividad seed
 * en el listado paginado del profesor.
 */
function resetearHito(): void {
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
      `DELETE FROM coin_movements WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id IN (SELECT id FROM activities WHERE status = 'deleted'));`,
      "-c",
      `DELETE FROM submissions WHERE activity_id IN (SELECT id FROM activities WHERE status = 'deleted');`,
      "-c",
      `DELETE FROM activities WHERE status = 'deleted';`,
      "-c",
      `DELETE FROM coin_movements WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id = ${ID_ACTIVIDAD_SEED} AND enrollment_id = ${ID_INSCRIPCION_SEED});`,
      "-c",
      `DELETE FROM submissions WHERE activity_id = ${ID_ACTIVIDAD_SEED} AND enrollment_id = ${ID_INSCRIPCION_SEED};`,
      "-c",
      `UPDATE enrollments SET coins_earned = 0, coins_spent = 0 WHERE id = ${ID_INSCRIPCION_SEED};`,
      "-c",
      `UPDATE redeemable_items SET stock = 5 WHERE name = 'Trivia game in class';`,
      "-c",
      `UPDATE users SET must_change_password = FALSE WHERE username IN ('${USUARIO_ESTUDIANTE}', '${USUARIO_PROFESOR}');`,
      // `login.spec.ts` (test de cambio completo) reescribe la contraseña
      // REAL del estudiante en la BD; sin restaurar el hash del seed, todos
      // los logins posteriores de la suite dan 401.
      "-c",
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw' WHERE username = '${USUARIO_ESTUDIANTE}';`,
      "-c",
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$wqUUPXJ83uBaR982L251Vw$I2nvzzgs1gh0vW5hu35rL/yQdD7rFzbLsJfk+wQCeGg' WHERE username = '${USUARIO_PROFESOR}';`,
    ],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  resetearHito();
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

/**
 * Login con reintento si el throttler de login (5/min por IP) devuelve 429:
 * el formulario se queda en `/login` sin navegar, así que se espera a que
 * cierre la ventana y se intenta una vez más.
 *
 * @param page Página de Playwright del test.
 * @param identificador Usuario o correo del seed.
 * @param contrasena Contraseña real del seed.
 * @param destino Espera de URL tras el login (p. ej. el panel del rol).
 */
async function loginConCooldown(
  page: import("@playwright/test").Page,
  identificador: string,
  contrasena: string,
  destino: string,
): Promise<void> {
  await irALogin(page);
  await login(page, identificador, contrasena);
  try {
    await page.waitForURL(destino, { timeout: 10_000 });
  } catch {
    // 429 probable: espera la ventana de 1 min del throttler y reintenta.
    await page.waitForTimeout(62_000);
    await irALogin(page);
    await login(page, identificador, contrasena);
    await page.waitForURL(destino, { timeout: 30_000 });
  }
}

test.beforeEach(async ({ context }) => {
  await limpiarSesion(context);
});

test("Hito: entrega bajo umbral → el profesor aprueba → 120 monedas → canje de 100 → saldo 20", async ({
  page,
  context,
}) => {
  //240s del flujo +65s de cooldown de arranque.
  test.setTimeout(305_000);

  // Cooldown de arranque: `canje.spec.ts` y `estudiante-cuestionario.spec.ts`
  // corren justo antes en la suite y agotan la ventana de refresh (5/min por
  // IP); sin esta espera, la primera carga de la actividad recibe429 y el
  // formulario de preguntas no se renderiza.
  await page.waitForTimeout(62_000);

  // ── 1) est.perez entrega por debajo del umbral → `submitted` sin monedas
  await loginConCooldown(
    page,
    USUARIO_ESTUDIANTE,
    CONTRASENA_ESTUDIANTE,
    "**/student",
  );

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
    .fill(RESPUESTA_ERRONEA_PREGUNTA_2);
  await page.getByRole("button", { name: "Enviar respuestas" }).click();
  await expect(page.getByText(MENSAJE_ENVIADO)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(ETIQUETA_ENVIADA, { exact: true })).toBeVisible();

  // ── 2) prof.lopez aprueba desde la cola (todo por SPA, sin recargas)
  await limpiarSesion(context);
  await loginConCooldown(
    page,
    USUARIO_PROFESOR,
    CONTRASENA_PROFESOR,
    "**/teacher",
  );

  await page.getByRole("link", { name: "Mis clases" }).click();
  await page
    .getByRole("searchbox", { name: "Buscar clase" })
    .fill("Mathematics");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("link", { name: NOMBRE_CLASE_SEED }).click();
  await page.getByRole("link", { name: "Ver entregas" }).click();
  await page.waitForURL(/\/entregas$/);

  await page.getByLabel("Estado", { exact: true }).selectOption("submitted");
  const fila = page.getByRole("cell", { name: FILA_ESTUDIANTE });
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await fila.getByRole("link").click();
  await page.waitForURL(/\/entregas\/[^/]+$/);

  // Aprobación con puntaje mínimo válido (0..10 del seed).
  await page.getByLabel(/Puntaje/).fill("6");
  await page.getByRole("button", { name: "Aprobar (graded)" }).click();
  await expect(
    page.getByText(ETIQUETA_CALIFICADA, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // ── 3) est.perez: 120 monedas visibles y canje del ítem de 100 → 20
  await limpiarSesion(context);
  await loginConCooldown(
    page,
    USUARIO_ESTUDIANTE,
    CONTRASENA_ESTUDIANTE,
    "**/student",
  );

  await page.goto("/student/canje");
  await expect(page.getByTestId("saldo-canje")).toHaveText(
    String(RECOMPENSA_ACTIVIDAD),
    { timeout: 15_000 },
  );

  const tarjetaBono = page
    .getByRole("listitem")
    .filter({ hasText: ITEM_BONO_SEED });
  await expect(tarjetaBono).toBeVisible();
  await tarjetaBono.getByRole("button", { name: "Canjear" }).click();

  const confirmacion = page.getByRole("region", { name: "Confirmar canje" });
  await expect(confirmacion).toBeVisible();
  await expect(confirmacion).toContainText(`${COSTO_BONO} monedas`);
  await expect(
    confirmacion.getByRole("button", { name: "Confirmar canje" }),
  ).toBeEnabled();
  await confirmacion.getByRole("button", { name: "Confirmar canje" }).click();

  await expect(page.getByText("Canje realizado", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("saldo-canje")).toHaveText(
    String(SALDO_FINAL_ESPERADO),
  );

  // Cooldown final: `login.spec.ts` (siguiente en la suite) encadena varios
  // logins contra el throttler de5/min por IP; esperar a que cierre la
  // ventana evita el429 (los hooks afterAll no aceptan timeout aquí).
  await page.waitForTimeout(62_000);
});
