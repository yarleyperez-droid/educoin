/**
 * Pruebas E2E de H5.10 — rankings y progreso del estudiante (T5.10.3 /
 * PRO-405): CA 1 (orden por monedas ganadas), CA 2 (progreso coherente
 * con la billetera) y CA 3 (estado vacío) contra la **API real** — sin
 * mocks ni interceptación de red.
 *
 * Flujo (un solo test serial, patrón de `calificacion-monedas.spec.ts`):
 * 1. est.perez abre el panel: los links "Ranking" y "Mi progreso" existen.
 * 2. `/student/ranking` → Global: orden determinista por fixture
 *    (`adjustment` +120 a est.perez y +60 a est.gomez; el trigger
 *    `fn_apply_movement` los refleja en `coins_earned`).
 * 3. Pestaña "Mi clase" (SPA): mismo orden, solo inscriptos de la clase.
 * 4. `/student/progreso`: ganadas=120, gastadas=0, disponibles=120
 *    (misma API H4.2 que la billetera).
 * 5. Se retiran las inscripciones del seed → la pestaña "Mi clase" muestra
 *    el estado vacío de H5.2 ("No estás inscrito en ninguna clase"). El
 *    ranking **global** nunca se vacía para un estudiante: la vista
 *    incluye a todos los de la organización y `ck_users_org` impide que un
 *    student quede sin org (la rama `total === 0` de la vista es
 *    defensiva).
 *
 * Presupuesto de refresh (`POST /auth/refresh`, throttler 5/min por IP):
 *3 recargas con sesión (ranking inicial, progreso, ranking final); la
 * pestaña "Mi clase" navega por SPA.
 *
 * Repetibilidad: el `beforeAll` limpia movimientos/canjes, deja las
 * inscripciones `active`, acredita los ajustes de prueba y restaura las
 * contraseñas del seed; el `afterAll` **restaura el estado base** (las
 * inscripciones se reactivan, nunca se borran — otros specs endurecen
 * `enrollment_id = 1` —, contadores en0, hashes y
 * `must_change_password = TRUE` de est.perez) para no romper
 * `login.spec.ts` ni `estudiante-cuestionario.spec.ts`.
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

/** Nombres del seed (`db/002_seed.sql`): inscriptos en "Mathematics 10A". */
const ESTUDIANTE_LIDER = "Juan Pérez";
const ESTUDIANTE_SEGUNDO = "María Gómez";

/** Ajustes del fixture: determinan el orden del ranking. */
const GANADAS_LIDER = 120;
const GANADAS_SEGUNDO = 60;

// Textos de la vista (`app/student/ranking/page.tsx`).
const TITULO_RANKING = "Ranking";
const ETIQUETA_SIN_CLASES = "No estás inscrito en ninguna clase";

// Textos del panel (`app/student/page.tsx`).
const LINK_RANKING = "Ranking";
const LINK_PROGRESO = "Mi progreso";

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

/** Filtro de usuarios del seed (para la tabla `enrollments`). */
const USUARIOS_SEED =
  "student_id IN (SELECT id FROM users WHERE username IN ('est.perez', 'est.gomez'))";

/** Filtro de las inscripciones del seed (para tablas con `enrollment_id`). */
const INSCRIPCIONES_SEED = `enrollment_id IN (SELECT id FROM enrollments WHERE ${USUARIOS_SEED})`;

/**
 * Fixture de arranque: ranking determinista (120 vs 60) y login limpio.
 *
 * Los ids de inscripción se resuelven por username (nunca se hardcodean);
 * el orden de los `DELETE` respeta las FK (`coin_movements` antes que
 * `submissions`/`redemptions`).
 */
function resetearRankingDelSeed(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DELETE FROM coin_movements WHERE redemption_id IN (SELECT id FROM redemptions WHERE ${INSCRIPCIONES_SEED});`,
      "-c",
      `DELETE FROM redemptions WHERE ${INSCRIPCIONES_SEED};`,
      "-c",
      `DELETE FROM coin_movements WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id = (SELECT id FROM activities WHERE title = 'Challenge 1: Equations' LIMIT 1) AND ${INSCRIPCIONES_SEED});`,
      "-c",
      `DELETE FROM submissions WHERE activity_id = (SELECT id FROM activities WHERE title = 'Challenge 1: Equations' LIMIT 1) AND ${INSCRIPCIONES_SEED};`,
      "-c",
      `DELETE FROM coin_movements WHERE ${INSCRIPCIONES_SEED};`,
      "-c",
      `UPDATE enrollments SET coins_earned = 0, coins_spent = 0, status = 'active' WHERE ${USUARIOS_SEED};`,
      // Orden determinista del ranking (CA 1): el trigger
      // `fn_apply_movement` suma los `adjustment` a `coins_earned`.
      "-c",
      `INSERT INTO coin_movements (enrollment_id, type, quantity, description) SELECT id, 'adjustment', ${GANADAS_LIDER}, 'Fixture E2E ranking' FROM enrollments WHERE student_id = (SELECT id FROM users WHERE username = 'est.perez');`,
      "-c",
      `INSERT INTO coin_movements (enrollment_id, type, quantity, description) SELECT id, 'adjustment', ${GANADAS_SEGUNDO}, 'Fixture E2E ranking' FROM enrollments WHERE student_id = (SELECT id FROM users WHERE username = 'est.gomez');`,
      // Credenciales del seed (alguna corrida de la suite las reescribe).
      "-c",
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw' WHERE username = '${USUARIO_ESTUDIANTE}';`,
      "-c",
      `UPDATE users SET must_change_password = FALSE WHERE username = '${USUARIO_ESTUDIANTE}';`,
    ],
    { stdio: "pipe" },
  );
}

