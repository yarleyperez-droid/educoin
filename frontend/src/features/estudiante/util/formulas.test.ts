/**
 * Tests de los helpers de fórmulas (T5.8.1, PRO-394).
 *
 * Cubren el plan §4: segmentación de delimitadores, render seguro de
 * KaTeX y — sobre todo — la **política de saneado**: payloads maliciosos
 * (`<script>`, `\href` con `javascript:`) y LaTeX inválido no deben
 * producir HTML ejecutable ni excepciones.
 *
 * Entorno: Vitest en node (sin DOM); KaTeX no necesita navegador.
 */

import { describe, expect, it } from "vitest";

import {
  escapearHtml,
  partirTextoYFormulas,
  renderizarFormula,
} from "./formulas";

describe("partirTextoYFormulas", () => {
  it("extrae una fórmula entre $…$", () => {
    const segmentos = partirTextoYFormulas("$\\frac{1}{2}$");

    expect(segmentos).toEqual([
      { tipo: "formula", valor: "\\frac{1}{2}" },
    ]);
  });

  it("mezcla texto y fórmulas en orden", () => {
    const segmentos = partirTextoYFormulas("Calcula $x^2$ y suma 2");

    expect(segmentos).toHaveLength(3);
    expect(segmentos[0]).toEqual({ tipo: "texto", valor: "Calcula " });
    expect(segmentos[1]).toEqual({ tipo: "formula", valor: "x^2" });
    expect(segmentos[2]).toEqual({ tipo: "texto", valor: " y suma 2" });
  });

  it("sin $ devuelve un solo segmento de texto con el original", () => {
    const texto = "<script>alert(1)</script>";
    const segmentos = partirTextoYFormulas(texto);

    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].tipo).toBe("texto");
    // El helper NO genera HTML: el texto crudo queda para que lo escape React.
    expect(segmentos[0]).toEqual({ tipo: "texto", valor: texto });
  });

  it("un $ sin cerrar se trata como texto (no rompe)", () => {
    const segmentos = partirTextoYFormulas("Precio: $ 100");

    expect(segmentos).toEqual([{ tipo: "texto", valor: "Precio: $ 100" }]);
  });

  it("texto vacío produce ningún segmento", () => {
    expect(partirTextoYFormulas("")).toEqual([]);
  });
});

describe("renderizarFormula", () => {
  it("renderiza LaTeX válido a HTML de KaTeX", () => {
    const html = renderizarFormula("\\frac{1}{2}");

    expect(html).toContain('class="katex"');
    // El código LaTeX crudo con barra invertida no aparece en el HTML.
    expect(html).not.toContain("\\frac");
  });

  it("bloquea \\href con javascript: (trust: false)", () => {
    const html = renderizarFormula("\\href{javascript:alert(1)}{x}");

    // KaTeX en modo no confiable no genera el hipervinculo.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<a ");
    expect(typeof html).toBe("string");
  });

  it("LaTeX inválido no lanza y devuelve HTML (throwOnError: false)", () => {
    expect(() => renderizarFormula("\\frac{1}")).not.toThrow();

    const html = renderizarFormula("\\frac{1}");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    // Nunca devuelve HTML sin escapar del usuario.
    expect(html).not.toContain("<script");
  });

  it("contenido malicioso dentro de la fórmula no escapa como HTML", () => {
    const html = renderizarFormula("x} <script>alert(1)</script>");

    expect(html).not.toContain("<script>");
  });
});

describe("escapearHtml", () => {
  it("escapa los caracteres especiales de HTML", () => {
    expect(escapearHtml('<a href="x">&\'</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
});
