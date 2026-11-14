/**
 * Pruebas E2E de la integración de calificación con monedas reflejadas
 * (T5.9.3 / PRO-401, H5.9 / PRO-290): CA 2 y CA 3 de la historia contra la
 * **API real** — sin mocks ni interceptación de red.
 *
 * Flujo (un solo test serial, patrón de `canje.spec.ts`):
 * 1. est.perez resuelve la actividad 1 del seed POR DEBAJO del umbral del
 *    80% (1/2 = 50%) → la entrega queda `submitted` SIN monedas.
 * 2. prof.lopez abre la cola de la actividad (T5.9.1), entra a la revisión
 *    (T5.9.2), califica con puntaje + feedback → `graded`.
 * 3. **Intento de recalificación** (mismo `POST .../calificar` reenviado con
 *    la sesión real del profesor vía `page.evaluate` + `POST /auth/refresh`)
 *    → espera **409** (anti-recalificación, `docs/flujo_entregas.md` §10).
 * 4. El estudiante ve la entrega `graded` con puntaje y feedback, y su
 *    billetera marca **exactamente** `+120` (una sola vez): el trigger
 *    `fn_award_coins` solo paga en la transición → `graded` y el backend
 *    filtra por `submitted`, así que ni el primer pago se duplica ni el
 *    reenvío 409 toca el saldo.
 *
 * Presupuesto de refresh (`POST /auth/refresh`, throttler 5/min por IP):
 * solo 2 recargas con sesión (actividad inicial y el `evaluate` del 409);
 * el flujo del profesor navega por SPA y la verificación final del
 * estudiante usa el dashboard (`/student` tras el login, sin recarga) más
 * SPA hasta la actividad.
 *
 * Base del delta: el fixture con `psql` (patrón de `canje.spec.ts`) pone
 * `enrollments.coins_earned = 0` y borra la entrega y sus movimientos, así
 * que el saldo objetivo es `0 + 120` sin necesidad de una lectura previa.
 * También deja `must_change_password = FALSE` en ambos usuarios (guard
 * H2.2, fix 1454163).
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

/** Título de la actividad del seed (enlace en `/student/actividades`). */
const TITULO_ACTIVIDAD_SEED = "Challenge 1: Equations";

/** Inscripción de est.perez en la clase de esa actividad (`enrollments.id = 1`). */
const ID_INSCRIPCION_SEED = 1;

/** Recompensa de la actividad del seed (`reward_coins = 120`). */
const RECOMPENSA_ACTIVIDAD = 120;

/** Puntaje que asigna el profesor (dentro del rango 0..10 del seed). */
const PUNTAJE_PROFESOR = 6;

/** Feedback escrito al calificar (se verifica en la vista del estudiante). */
const FEEDBACK_PROFESOR = "Buen trabajo, repasa el paso 2.";

// Textos reales de la vista del estudiante (`student/actividades/[id]`).
const MENSAJE_ENVIADO = "Respuestas enviadas";
const ETIQUETA_ENVIADA = "Enviada";
const ETIQUETA_CALIFICADA = "Calificada";

// Enunciados del seed para localizar cada `article` de pregunta.
const ENUNCIADO_PREGUNTA_1 = "What is x in 2x + 4 = 10?";
const ENUNCIADO_PREGUNTA_2 = "the solution of x + 1 = 5 is x =";
const OPCION_SEED_PREGUNTA_1 = "Opción 2: 3";

/** Respuesta INCORRECTA de la Pregunta 2 → 50% < umbral 80% → `submitted`. */
const RESPUESTA_ERRONEA_PREGUNTA_2 = "999";

/** Nombre visible del estudiante del seed (fila de la cola del profesor). */
const FILA_ESTUDIANTE = "Juan Pérez";

/** Nombre de la clase del seed (`classes.name`, usada en la navegación SPA). */
const NOMBRE_CLASE_SEED = "Mathematics 10A";

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
 * Fixture: cada corrida parte sin entrega previa, sin monedas de esa
 * actividad, sin el guard de cambio obligatorio y **sin la basura `deleted`**
 * de corridas E2E anteriores: `GET /classes/:id/activities` pagina (20 por
 * defecto) y esas actividades tapaban la del seed en la vista del profesor.
 */
function resetearFlujoDeCalificacion(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
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

  // La base del delta es 0 por fixture (no por lectura previa de UI).
  const base = execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-tA",
      "-c",
      `SELECT coins_earned FROM enrollments WHERE id = ${ID_INSCRIPCION_SEED};`,
    ],
    { encoding: "utf8" },
  ).trim();
  if (base !== "0") {
    throw new Error(`Fixture inválido: coins_earned = "${base}", se esperaba 0.`);
  }
}

