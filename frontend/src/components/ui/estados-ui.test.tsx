// @vitest-environment jsdom
/**
 * Tests de los estados base del kit UI (H5.2 / PRO-283, T5.2.1 / PRO-369).
 *
 * Verifican la semántica accesible que exigen los CA: `role="status"` +
 * `aria-live="polite"` en la carga (con el spinner oculto para lectores),
 * `role="alert"` en el error y la **acción sugerida** del estado vacío
 * (CA 1 y CA 2).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstadoCarga } from "./estado-carga";
import { EstadoError } from "./estado-error";
import { EstadoVacio } from "./estado-vacio";

afterEach(cleanup);

describe("EstadoCarga (CA 1)", () => {
  it("anuncia la carga con role=status y aria-live=polite", () => {
    render(<EstadoCarga />);
    const region = screen.getByRole("status");

    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Cargando…");
  });

  it("mantiene el spinner oculto para los lectores de pantalla", () => {
    const { container } = render(<EstadoCarga />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("permite personalizar el texto anunciado", () => {
    render(<EstadoCarga mensaje="Verificando tus credenciales…" />);

    expect(screen.getByRole("status").textContent).toBe(
      "Verificando tus credenciales…",
    );
  });
});

describe("EstadoVacio (CA 2)", () => {
  it("muestra el título, la descripción y la acción sugerida", () => {
    render(
      <EstadoVacio
        titulo="Aún no hay clases"
        descripcion="Publica tu primera clase para empezar."
        accion={{ texto: "Crear clase", alHacerClic: () => undefined }}
      />,
    );

    expect(screen.getByText("Aún no hay clases")).toBeDefined();
    expect(
      screen.getByText("Publica tu primera clase para empezar."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Crear clase" }),
    ).toBeDefined();
  });

  it("el clic en la acción sugerida invoca el callback", () => {
    const alHacerClic = vi.fn();
    render(
      <EstadoVacio
        titulo="Sin resultados"
        accion={{ texto: "Limpiar búsqueda", alHacerClic }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(alHacerClic).toHaveBeenCalledTimes(1);
  });

  it("sin acción sugerida no renderiza botones", () => {
    const { container } = render(<EstadoVacio titulo="Nada por aquí" />);

    expect(container.querySelector("button")).toBeNull();
  });
});

describe("EstadoError (CA 2 · mensaje de H5.1)", () => {
  it("expone role=alert con el mensaje recibido", () => {
    render(<EstadoError mensaje="El usuario o la contraseña son erróneos." />);

    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toBe("El usuario o la contraseña son erróneos.");
  });

  it("muestra el reintento solo cuando se pasa el callback", () => {
    const { rerender } = render(<EstadoError mensaje="Falló" />);
    expect(screen.queryByRole("button")).toBeNull();

    const alReintentar = vi.fn();
    rerender(<EstadoError mensaje="Falló" alReintentar={alReintentar} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(alReintentar).toHaveBeenCalledTimes(1);
  });
});
