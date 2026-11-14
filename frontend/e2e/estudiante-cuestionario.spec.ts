/**
 * Prueba E2E de punta a punta del cuestionario del estudiante: resolver una
 * actividad publicada y ver su resultado (T5.8.5, PRO-398).
 *
 * Corre contra la app real (`next dev` en :3001) **y el backend Nest real**
 * (:3000) con la BD Docker (`educoin-db`) y su seed (`db/002_seed.sql`),
 * igual que `login.spec.ts` y `panel-profesor.spec.ts`: todo el recorrido es
 * **por la UI** (el test no llama a la API) y sin interceptación de red, que
 * es justo lo que H5.8 debe garantizar ya contra la integración real de
 * H3.3/H3.4 (PRO-397).
 *
 * Actividad del seed elegida (verificada en la BD antes de escribir el spec):
 * - `activities.id = 1` «Challenge 1: Equations», estado **published**,
 *   clase 1 «Mathematics 10A», `reward_coins = 120`.
 * - `enrollments.id = 1`: est.perez (user 3) inscrito **active** en esa
 *   clase, así que la regla `actividadVisible` de H3.3 (estudiante inscrito +
 *   actividad `published`) deja abrirla por `GET /activities/:id`.
 * - Preguntas (JSONB `questions`), 10 puntos en total:
 *   1) `test` (5 pts) «What is x in 2x + 4 = 10?» con opciones "2", "3"
 *      (la correcta, `is_correct: true`) y "4".
 *   2) `completion` (5 pts) «Complete: the solution of x + 1 = 5 is x = ___»
 *      con `expected_answer: "4"`.
 *
 * La navegación es **por URL directa** (`/student/actividades/1`): el listado
 * `/student/actividades` está **vacío a propósito** en esta rama porque
 * `listarPublicadas` devuelve `[]` mientras no haya `inscripcionId`
 * (limitación conocida y documentada de PRO-397). Abrir la actividad por URL
 * es el camino real disponible hoy y el que este spec ejercita.
 *
 * Cobertura de los criterios de aceptación de H5.8:
 * - **CA 1/2 (render sin secretos):** las preguntas se pintan con sus
 *   controles (radios para `test`, campo de texto para `completion`) y el DOM
 *   **no expone** los secretos del JSONB (`is_correct`, `expected_answer`,
 *   marcas de "correcta"): ni siquiera hay una opción preseleccionada ni el
 *   campo precargado con la respuesta esperada.
 * - **CA 3 (un solo envío):** tras enviar, el botón "Enviar respuestas"
 *   desaparece (la vista se bloquea con la entrega), queda el mensaje de
 *   sin-reintento y **una recarga** vuelve a arrancar bloqueada (la vista
 *   re-lee la entrega al montar). El segundo POST real además es **409** por
 *   `uq_submission` de la BD; aquí se verifica la capa de UI que el CA hace
 *   visible (el botón ya no existe / el bloqueo persiste).
 * - **Resultado (T5.8.3):** la auto-calificación de H3.4 es **inmediata** en
 *   el POST; respondiendo 2/2 correctas (≥ 80% del umbral) la entrega llega
 *   como **Calificada** y la vista muestra puntaje, monedas y el desglose por
 *   pregunta — siempre desde `entrega.resultado`, nunca con las respuestas
 *   correctas del JSONB.
 *
 * Login: el estudiante del seed trae `must_change_password = TRUE`, así que
 * el flujo real lo bloquea en `/cambiar-contrasena` antes de cualquier ruta
 * `/student/*`. El test completa ese cambio obligatorio primero (mismo camino
 * que el escenario 4 de `login.spec.ts`: el cambio sigue resolviéndose con el
 * **mock documentado** de `cambiarContrasena`, H2.2 pendiente — solo reescribe
 * la cookie con `debeCambiarContrasena: false`, la BD no cambia y la corrida
 * es repetible) y solo entonces navega al cuestionario.
 *
 * Repetibilidad (fixture): `uq_submission` permite **una** entrega por
 * (actividad, inscripción), así que una segunda corrida chocaría con la de la
 * primera (el formulario ya ni se renderizaría). Como no existe endpoint de
 * borrado de entregas, el `beforeAll` resetea el fixture con un DELETE directo
 * vía `psql` contra la **misma BD que usa el backend** (la `DATABASE_URL` del
 * `.env` de la raíz, la misma fuente de verdad que Nest/Prisma) — el mismo rol
 * que juegan `beforeAll`/`afterAll` con Prisma en
 * `test/submissions.e2e-spec.ts`. El historial de monedas **no** se
 * toca (AGENTS.md §6: la BD conserva el historial); ningún assert depende del
 * saldo de la inscripción, solo de `coins_awarded` de la entrega nueva (120,
 * el `reward_coins` del seed que acredita `fn_award_coins` al gradear).
 *
 * Un solo test (serial de facto), como `panel-profesor.spec.ts`: los pasos
 * comparten el estado de un flujo de un solo disparo (el envío) y encadenarlos
 * evita repetir login/cambio/envío entre tests y señala el paso exacto del
 * fallo en el mensaje del `expect`.
 *
 * Selectores: API de accesibilidad (`getByLabel`/`getByRole`) sobre los labels
 * reales de la vista (radios `Opción N: texto`, campo "Tu respuesta", botón
 * "Enviar respuestas"). Dos peculiaridades ya conocidas en este proyecto: el
 * glob de dos asteriscos y barra seguido de la ruta (p. ej. dos asteriscos y
 * `/ruta`) en `toHaveURL` se resuelve contra `baseURL` y no matchea, así que
 * los asserts de URL usan regex o `waitForURL` con glob-string; y el route
 * announcer de Next también tiene `role="alert"`, así que los asserts de alert
 * filtran por su texto.
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

/** Título del seed: sanity-check de que la URL abrió la actividad correcta. */
const TITULO_ACTIVIDAD_SEED = "Challenge 1: Equations";