/**
 * Restaura el estado base del seed tras la corrida: inscripciones
 * reactivadas en su lugar (sin DELETE: conserva los ids que otros specs
 * endurecen), contadores en0, sin movimientos de prueba y con el guard
 * H2.2 en su estado sembrado.
 */
function restaurarSeedDeRanking(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DELETE FROM coin_movements WHERE ${INSCRIPCIONES_SEED};`,
      "-c",
      // Nunca se borran las inscripciones: se reactivan en su lugar para
      // conservar los ids del seed (`enrollment_id = 1` está endurecido
      // en otros specs de la suite).
      `UPDATE enrollments SET status = 'active', coins_earned = 0, coins_spent = 0 WHERE ${USUARIOS_SEED};`,
      "-c",
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw' WHERE username = '${USUARIO_ESTUDIANTE}';`,
      "-c",
      `UPDATE users SET must_change_password = TRUE WHERE username = '${USUARIO_ESTUDIANTE}';`,
    ],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  resetearRankingDelSeed();
});

test.afterAll(() => {
  restaurarSeedDeRanking();
});

test.beforeEach(async ({ context }) => {
  await limpiarSesion(context);
});

/**
 * Login con reintento si el throttler de login (5/min por IP) devuelve 429:
 * el formulario se queda en `/login` sin navegar, así que se espera a que
 * cierre la ventana y se intenta una vez más.
 *
 * @param page Página de Playwright del test.
 */
async function loginConCooldown(page: import("@playwright/test").Page): Promise<void> {
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  try {
    await page.waitForURL("**/student", { timeout: 10_000 });
  } catch {
    // 429 probable: espera la ventana de 1 min del throttler y reintenta.
    await page.waitForTimeout(62_000);
    await irALogin(page);
    await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
    await page.waitForURL("**/student", { timeout: 30_000 });
  }
}

test("Ranking ordena por monedas ganadas, el progreso refleja la billetera y el vacío muestra el estado de H5.2", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // ── 1) Login y links del panel (SPA, sin recargas extra)
  await loginConCooldown(page);
  await expect(page.getByRole("link", { name: LINK_RANKING })).toBeVisible();
  await expect(page.getByRole("link", { name: LINK_PROGRESO })).toBeVisible();

  // ── 2) CA 1: orden global por monedas ganadas (120 > 60)
  // El global incluye también estudiantes sin inscripción (usuarios de
  // otras suites), así que se afirma el ORDEN relativo, no el total.
  await page.goto("/student/ranking");
  await expect(page.getByRole("heading", { name: TITULO_RANKING })).toBeVisible({
    timeout: 15_000,
  });
  const filas = page.getByTestId("fila-ranking");
  await expect(filas.nth(0)).toContainText(ESTUDIANTE_LIDER, {
    timeout: 15_000,
  });
  await expect(filas.nth(0)).toContainText(String(GANADAS_LIDER));
  await expect(filas.nth(1)).toContainText(ESTUDIANTE_SEGUNDO);
  await expect(filas.nth(1)).toContainText(String(GANADAS_SEGUNDO));

  // ── 3) CA 1: "Mi clase" (SPA) muestra el mismo orden
  await page.getByTestId("pestana-ranking-clase").click();
  await expect(page.getByTestId("tabla-ranking")).toBeVisible({
    timeout: 15_000,
  });
  const filasClase = page.getByTestId("fila-ranking");
  await expect(filasClase).toHaveCount(2);
  await expect(filasClase.nth(0)).toContainText(ESTUDIANTE_LIDER);
  await expect(filasClase.nth(1)).toContainText(ESTUDIANTE_SEGUNDO);

  // ── 4) CA 2: progreso coherente con la API de la billetera
  await page.goto("/student/progreso");
  await expect(page.getByTestId("progreso-ganadas")).toHaveText(
    String(GANADAS_LIDER),
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("progreso-gastadas")).toHaveText("0");
  await expect(page.getByTestId("progreso-disponibles")).toHaveText(
    String(GANADAS_LIDER),
  );

  // ── 5) CA 3: estado vacío de H5.2
  // El ranking **global** nunca está vacío para un estudiante (la vista
  // incluye a todos los de la org y `ck_users_org` impide que un student
  // quede sin org); la rama `total === 0` de la vista es defensiva. Lo
  // alcanzable — y lo que se prueba — es "Mi clase" sin inscripciones.
  // Se usan `withdrawn` (no DELETE) para conservar los ids de las
  // inscripciones del seed: otros specs endurecen `enrollment_id = 1`.
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `UPDATE enrollments SET status = 'withdrawn', coins_earned = 0, coins_spent = 0 WHERE ${USUARIOS_SEED};`,
    ],
    { stdio: "pipe" },
  );

  await page.goto("/student/ranking");
  await page.getByTestId("pestana-ranking-clase").click();
  await expect(page.getByText(ETIQUETA_SIN_CLASES)).toBeVisible({
    timeout: 15_000,
  });
});
