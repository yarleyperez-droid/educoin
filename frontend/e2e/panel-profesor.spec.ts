/**
 * Prueba E2E de punta a punta del panel docente: crear clase → crear
 * actividad → publicarla (T5.6.5, PRO-389).
 *
 * Corre contra la app real (`next dev` en :3001) **y el backend Nest real**
 * (:3000) con la BD Docker (`educoin-db`) y su seed (`db/002_seed.sql`),
 * igual que `login.spec.ts`: todo el recorrido se hace **por la UI** (sin
 * llamadas directas a la API), que es justo lo que H5.6 debe garantizar.
 * Requisitos: la BD corriendo y el `.env` del backend apuntando a ella.
 *
 * Cobertura de los criterios de aceptación de H5.6:
 * - **CA 1:** al crear la clase se muestra su **código de unión de 8
 *   caracteres alfanuméricos** (el DEFAULT de `classes.code` en
 *   `prisma/schema.prisma` es `upper(substr(md5(...), 1, 8))`, así que el
 *   formato real es hexadecimal mayúscula; el assert acepta alfanumérico,
 *   que es el contrato del CA). Además, el detalle de la clase vuelve a
 *   mostrar **el mismo código** y permite copiarlo de nuevo (no
 *   desaparece al salir de la tarjeta de éxito).
 * - **CA 2:** la actividad creada aparece en el listado del detalle con el
 *   badge **Borrador** (estado `draft`).
 * - **CA 3:** al publicar, el badge pasa a **Publicada** y la fila **ya no**
 *   ofrece "Editar" ni "Publicar": no hay reversión a borrador.
 *
 * Un solo test (serial de facto): los pasos comparten estado (la clase y
 * la actividad que se crean a mitad de flujo) y encadenarlos en un test
 * evita exponer fixtures entre tests, repetir login/creación y alargar la
 * corrida; si algo falla, el mensaje de `expect` señala el paso exacto.
 *
 * Selectores: API de accesibilidad (`getByLabel`/`getByRole`) sobre los
 * labels reales de las vistas del panel (mismo estilo que `login.spec.ts`).
 *
 * Sin limpieza al finalizar: no existe endpoint de eliminar clases (solo
 * archivar, que queda fuera del alcance de esta prueba), así que la clase y
 * la actividad creadas **permanecen en la BD**. El nombre de clase lleva un
 * sufijo único por corrida (`H5.6 E2E ${Date.now()}`) porque el nombre es
 * único por profesor (índice `lower(name)`): sin sufijo, la segunda corrida
 * chocaría con la primera.
 */

import { expect, test } from "@playwright/test";

import {
  CONTRASENA_PROFESOR,
  irALogin,
  login,
  limpiarSesion,
  USUARIO_PROFESOR,
} from "./helpers";

/** Formato del código de unión: 8 caracteres alfanuméricos (CA 1 de H5.6). */
const PATRON_CODIGO_UNION = /^[A-Z0-9]{8}$/;

test.beforeEach(async ({ context }) => {
  // Cada corrida arranca sin cookies de sesión (aislamiento, como en login.spec.ts).
  await limpiarSesion(context);
  // Permiso de portapapeles para el aserto de "Copiar código" del detalle
  // (Chromium headless no otorga clipboard-write por defecto).
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3001",
  });
});