test.beforeAll(() => {
  resetearFlujoDeCalificacion();
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

test("Calificar refleja las monedas exactamente 1 vez y el reenvío responde 409 sin tocar el saldo", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  // ── 1) est.perez entrega por debajo del umbral → `submitted` sin monedas
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  await page.waitForURL("**/student");

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
  // 50% < 80% → queda ENVIADA (no auto-calificada) y sin monedas.
  await expect(page.getByText(ETIQUETA_ENVIADA, { exact: true })).toBeVisible();

  // ── 2) prof.lopez califica desde la cola (T5.9.1) y la revisión (T5.9.2)
  await limpiarSesion(context);
  await irALogin(page);
  await login(page, USUARIO_PROFESOR, CONTRASENA_PROFESOR);
  await page.waitForURL("**/teacher");

  // Cola por navegación SPA (dashboard → Mis clases → buscar clase →
  // clase → Ver entregas): evita recargas y conserva el presupuesto de
  // refresh (5/min por IP). La lista de clases exige buscar (≥ 3 chars).
  await page.getByRole("link", { name: "Mis clases" }).click();
  await page.getByRole("searchbox", { name: "Buscar clase" }).fill("Mathematics");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("link", { name: NOMBRE_CLASE_SEED }).click();
  await page.getByRole("link", { name: "Ver entregas" }).click();
  await page.waitForURL(/\/entregas$/);
  // Filtro por estado (CA 1 de H5.9): solo "Enviadas".
  await page.getByLabel("Estado", { exact: true }).selectOption("submitted");
  const fila = page.getByRole("cell", { name: FILA_ESTUDIANTE });
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await fila.getByRole("link").click();
  await page.waitForURL(/\/entregas\/[^/]+$/);

  // Id de la entrega desde la URL de la revisión (SPA, sin recarga).
  const entregaId = new URL(page.url()).pathname.split("/").pop();
  expect(entregaId).toBeTruthy();

  // Formulario de calificación (solo existe en `submitted`).
  await page.getByLabel(/Puntaje/).fill(String(PUNTAJE_PROFESOR));
  await page.getByLabel(/Feedback/).fill(FEEDBACK_PROFESOR);
  await page.getByRole("button", { name: "Aprobar (graded)" }).click();
  // Éxito → la vista queda SOLO LECTURA con el estado `graded` (CA 3).
  await expect(
    page.getByText(ETIQUETA_CALIFICADA, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Aprobar (graded)" }),
  ).toHaveCount(0);

  // ── 3) Reenvío del mismo POST con la sesión del profesor → 409
  const estadoReenvio = await page.evaluate(
    async ({ actividadId, idEntrega, puntaje }) => {
      const refresco = await fetch("http://localhost:3000/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!refresco.ok) {
        return { estado: -1, detalle: `refresh ${refresco.status}` };
      }
      const sesion = (await refresco.json()) as { accessToken?: string };
      if (sesion.accessToken === undefined) {
        return { estado: -1, detalle: "sin accessToken" };
      }
      const respuesta = await fetch(
        `http://localhost:3000/api/v1/activities/${actividadId}/submissions/${idEntrega}/calificar`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sesion.accessToken}`,
          },
          credentials: "include",
          body: JSON.stringify({ decision: "graded", puntaje }),
        },
      );
      return { estado: respuesta.status, detalle: await respuesta.text() };
    },
    {
      actividadId: ID_ACTIVIDAD_SEED,
      idEntrega: entregaId,
      puntaje: PUNTAJE_PROFESOR,
    },
  );
  expect(estadoReenvio.estado, estadoReenvio.detalle).toBe(409);

  // ── 4) El estudiante ve exactamente +120 y su entrega `graded` (CA 2/3)
  // Un solo acceso al panel (sin recargas): el dashboard muestra el saldo
  // recién acreditado y, por SPA, la actividad revisada con feedback.
  await limpiarSesion(context);
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  await page.waitForURL("**/student");

  await expect(page.getByTestId("monedas-ganadas")).toHaveText(
    String(RECOMPENSA_ACTIVIDAD),
    { timeout: 15_000 },
  );

  await page.getByRole("link", { name: "Mis actividades" }).click();
  await page.getByRole("link", { name: TITULO_ACTIVIDAD_SEED }).click();
  await expect(
    page.getByText(ETIQUETA_CALIFICADA, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(FEEDBACK_PROFESOR)).toBeVisible();

  // Cooldown final: los throttlers de login/refresh son 5/min por IP sobre
  // el mismo backend y la suite encadena specs; esperar a que cierre la
  // ventana deja `canje.spec.ts` arrancar limpio (los hooks afterAll no
  // aceptan timeout aquí, el del config es30s).
  await page.waitForTimeout(62_000);
});
