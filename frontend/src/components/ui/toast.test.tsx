// @vitest-environment jsdom
/**
 * Tests del toast accesible (H5.2 / PRO-283, T5.2.2 / PRO-370).
 *
 * Cubren el helper de traducción de errores de H5.1 y el CA 3: el aviso se
 * anuncia vía `aria-live` (polite en éxito, assertive + role="alert" en
 * error), se auto-oculta a los 3000 ms y los avisos consecutivos reemplazan
 * al anterior (una sola región).
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  MENSAJE_ERROR_GENERICO,
  ProveedorToast,
  mensajeDeErrorApi,
  useToast,
} from "./toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

/** Botones que disparan avisos de prueba dentro del proveedor. */
function Disparador(): React.ReactElement {
  const { mostrar } = useToast();
  return (
    <div>
      <button type="button" onClick={() => mostrar("Guardado con éxito", "exito")}>
        éxito
      </button>
      <button type="button" onClick={() => mostrar("El usuario o la contraseña son erróneos.", "error")}>
        error
      </button>
      <button type="button" onClick={() => mostrar("primer aviso", "error")}>
        uno
      </button>
      <button type="button" onClick={() => mostrar("segundo aviso", "error")}>
        dos
      </button>
    </div>
  );
}

/** Renderiza el proveedor con el disparador de prueba. */
function montar(): void {
  render(
    <ProveedorToast>
      <Disparador />
    </ProveedorToast>,
  );
}

describe("mensajeDeErrorApi (traducción de H5.1)", () => {
  it("devuelve el mensaje legible de un ApiError", () => {
    const error = new ApiError("El usuario o la contraseña son erróneos.", 401);

    expect(mensajeDeErrorApi(error)).toBe(
      "El usuario o la contraseña son erróneos.",
    );
  });

  it("devuelve el mensaje genérico para errores ajenos a la API", () => {
    expect(mensajeDeErrorApi(new Error("boom interno"))).toBe(
      MENSAJE_ERROR_GENERICO,
    );
    expect(mensajeDeErrorApi("cadena raruna")).toBe(MENSAJE_ERROR_GENERICO);
  });
});

describe("toast accesible (CA 3)", () => {
  it("anuncia el éxito en una región aria-live=polite", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));

    const aviso = screen.getByText("Guardado con éxito");
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    expect(aviso.getAttribute("role")).toBe("status");
  });

  it("anuncia el error con role=alert y aria-live=assertive", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "error" }));

    const aviso = screen.getByRole("alert");
    expect(aviso.getAttribute("aria-live")).toBe("assertive");
    expect(aviso.textContent).toBe(
      "El usuario o la contraseña son erróneos.",
    );
  });

  it("se auto-oculta a los 3000 ms", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "éxito" }));
    expect(screen.queryByText("Guardado con éxito")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Guardado con éxito")).toBeNull();
  });

  it("los avisos consecutivos reemplazan al anterior (una sola región)", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "uno" }));
    fireEvent.click(screen.getByRole("button", { name: "dos" }));

    expect(screen.queryByText("primer aviso")).toBeNull();
    expect(screen.getByText("segundo aviso")).toBeDefined();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
