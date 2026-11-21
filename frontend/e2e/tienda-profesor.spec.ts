/**
 * Prueba E2E de la tienda del profesor (H10.2, T10.2.1–T10.2.3) contra la
 * app real (`next dev` en :3001), el backend Nest real (:3000) y la BD
 * Docker — mismo criterio que `panel-profesor.spec.ts`: todo el recorrido
 * se hace **por la UI**, sin interceptar red.
 *
 * El spec es **autocontenido** para ser repetible en una BD con datos
 * residuales de otras corridas: crea SU PROPIA clase por la UI
 * (`/teacher/clases/nueva`, nombre único por `Date.now()`) y prueba la
 * tienda dentro de ella. Así no depende de que la clase del seed aparezca
 * en la primera página del selector (`listarMisClases` está acotado a 50,
 * y esta BD acumula decenas de clases de e2es pasadas).
 *
 * Cobertura de los criterios de aceptación de H10.2:
 * - **CA 1:** `/teacher/canjes` muestra las pestañas **Tienda** y
 *   **Solicitudes**; el selector lista la clase recién creada y, al
 *   elegirla, el estado vacío confirma que la tienda es **por clase**.
 * - **CA 2:** "Publicar artículo" abre el formulario; se publica un bono
 *   de nota (décimas 0.2, costo 10) y aparece en la tabla con los valores
 *   ingresados y badge "Activo"; luego se publica una actividad lúdica
 *   con stock.
 * - **CA 3:** "Editar" cambia el costo (10 → 15) y se refleja; "Archivar"
 *   pide confirmación y, al confirmar, el artículo desaparece de la
 *   tienda (borrado lógico del backend).
 * - **CA 4:** la pestaña "Solicitudes" sigue mostrando la cola de H7.4
 *   (con sus canjes o el estado vacío "No hay canjes pendientes").
 *
 * Repetibilidad: la clase y los artículos llevan sufijo único por corrida
 * y todos los artículos terminan **archivados** (borrado lógico), así que
 * la corrida siguiente no choca con el nombre único por clase y no deja
 * basura canjeable en la BD.
 *
 * Selectores: API de accesibilidad (`getByLabel`/`getByRole`) sobre los
 * labels reales de las vistas (`clases/nueva`, `tienda-clase`).
 */

import { expect, test } from "@playwright/test";

import {
  CONTRASENA_PROFESOR,
  irALogin,
  login,
  limpiarSesion,
  USUARIO_PROFESOR,
} from "./helpers";

test.beforeEach(async ({ context }) => {
  // Cada corrida arranca sin cookies de sesión (aislamiento).
  await limpiarSesion(context);
});

