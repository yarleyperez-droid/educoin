// @vitest-environment jsdom
/**
 * Tests del preview de fórmulas del panel docente
 * (`features/teacher/componentes/texto-matematico.tsx`).
 *
 * Cubren el contrato visual del preview KaTeX en el editor de preguntas:
 * - Texto sin fórmulas → se pinta tal cual (React escapa HTML).
 * - `$…$` → el segmento sale renderizado por KaTeX (`.katex`).
 * - HTML hostil en el texto plano **no** se interpreta (XSS).
 * - `contieneFormulas` decide si el editor muestra el preview.
 *
 * La política de saneado y las utilidades ya tienen sus propios tests en
 * `features/estudiante/util/formulas.test.ts`; aquí se prueba el puente
 * componente → utilidad.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { contieneFormulas, TextoMatematico } from "./texto-matematico";

afterEach(cleanup);

describe("TextoMatematico", () => {
  it("pinta el texto plano sin fórmulas", () => {
    render(<TextoMatematico texto="¿Cuánto es 2 + 2?" />);

    expect(screen.getByText("¿Cuánto es 2 + 2?")).toBeDefined();
  });

  it("renderiza la fórmula $…$ con KaTeX", () => {
    const { container } = render(
      <TextoMatematico texto="Resuelve $x^2 + 1 = 0$" />,
    );

    // KaTeX envuelve cada fórmula en un elemento con clase `katex`.
    expect(container.querySelector(".katex")).not.toBeNull();
    // El texto que rodea la fórmula sigue pintándose como texto normal.
    expect(container.textContent).toContain("Resuelve");
  });

  it("renderiza varias fórmulas del mismo texto", () => {
    const { container } = render(
      <TextoMatematico texto="Si $a=2$ y $b=3$, ¿cuál es $a+b$?" />,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(3);
  });

  it("no interpreta HTML hostil escrito en el texto plano", () => {
    const { container } = render(
      <TextoMatematico texto={'<img src=x onerror="alert(1)">' } />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("pinta el LaTeX inválido como texto de error, sin lanzar", () => {
    const { container } = render(<TextoMatematico texto={'$\\frac{1$'} />);

    // KaTeX con throwOnError:false pinta el error ya escapado (no lanza).
    expect(container.querySelector(".katex-error, .katex")).not.toBeNull();
  });
});

describe("contieneFormulas", () => {
  it("detecta un par de delimitadores $…$", () => {
    expect(contieneFormulas("El área es $\\pi r^2$")).toBe(true);
  });

  it("devuelve false para texto sin delimitadores", () => {
    expect(contieneFormulas("Pregunta sin matemáticas")).toBe(false);
  });

  it("devuelve false para un $ sin cerrar (se trata como texto)", () => {
    expect(contieneFormulas("Precio: 5$ y más texto")).toBe(false);
  });

  it("devuelve false para texto vacío", () => {
    expect(contieneFormulas("")).toBe(false);
  });
});