/**
 * Nueva contraseña para el cambio obligatorio (≥ 8 caracteres y distinta de
 * la actual). El cambio es el mock documentado (la BD no se modifica), así
 * que el valor solo vive en la cookie de sesión y la corrida es repetible.
 */
const NUEVA_CONTRASENA_DEMO = "NuevaClave2026!";

/**
 * Respuesta correcta del seed para la Pregunta 1 (`test`): la opción con
 * texto "3" es la segunda de las tres, y su aria-label real en la UI es
 * `Opción 2: 3` (`Opción ${índice + 1}: ${texto}`).
 *
 * El test responde con los valores correctos **a propósito**: el CA no es
 * "acertar", sino llegar a la auto-calificación (umbral ≥ 80%; con 1/2 = 50%
 * la entrega quedaría `submitted` en vez de `Calificada`) y verificar que el
 * resultado se muestra sin exponer estos secretos en el DOM.
 */
const OPCION_SEED_PREGUNTA_1 = "Opción 2: 3";

/** `expected_answer` del seed para la Pregunta 2 (`completion`): "4". */
const RESPUESTA_SEED_PREGUNTA_2 = "4";

// Textos reales de la vista (`student/actividades/[id]/page.tsx`).
const ETIQUETA_CALIFICADA = "Calificada";
const MENSAJE_ENVIADO = "Respuestas enviadas";
const MENSAJE_SIN_REINTENTO =
  "Tu entrega ya fue registrada. Solo se permite un intento por actividad.";
const ETIQUETA_SIN_FEEDBACK = "Aún sin retroalimentación.";

/** Enunciados del seed para localizar cada `article` de pregunta sin CSS. */
const ENUNCIADO_PREGUNTA_1 = "What is x in 2x + 4 = 10?";
const ENUNCIADO_PREGUNTA_2 = "the solution of x + 1 = 5 is x =";

/**
 * Lee la `DATABASE_URL` del `.env` de la raíz del repo (el mismo archivo que
 * cargan Nest y Prisma): es la única fuente de verdad de **a qué BD** está
 * conectada la app, y evita hardcodear credenciales en el spec ni asumir un
 * contenedor Docker concreto (la BD "real" es la que responda en esa URL).
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
 * Resetea el fixture de entrega de la actividad del seed para que la corrida
 * siempre parta del formulario sin enviar (ver docblock: `uq_submission`).
 *
 * Se conecta con `psql` a la BD real del backend (vía `DATABASE_URL`) y se
 * borra solo la fila de `submissions` que este spec usa, junto con los
 * movimientos de moneda que la auto-calificación le haya generado (FK
 * `coin_movements.submission_id`): sin ese borrado previo el DELETE viola la
 * restricción de referencia. El saldo del estudiante no se recalcula aquí
 * (es fixture de test, no producción).
 */