test("Tienda del profesor: pestañas, catálogo por clase, publicar, editar y archivar", async ({
  page,
}) => {
  // La pestaña compila en frío la primera vez que se visita (next dev) y
  // el flujo encadena dos formularios + API real: timeout ampliado, igual
  // que en `panel-profesor.spec.ts`.
  test.setTimeout(180_000);

  // Datos únicos por corrida (nombre de clase 8–150; ítem único por clase).
  const sufijo = Date.now();
  const nombreClase = `Clase E2E H10.2 ${sufijo}`;
  const nombreBono = `Bono E2E ${sufijo}`;
  const nombreJuego = `Juego E2E ${sufijo}`;

  // 1) Login real del profesor del seed → su panel.
  // IMPORTANTE: después del login TODA la navegación es **client-side**
  // (links del sidebar), nunca `page.goto`: una recarga completa pierde el
  // access token en memoria y obliga al baile 401 → refresh → reintento
  // (con rotación de la cookie de refresh que puede chocar en carrera, lo
  // que muestra "Tu sesión ha expirado" de forma intermitente).
  await irALogin(page);
  await login(page, USUARIO_PROFESOR, CONTRASENA_PROFESOR);
  await page.waitForURL("**/teacher");

  // 2) CA 1 (preparación): crear la clase propia del spec por la UI,
  //    navegando por la SPA: sidebar "Mis Clases" → "Nueva clase".
  await page.getByRole("link", { name: "Mis Clases" }).click();
  await page.getByRole("link", { name: "Nueva clase" }).click();
  await page.getByLabel("Nombre de la clase").fill(nombreClase);
  await page.getByRole("button", { name: "Crear clase" }).click();

  // El diálogo de éxito confirma la creación; se cierra para seguir.
  const dialogoClase = page.getByRole("dialog");
  await expect(dialogoClase).toBeVisible({ timeout: 15_000 });
  await expect(
    dialogoClase.getByText(`Clase creada: ${nombreClase}`),
  ).toBeVisible();
  await dialogoClase
    .getByRole("button", { name: "Crear otra clase" })
    .waitFor();
  await page.keyboard.press("Escape");

  // 3) CA 1: la ventana Canjes abre en la pestaña Tienda (client-side).
  await page.getByRole("link", { name: "Canjes" }).click();
  const pestanaTienda = page.getByRole("tab", { name: "Tienda" });
  const pestanaSolicitudes = page.getByRole("tab", { name: "Solicitudes" });

  await expect(pestanaTienda).toBeVisible();
  await expect(pestanaSolicitudes).toBeVisible();
  await expect(pestanaTienda).toHaveAttribute("aria-selected", "true");

  // 4) CA 1: la clase recién creada aparece en el selector y, al elegir
  //    la tienda muestra SU estado vacío (catálogo por clase).
  // La carga de clases puede tardar más de 5 s (el transporte repite la
  // petición tras un 401 + refresh de sesión); timeout ampliado.
  const selectorClase = page.getByLabel("Clase", { exact: true });
  await expect(selectorClase).toBeVisible({ timeout: 15_000 });
  await selectorClase.selectOption({ label: nombreClase });

  await expect(
    page.getByText("Esta clase todavía no tiene artículos"),
  ).toBeVisible();

  // 5) CA 2: publicar un bono de nota completo desde el formulario.
  // (Hay dos botones "Publicar artículo": el de la cabecera del selector y
  // el de la acción sugerida del estado vacío; cualquiera abre el modal.)
  await page.getByRole("button", { name: "Publicar artículo" }).first().click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  await dialogo.getByLabel("Nombre", { exact: true }).fill(nombreBono);
  await dialogo
    .getByLabel("Descripción (opcional)")
    .fill("Artículo de la prueba E2E de H10.2");
  await dialogo.getByLabel("Tipo").selectOption({ label: "Bono de nota (décimas)" });
  await dialogo.getByLabel(/Décimas de nota/).selectOption({ label: "0.2 décimas" });
  await dialogo.getByLabel("Costo en EduCoins").fill("10");

  await dialogo.getByRole("button", { name: "Publicar" }).click();

  // El artículo aparece en la tienda con los valores ingresados (CA 2).
  const tabla = page.getByRole("table");
  const filaBono = tabla.getByRole("row").filter({ hasText: nombreBono });
  await expect(filaBono).toBeVisible();
  await expect(filaBono.getByText("10 EduCoins")).toBeVisible();
  await expect(filaBono.getByText("0.2 décimas")).toBeVisible();
  await expect(filaBono.getByText("Activo")).toBeVisible();

  // 6) CA 3: editar el costo del bono (10 → 15).
  await filaBono.getByRole("button", { name: "Editar" }).click();
  await expect(dialogo).toBeVisible();
  // El tipo no se puede cambiar en caliente (supuesto de H4.1).
  await expect(dialogo.getByLabel("Tipo")).toBeDisabled();
  await dialogo.getByLabel("Costo en EduCoins").fill("15");
  await dialogo.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(filaBono.getByText("15 EduCoins")).toBeVisible();

  // 7) CA 2: publicar también una actividad lúdica con stock.
  await page.getByRole("button", { name: "Publicar artículo" }).click();
  await dialogo.getByLabel("Nombre", { exact: true }).fill(nombreJuego);
  await dialogo.getByLabel("Costo en EduCoins").fill("20");
  await dialogo.getByLabel("Stock (existencias)").fill("3");
  await dialogo.getByRole("button", { name: "Publicar" }).click();

  const filaJuego = tabla.getByRole("row").filter({ hasText: nombreJuego });
  await expect(filaJuego).toBeVisible();
  await expect(filaJuego.getByText("20 EduCoins")).toBeVisible();
  await expect(filaJuego.getByText("Actividad lúdica")).toBeVisible();

  // 8) CA 3: archivar ambos con confirmación; salen de la tienda.
  for (const fila of [filaBono, filaJuego]) {
    await fila.getByRole("button", { name: "Archivar" }).click();
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "Archivar", exact: true }).click();
  }

  await expect(tabla.getByText(nombreBono)).toBeHidden();
  await expect(tabla.getByText(nombreJuego)).toBeHidden();

  // 9) CA 4: la pestaña Solicitudes conserva la cola de H7.4.
  await pestanaSolicitudes.click();
  await expect(pestanaSolicitudes).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText(
      "Solicitudes de recompensas de tus clases, en orden de llegada.",
    ),
  ).toBeVisible();
  // La cola carga contra la API real: con o sin pendientes, uno de los
  // dos estados válidos de H7.4 debe estar en pantalla.
  await expect(
    page.getByText("No hay canjes pendientes").or(page.getByRole("table")),
  ).toBeVisible();
});
