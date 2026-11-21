// @vitest-environment jsdom
/**
 * Tests de la cabecera pública (`CabeceraLanding`).
 *
 * Verifican el comportamiento de los enlaces de sección según la ruta actual
 * (decidida por `usePathname`):
 * - En la landing (`/`): son anclas locales `#id` con scroll en la misma
 *   página (comportamiento original del mockup).
 * - Fuera de la landing (p. ej. `/login`, donde también se reutiliza la
 *   cabecera): navegan de vuelta a la landing con `/#id`.
 *
 * También comprueban que la cabecera conserva los accesos de sesión hacia
 * `/login` y que no ofrece registro público ("Crear Cuenta").
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Ruta simulada para `usePathname`; el prefijo `mock` permite que el factory
// de `vi.mock` la lea (hoisting de Vitest).
let mockRuta = "/login";

// `next/link` necesita el runtime de App Router para navegar; en el test solo
// interesa el `href`, así que se sustituye por un ancla plana.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...resto
  }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockRuta,
}));

import { CabeceraLanding } from "./cabecera-landing";

afterEach(cleanup);

describe("Cabecera pública (cabecera-landing.tsx)", () => {
  it("en la landing, los enlaces de sección son anclas locales", () => {
    mockRuta = "/";
    render(<CabeceraLanding />);

    expect(
      screen.getByRole("link", { name: "Cómo Funciona" }).getAttribute("href"),
    ).toBe("#como-funciona");
    expect(
      screen
        .getByRole("link", { name: "Tienda de Aula" })
        .getAttribute("href"),
    ).toBe("#tienda-de-aula");
  });

  it("fuera de la landing (p. ej. /login), los enlaces de sección vuelven a la landing (/#id)", () => {
    mockRuta = "/login";
    render(<CabeceraLanding />);

    expect(
      screen.getByRole("link", { name: "Cómo Funciona" }).getAttribute("href"),
    ).toBe("/#como-funciona");
    expect(
      screen
        .getByRole("link", { name: "Ecosistema Pedagógico" })
        .getAttribute("href"),
    ).toBe("/#ecosistema");
    expect(
      screen
        .getByRole("link", { name: "Billetera y Ledger" })
        .getAttribute("href"),
    ).toBe("/#billetera-y-ledger");
    expect(
      screen.getByRole("link", { name: "Tienda de Aula" }).getAttribute("href"),
    ).toBe("/#tienda-de-aula");
    expect(
      screen.getByRole("link", { name: "Instituciones" }).getAttribute("href"),
    ).toBe("/#instituciones");
  });

  it("conserva la marca enlazando al inicio y los accesos de sesión hacia /login", () => {
    mockRuta = "/login";
    render(<CabeceraLanding />);

    expect(
      screen.getByRole("link", { name: /EduCoins/ }).getAttribute("href"),
    ).toBe("/");

    for (const enlace of screen.getAllByRole("link", {
      name: "Iniciar Sesión",
    })) {
      expect(enlace.getAttribute("href")).toBe("/login");
    }
    expect(
      screen.getByRole("link", { name: "Ver Demo Estudiante" }).getAttribute("href"),
    ).toBe("/login");
  });

  it("no ofrece registro público: sin botón Crear Cuenta", () => {
    mockRuta = "/login";
    render(<CabeceraLanding />);

    expect(screen.queryByRole("link", { name: "Crear Cuenta" })).toBeNull();
  });
});