function resetearEntregaDelSeed(): void {
  const filtro = `activity_id = ${ID_ACTIVIDAD_SEED} AND enrollment_id = ${ID_INSCRIPCION_SEED}`;

  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DELETE FROM coin_movements WHERE submission_id IN (SELECT id FROM submissions WHERE ${filtro});`,
      "-c",
      `DELETE FROM submissions WHERE ${filtro};`,
    ],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  // Fixture: sin entrega previa, el formulario de envío es alcanzable aunque
  // este spec ya se haya corrido antes contra la misma BD.
  resetearEntregaDelSeed();
});

test.beforeEach(async ({ context }) => {
  // Cada corrida arranca sin cookies de sesión (aislamiento, como en login.spec.ts).
  await limpiarSesion(context);
});

test("Estudiante resuelve la actividad publicada y ve el resultado sin exponer respuestas correctas", async ({
  page,
}) => {
  // El flujo encadena varias pantallas y llamadas reales (login, cambio de
  // contraseña, carga del cuestionario, envío) y `next dev` compila cada
  // ruta bajo demanda en su primera visita, así que se amplía el timeout del
  // test (el del config son 30s) para no perder estabilidad en frío.
  test.setTimeout(120_000);

  // 1) Login real del estudiante del seed → `must_change_password = TRUE` en
  // la BD, así que el middleware lo bloquea en `/cambiar-contrasena`.
  await irALogin(page);
  await login(page, USUARIO_ESTUDIANTE, CONTRASENA_ESTUDIANTE);
  await page.waitForURL("**/cambiar-contrasena");

  // Cambio obligatorio (mock documentado de `cambiarContrasena`, H2.2
  // pendiente): con el flag ya en false el middleware deja pasar a /student.
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
  await page.waitForURL("**/student");

  // 2) Abrir la actividad por URL directa (el listado está vacío por la
  // limitación conocida de `listarPublicadas`, ver docblock).
  await page.goto(`/student/actividades/${ID_ACTIVIDAD_SEED}`);
  await expect(
    page.getByRole("heading", { name: TITULO_ACTIVIDAD_SEED }),
  ).toBeVisible();

  // 3) CA 1/2: el cuestionario renderiza las 2 preguntas del seed con sus
  // controles, y el formulario está operativo (no hay entrega previa).
  await expect(
    page.getByRole("button", { name: "Enviar respuestas" }),
  ).toBeVisible();

  // Se localiza cada pregunta por su enunciado único (sin CSS ni posición).
  const pregunta1 = page
    .getByRole("article")
    .filter({ hasText: ENUNCIADO_PREGUNTA_1 });
  const pregunta2 = page
    .getByRole("article")
    .filter({ hasText: ENUNCIADO_PREGUNTA_2 });
  await expect(pregunta1).toHaveCount(1);
  await expect(pregunta2).toHaveCount(1);

  // Pregunta `test`: 3 radios con aria-label `Opción N: texto` y **ninguno
  // preseleccionado** — la UI no sugiere cuál es la correcta.
  const opciones = pregunta1.getByRole("radio");
  await expect(opciones).toHaveCount(3);
  await expect(pregunta1.getByRole("radio", { name: "Opción 1: 2" })).toBeVisible();
  await expect(pregunta1.getByRole("radio", { name: OPCION_SEED_PREGUNTA_1 })).toBeVisible();
  await expect(pregunta1.getByRole("radio", { name: "Opción 3: 4" })).toBeVisible();
  for (const opcion of await opciones.all()) {
    await expect(opcion).not.toBeChecked();
  }

  // Pregunta `completion`: campo vacío (el `expected_answer` no se precarga).
  const campoRespuesta = pregunta2.getByLabel("Tu respuesta", { exact: true });
  await expect(campoRespuesta).toHaveValue("");

  // Sin secretos del JSONB en el DOM (ni `is_correct` ni `expected_answer`)
  // y sin marcas visibles de "correcta" en ninguna parte del cuestionario.
  await verificarSinSecretos(page);

  // 4) Responder todas las preguntas (2/2 correctas → ≥ 80%) y enviar.
  await pregunta1.getByRole("radio", { name: OPCION_SEED_PREGUNTA_1 }).check();
  await campoRespuesta.fill(RESPUESTA_SEED_PREGUNTA_2);
  await page.getByRole("button", { name: "Enviar respuestas" }).click();

  // 5) La auto-calificación de H3.4 es inmediata en el POST: con el umbral
  // alcanzado la entrega llega como **Calificada** (badge junto al título) y
  // la vista sustituye el formulario por el bloque de envío + resultado.
  await expect(page.getByText(ETIQUETA_CALIFICADA, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(MENSAJE_ENVIADO, { exact: true })).toBeVisible();

  // El mensaje de sin-reintento aparece dos veces (caja de estado y sección
  // de resultado): se localiza la primera para no violar el strict mode.
  await expect(page.getByText(MENSAJE_SIN_REINTENTO).first()).toBeVisible();

  // Resultado: 10/10 puntos (5 + 5) y las 120 monedas del `reward_coins`
  // que `fn_award_coins` acredita al gradear. Se afirma la línea completa del
  // marcador: "120 monedas" también aparece en la cabecera ("120 monedas al
  // completar") y un regex suelto violaría el strict mode.
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
  await expect(
    page.getByText(/10\s*\/\s*10 puntos\s*·\s*120 monedas/),
  ).toBeVisible();

  // Desglose por pregunta: se muestra el enunciado y los puntos obtenidos,
  // nunca la opción ni el `expected_answer` correctos del JSONB.
  const resultado1 = page.getByRole("listitem").filter({ hasText: "Pregunta 1:" });
  const resultado2 = page.getByRole("listitem").filter({ hasText: "Pregunta 2:" });
  await expect(resultado1).toHaveCount(1);
  await expect(resultado2).toHaveCount(1);
  await expect(resultado1).toContainText("5 puntos");
  await expect(resultado2).toContainText("5 puntos");

  // Feedback del profesor en su estado vacío (H3.5 aún no expone `feedback`).
  await expect(
    page.getByRole("heading", { name: "Feedback del profesor" }),
  ).toBeVisible();
  await expect(page.getByText(ETIQUETA_SIN_FEEDBACK)).toBeVisible();

  // De nuevo sin secretos: el resultado tampoco filtra las respuestas.
  await verificarSinSecretos(page);

  // 6) CA 3 (un solo envío): el botón de enviar ya no existe (el formulario
  // entero se sustituyó por el bloqueo) y el mensaje de sin-reintento es el
  // aviso claro de que no hay reintento.
  await expect(
    page.getByRole("button", { name: "Enviar respuestas" }),
  ).toHaveCount(0);

  // El bloqueo sobrevive a la recarga: la vista re-lee la entrega al montar
  // y vuelve a arrancar ya enviada (segunda capa de protección del flujo).
  await page.reload();
  await expect(
    page.getByRole("heading", { name: TITULO_ACTIVIDAD_SEED }),
  ).toBeVisible();
  await expect(page.getByText(MENSAJE_ENVIADO, { exact: true })).toBeVisible();
  await expect(page.getByText(ETIQUETA_CALIFICADA, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar respuestas" }),
  ).toHaveCount(0);
});

/**
 * Verifica que el DOM visible de la página no exponga los secretos del JSONB
 * de preguntas (`is_correct`, `expected_answer`) ni ninguna marca de
 * "correcta": es el corazón del CA «veo el resultado sin exponer respuestas
 * correctas» (la forma segura del contrato solo viaja `text`/`option`).
 *
 * @param page Página de Playwright del test.
 */
async function verificarSinSecretos(page: import("@playwright/test").Page): Promise<void> {
  const textoVisible = await page.locator("body").innerText();

  expect(textoVisible).not.toContain("is_correct");
  expect(textoVisible).not.toContain("expected_answer");
  expect(textoVisible.toLowerCase()).not.toContain("correcta");

  // A nivel de DOM (incluidos nodos ocultos): ninguna marca de "correcta".
  await expect(page.getByText(/correcta/i)).toHaveCount(0);
}
