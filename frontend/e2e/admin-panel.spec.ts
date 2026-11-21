/**
 * Pruebas E2E del panel del admin (T5.5.3 / PRO-384, H5.5 / PRO-286):
 * redirección de no-admin (CA 3), camino feliz de altas con
 * `contrasenaInicial` (CA 1 y 2) y estados de carga/vacío (CA 4) contra
 * la **API real** — sin mocks.
 *
 * Flujo (un solo test serial, patrón de la suite):
 * 1. `prof.lopez` abre `/admin` → el middleware H5.3 lo redirige a
 *    `/teacher` (CA 3).
 * 2. `admin` entra al hub, crea dos organizaciones desde
 *    `/admin/organizaciones` (ambas aparecen en el listado) y aserta el
 *    estado de carga accesible justo al abrir la página (CA 4).
 * 3. En `/admin/usuarios` crea un usuario en la primera organización:
 *    el alta muestra la **contraseña inicial** (una sola vez) y el
 *    usuario aparece primero en el listado (CA 2).
 * 4. Filtro por organización: muestra al usuario nuevo y excluye a los
 *    de otra org; filtrar por la segunda org (sin usuarios) muestra el
 *    estado vacío de H5.2 (CA 4).
 *
 * Presupuesto de refresh (throttler5/min):2 recargas con sesión
 * (organizaciones y usuarios); el hub no llama API.
 *
 * Fixture (`beforeAll`): el seed deja al admin con
 * `must_change_password = TRUE` (el login mandaría a
 * `/cambiar-contrasena`); se pone en `FALSE` SOLO durante la corrida y el
 * `afterAll` lo restaura a `TRUE` (estado sembrado). La contraseña NO se
 * cambia. También se restaura el estado sembrado de est.perez (lo exigen
 * `login.spec.ts` y `estudiante-cuestionario.spec.ts`, corren después) y
 * se borra el junk de prueba (usuario y organizaciones `E2E Admin…`).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  CONTRASENA_PROFESOR,
  irALogin,
  login,
  limpiarSesion,
  USUARIO_PROFESOR,
} from "./helpers";

/** Credenciales del admin del seed (README §Usuarios de prueba). */
const USUARIO_ADMIN = "admin";
const CONTRASENA_ADMIN = "Admin123!";

// Textos de las vistas.
const TITULO_USUARIOS_VACIO_FILTRO = "Sin usuarios en esta organización";
const MENSAJE_ORG_CREADA = "Organización creada con éxito";
const ESTADO_CARGA_ORG = "Cargando organizaciones…";

/** Prefijos de prueba (el afterAll los borra con LIKE). */
const PREFIJO_ORG = "E2E Admin";
const PREFIJO_USUARIO = "e2e.admin";

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
 * Fixture de arranque: admin sin cambio obligatorio (solo durante la
 * corrida) y est.perez restaurado a su estado sembrado.
 */
function resetearPanelAdmin(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      // Hash argon2 del seed del admin (defensivo contra corridas que
      // deriven la contraseña real; el texto plano es Admin123!).
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$u3+ATgL0lyWy+Pzbr8k51A$QQRGMsYtgYe7Df05flT7BFXgY6SxV37sTQCVk58n7RQ', must_change_password = FALSE WHERE username = '${USUARIO_ADMIN}';`,
      "-c",
      `UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$iAqxY4mnRJMM3mBszblO5w$xpVqxLvREUUH/YbFD8p7CyEcTGhzsxLHZxNGv98dcWw', must_change_password = TRUE WHERE username = 'est.perez';`,
    ],
    { stdio: "pipe" },
  );
}

/**
 * Restaura el estado base tras la corrida: admin con cambio obligatorio
 * (estado sembrado) y sin el usuario/organizaciones de prueba.
 */
function restaurarPanelAdmin(): void {
  execFileSync(
    "psql",
    [
      leerDatabaseUrl(),
      "-v",
      "ON_ERROR_STOP=1",
      // Primero el usuario (FK hacia organizations) y luego las orgs.
      "-c",
      `DELETE FROM users WHERE username LIKE '${PREFIJO_USUARIO}.%';`,
      "-c",
      `DELETE FROM organizations WHERE name LIKE '${PREFIJO_ORG}%';`,
      "-c",
      `UPDATE users SET must_change_password = TRUE WHERE username = '${USUARIO_ADMIN}';`,
    ],
    { stdio: "pipe" },
  );
}

test.beforeAll(() => {
  resetearPanelAdmin();
});

test.afterAll(() => {
  restaurarPanelAdmin();
});

test.beforeEach(async ({ context }) => {
  await limpiarSesion(context);
});

