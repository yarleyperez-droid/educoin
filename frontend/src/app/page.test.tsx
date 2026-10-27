// @vitest-environment jsdom
/**
 * Tests de la landing pública (`/`).
 *
 * Verifican que la página renderiza las secciones clave del mockup (hero,
 * ciclo de valor, pilares, comparativa del ranking y CTA final), que el nav
 * enlaza a las anclas correctas y que el botón "Contactar Coordinación
 * Académica" (visual, sin cablear) está presente.
 *
 * También verifican los ajustes de contenido: sin barra de estadísticas (la
 * app aún no está lanzada), sin botón "Crear Cuenta" (las cuentas las crea el
 * administrador), sin menciones de inflación ni equivalencias con décimas de
 * nota, y con ventajas reales bajo el CTA final.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

// `next/link` necesita el runtime de App Router para navegar; en el test solo
// interesa el render, así que se sustituye por un ancla plana.
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

afterEach(cleanup);

describe("Landing pública (page.tsx)", () => {
  it("renderiza el hero con un único h1", () => {
    render(<Home />);

    const titulosPrincipales = screen.getAllByRole("heading", { level: 1 });
    expect(titulosPrincipales).toHaveLength(1);
    expect(titulosPrincipales[0].textContent).toContain(
      "Transforma el esfuerzo académico en valor tangible.",
    );
  });

  it("incluye las secciones clave del mockup", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        name: "El Ciclo de Valor Escolar en 4 Pasos",
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", {
        name: "Los 2 Pilares del Ecosistema EduCoins",
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", {
        name: "La Regla Psicológica del Ranking Justo",
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", {
        name: "¿Tu institución quiere adoptar EduCoins?",
      }),
    ).toBeDefined();
  });

  it("el nav enlaza a las anclas de las secciones", () => {
    render(<Home />);

    expect(
      screen.getByRole("link", { name: "Cómo Funciona" }).getAttribute("href"),
    ).toBe("#como-funciona");
    expect(
      screen
        .getByRole("link", { name: "Ecosistema Pedagógico" })
        .getAttribute("href"),
    ).toBe("#ecosistema");
    expect(
      screen
        .getByRole("link", { name: "Billetera y Ledger" })
        .getAttribute("href"),
    ).toBe("#billetera-y-ledger");
    expect(
      screen.getByRole("link", { name: "Tienda de Aula" }).getAttribute("href"),
    ).toBe("#tienda-de-aula");
    expect(
      screen.getByRole("link", { name: "Instituciones" }).getAttribute("href"),
    ).toBe("#instituciones");
  });

  it("no muestra cifras de adopción ni menciones de inflación", () => {
    render(<Home />);

    // La barra de estadísticas se eliminó: la app aún no está lanzada.
    expect(screen.queryByText("+45")).toBeNull();
    expect(screen.queryByText("12.000+")).toBeNull();
    expect(screen.queryByText("98,4%")).toBeNull();
    expect(screen.queryByText("Colegios Activos")).toBeNull();
    expect(screen.queryByText("Alumnos Matriculados")).toBeNull();

    // Sin equivalencias con décimas de nota ni promesas anti-inflación.
    expect(screen.queryByText(/inflaci/i)).toBeNull();
    expect(screen.queryByText(/0,5 puntos/)).toBeNull();
  });

  it("no ofrece registro público: sin botón Crear Cuenta", () => {
    render(<Home />);

    expect(screen.queryByRole("link", { name: "Crear Cuenta" })).toBeNull();

    // La cabecera conserva los accesos de demo e inicio de sesión.
    expect(
      screen.getByRole("link", { name: "Ver Demo Estudiante" }),
    ).toBeDefined();
    expect(
      screen.getAllByRole("link", { name: "Iniciar Sesión" }).length,
    ).toBeGreaterThan(0);
  });

  it("muestra ventajas reales de la plataforma bajo el CTA final", () => {
    render(<Home />);

    expect(
      screen.getByText("Acreditación automática del esfuerzo verificable"),
    ).toBeDefined();
    expect(
      screen.getByText("Billetera digital y ranking justo para cada clase"),
    ).toBeDefined();
    expect(
      screen.getByText("Tienda de recompensas con canje de monedas"),
    ).toBeDefined();

    // Las condiciones de activación inventadas se sustituyeron.
    expect(
      screen.queryByText("Activación en 24 horas por sesión"),
    ).toBeNull();
    expect(
      screen.queryByText("Migración desde Google Classroom y Moodle"),
    ).toBeNull();
    expect(screen.queryByText("Capacitación docente incluida")).toBeNull();
  });

  it("orienta el CTA final a la adopción institucional", () => {
    render(<Home />);

    expect(
      screen.getByText(/Solicita una demo para tu centro/),
    ).toBeDefined();
  });

  it("ofrece el botón de contacto con coordinación académica", () => {
    render(<Home />);

    expect(
      screen.getByRole("button", {
        name: "Contactar Coordinación Académica",
      }),
    ).toBeDefined();
  });

  it("enlaza los CTAs principales hacia el inicio de sesión", () => {
    render(<Home />);

    const ctaHero = screen.getByRole("link", {
      name: "Iniciar Sesión en mi Colegio",
    });
    expect(ctaHero.getAttribute("href")).toBe("/login");

    // "Iniciar Sesión" aparece en la cabecera y en el CTA final (el nombre
    // se compara completo, así que no coincide con "Iniciar Sesión en mi
    // Colegio").
    const ctaSesion = screen.getAllByRole("link", { name: "Iniciar Sesión" });
    expect(ctaSesion.length).toBeGreaterThanOrEqual(2);
    for (const enlace of ctaSesion) {
      expect(enlace.getAttribute("href")).toBe("/login");
    }
  });
});