test("Panel docente: crear clase, crear actividad en borrador y publicarla sin reversión", async ({
  page,
}) => {
  // El flujo encadena varias pantallas y llamadas reales (login, crear
  // clase, crear actividad, publicar) y `next dev` compila cada ruta bajo
  // demanda en su primera visita, así que se amplía el timeout del test
  // (el del config son 30s) para no perder estabilidad en frío.
  test.setTimeout(120_000);

  // Datos únicos por corrida (ver docblock: nombre de clase único por profesor).
  const nombreClase = `H5.6 E2E ${Date.now()}`;
  const tituloActividad = `Actividad E2E ${Date.now()}`;

  // 1) Login real del profesor del seed → redirige a su panel /teacher.
  await irALogin(page);
  await login(page, USUARIO_PROFESOR, CONTRASENA_PROFESOR);
  await page.waitForURL("**/teacher");

  // 2) Crear clase. El formulario vive en `/teacher/clases/nueva` (la lista
  // `/teacher/clases` solo busca y enlaza con "Nueva clase"), así que se va
  // directo a la ruta del alta y se rellena por su label accesible.
  await page.goto("/teacher/clases/nueva");
  await page.getByLabel("Nombre de la clase", { exact: true }).fill(nombreClase);
  await page.getByRole("button", { name: "Crear clase" }).click();

  // CA 1: la tarjeta de éxito muestra "Clase creada: …" y el código de
  // unión de 8 caracteres en el campo de solo lectura "Código de unión".
  const campoCodigo = page.getByLabel("Código de unión", { exact: true });
  await expect(campoCodigo).toBeVisible();
  await expect(page.getByText(`Clase creada: ${nombreClase}`)).toBeVisible();
  await expect(campoCodigo).toHaveValue(PATRON_CODIGO_UNION);

  // El valor se conserva para compararlo contra el detalle: el código no
  // debe "desaparecer" al salir de la tarjeta de éxito.
  const valorCodigo = await campoCodigo.inputValue();

  // El id de la clase no se pinta en la tarjeta de éxito, pero sale del href
  // del enlace "Añadir una actividad" (`/teacher/clases/:id/actividades/…`).
  // Se extrae de ahí (nada de API directa) para poder abrir el detalle,
  // que es el camino que debe recorrer el usuario.
  const hrefActividad = await page
    .getByRole("link", { name: "Añadir una actividad" })
    .getAttribute("href");
  const claseId = hrefActividad?.match(
    /\/teacher\/clases\/([^/]+)\/actividades\/nueva/,
  )?.[1];
  if (claseId === undefined) {
    throw new Error(
      "No se pudo extraer el id de la clase del enlace 'Añadir una actividad'.",
    );
  }

  // 3) Detalle de la clase → "Nueva actividad" (el camino del usuario; no
  // se usa el atajo "Añadir una actividad" de la tarjeta de éxito).
  await page.goto(`/teacher/clases/${claseId}`);
  await expect(page.getByRole("heading", { name: nombreClase })).toBeVisible();

  // CA 1 (detalle): el código de unión sigue disponible al entrar a la
  // clase del profesor — mismo valor que en la tarjeta de éxito — y el
  // botón lo vuelve a copiar al portapapeles.
  const campoCodigoDetalle = page.getByLabel("Código de unión", {
    exact: true,
  });
  await expect(campoCodigoDetalle).toBeVisible();
  await expect(campoCodigoDetalle).toHaveValue(valorCodigo);
  await page.getByRole("button", { name: "Copiar código" }).click();
  await expect(page.getByRole("button", { name: "¡Copiado!" })).toBeVisible();

  await page.getByRole("link", { name: "Nueva actividad" }).click();
  await page.waitForURL("**/actividades/nueva");

  // Formulario de la actividad. El editor **ya nace con 1 pregunta `test`
  // de 2 opciones (la primera marcada como correcta)** — es el caso base
  // válido de `EditorPreguntas` —, así que basta rellenarla: el botón
  // "+ Opción múltiple" sumaría una segunda pregunta y aquí no hace falta.
  await page.getByLabel("Título", { exact: true }).fill(tituloActividad);
  await page.getByLabel("Recompensa (monedas)", { exact: true }).fill("10");
  // Se fija el tipo a `test` de forma explícita (aunque ya viene por defecto)
  // para que el tipo exigido por el flujo quede en el propio test.
  await page.getByLabel("Tipo", { exact: true }).selectOption("test");
  await page.getByLabel("Enunciado", { exact: true }).fill("¿Cuánto es 2 + 2?");
  await page.getByLabel("Texto de la opción 1", { exact: true }).fill("4");
  await page.getByLabel("Texto de la opción 2", { exact: true }).fill("5");

  // Se marca (idempotente: ya viene marcada) y se verifica la opción
  // correcta: el contrato exige al menos una `is_correct` por pregunta test.
  await page.getByLabel("Marcar como correcta la opción 1").click();
  await expect(
    page.getByLabel("Marcar como correcta la opción 1"),
  ).toBeChecked();

  await page.getByRole("button", { name: "Guardar borrador" }).click();

  // La tarjeta de éxito confirma el estado inicial: la actividad nace en
  // **Borrador** (`draft`) y solo entonces puede publicarse.
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  // 4) Volver al detalle: la actividad debe aparecer en el **listado** con
  // badge "Borrador" y las acciones propias de un draft (Editar/Publicar).
  await page.goto(`/teacher/clases/${claseId}`);
  // Se localiza la fila por el título único de la actividad (evita acoplar
  // el test a la posición de la fila dentro del listado).
  const filaActividad = page.locator("li").filter({ hasText: tituloActividad });
  await expect(filaActividad).toHaveCount(1);
  await expect(
    filaActividad.getByText("Borrador", { exact: true }),
  ).toBeVisible();
  await expect(
    filaActividad.getByRole("link", { name: "Editar" }),
  ).toBeVisible();
  await expect(
    filaActividad.getByRole("button", { name: "Publicar", exact: true }),
  ).toBeVisible();

  // 5) Publicar: `POST activities/:id/publicar` vía el botón de la fila;
  // el badge de la fila pasa a **Publicada** (CA 2).
  await filaActividad
    .getByRole("button", { name: "Publicar", exact: true })
    .click();
  await expect(
    filaActividad.getByText("Publicada", { exact: true }),
  ).toBeVisible();

  // CA 3 de H5.6 (sin reversión): la actividad publicada ya no ofrece ni
  // "Publicar" ni "Editar" en su fila.
  await expect(
    filaActividad.getByRole("button", { name: "Publicar", exact: true }),
  ).toHaveCount(0);
  await expect(
    filaActividad.getByRole("link", { name: "Editar", exact: true }),
  ).toHaveCount(0);
});