/**
 * Login con reintento si el throttler de login (5/min por IP) devuelve 429.
 *
 * @param page Página de Playwright del test.
 * @param usuario Usuario o correo del seed.
 * @param contrasena Contraseña real del seed.
 * @param destino Espera de URL tras el login (p. ej. el panel admin).
 */
async function loginConCooldown(
  page: Page,
  usuario: string,
  contrasena: string,
  destino: string,
): Promise<void> {
  await irALogin(page);
  await login(page, usuario, contrasena);
  try {
    await page.waitForURL(destino, { timeout: 10_000 });
  } catch {
    // 429 probable: espera la ventana de 1 min del throttler y reintenta.
    await page.waitForTimeout(62_000);
    await irALogin(page);
    await login(page, usuario, contrasena);
    await page.waitForURL(destino, { timeout: 30_000 });
  }
}

test("Panel admin: redirección de no-admin, altas con contraseña inicial y estados H5.2", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  const marca = Date.now();
  const orgPrimera = `${PREFIJO_ORG} Primera ${marca}`;
  const orgSegunda = `${PREFIJO_ORG} Segunda ${marca}`;
  const nombreUsuario = `${PREFIJO_USUARIO}.${marca}`;

  // ── 1) CA 3: un no-admin que abre /admin es redirigido a su panel
  await loginConCooldown(
    page,
    USUARIO_PROFESOR,
    CONTRASENA_PROFESOR,
    "**/teacher",
  );
  await page.goto("/admin");
  await page.waitForURL("**/teacher");

  // ── 2) Admin: hub → organizaciones (CA 4: estado de carga accesible)
  await limpiarSesion(context);
  await loginConCooldown(page, USUARIO_ADMIN, CONTRASENA_ADMIN, "**/admin");

  await page.getByTestId("link-admin-organizaciones").click();
  await page.waitForURL(/\/admin\/organizaciones$/);
  await expect(page.getByText(ESTADO_CARGA_ORG)).toBeVisible();

  // Formulario y listado reales (la carga ya se asertó arriba).
  await expect(page.getByTestId("form-organizacion")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("lista-organizaciones")).toBeVisible();

  // Crear la organización 1 (CA 1: alta válida aparece en el listado).
  await page.getByLabel("Nombre").fill(orgPrimera);
  await page.getByLabel("Ciudad (opcional)").fill("Cali");
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(page.getByText(MENSAJE_ORG_CREADA)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId("fila-organizacion").filter({ hasText: orgPrimera }),
  ).toBeVisible({ timeout: 15_000 });

  // Crear la organización 2 (servirá para el estado vacío del filtro).
  await page.getByLabel("Nombre").fill(orgSegunda);
  await page.getByRole("button", { name: "Crear organización" }).click();
  await expect(
    page.getByTestId("fila-organizacion").filter({ hasText: orgSegunda }),
  ).toBeVisible({ timeout: 15_000 });

  // ── 3) Usuarios: alta con contraseña inicial (CA 2)
  await page.goto("/admin/usuarios");
  await expect(page.getByTestId("form-usuario")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Organización", { exact: true }).selectOption({
    label: orgPrimera,
  });
  await page.getByLabel("Usuario", { exact: true }).fill(nombreUsuario);
  await page.getByLabel("Correo", { exact: true }).fill(`${nombreUsuario}@educoins.test`);
  await page.getByLabel("Nombre", { exact: true }).fill("Prueba");
  await page.getByLabel("Apellido", { exact: true }).fill("Panel");
  await page.getByRole("button", { name: "Crear usuario" }).click();

  // La contraseña inicial se informa UNA sola vez (raíz de la respuesta).
  const bloque = page.getByTestId("contrasena-inicial");
  await expect(bloque).toBeVisible({ timeout: 15_000 });
  const contrasena = (await bloque.textContent()) ?? "";
  expect(contrasena.trim().length).toBeGreaterThan(10);

  // El usuario nuevo aparece primero (orden created_at desc).
  await expect(
    page
      .getByTestId("fila-usuario")
      .first()
      .filter({ hasText: nombreUsuario }),
  ).toBeVisible({ timeout: 15_000 });

  // ── 4) Filtro por organización (CA 1/4)
  const filtro = page.getByTestId("filtro-organizacion");

  await filtro.selectOption({ label: orgPrimera });
  await expect(
    page.getByTestId("fila-usuario").filter({ hasText: nombreUsuario }),
  ).toBeVisible({ timeout: 15_000 });
  // Exclusión: los usuarios de otra organización no aparecen.
  await expect(page.getByText("Juan Pérez")).toHaveCount(0);

  // Organización sin usuarios → estado vacío de H5.2 (CA 4).
  await filtro.selectOption({ label: orgSegunda });
  await expect(page.getByText(TITULO_USUARIOS_VACIO_FILTRO)).toBeVisible({
    timeout: 15_000,
  });
});
