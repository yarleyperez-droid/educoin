// @vitest-environment jsdom
/**
 * Tests del modal del kit UI: el foco solo se mueve al abrir.
 *
 * Regresión: un `alCerrar` inline cambia de identidad en cada render; si el
 * efecto que enfoca el diálogo depende de él, el foco se roba al escribir en
 * los inputs del formulario (el cursor "salta" en la tienda del profesor).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "./modal";

/** Formulario controlado con `alCerrar` inline (nuevo en cada render). */
function Formulario({ alCerrar }: { alCerrar: () => void }) {
  const [nombre, setNombre] = useState("");

  return (
    <Modal abierto titulo="Publicar artículo" alCerrar={() => alCerrar()}>
      <input
        aria-label="Nombre"
        value={nombre}
        onChange={(evento) => setNombre(evento.target.value)}
      />
    </Modal>
  );
}

describe("Modal", () => {
  it("no roba el foco del input al escribir", () => {
    render(<Formulario alCerrar={() => undefined} />);
    const input = screen.getByLabelText("Nombre");

    input.focus();
    fireEvent.change(input, { target: { value: "Bono" } });

    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Bono");
  });

  it("sigue cerrando con Escape aunque `alCerrar` cambie", () => {
    const primero = vi.fn();
    const segundo = vi.fn();
    const { rerender } = render(<Formulario alCerrar={primero} />);
    rerender(<Formulario alCerrar={segundo} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(primero).not.toHaveBeenCalled();
  });
});
