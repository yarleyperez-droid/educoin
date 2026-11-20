/**
 * Tests de la agregación mensual de ganancias (gráfica "Mi Progreso").
 *
 * Entorno: Vitest en node; solo se ejercita la capa pura.
 */

import { describe, expect, it } from "vitest";

import {
  resumenMensualGanancias,
  tendenciaMensual,
} from "./grafica-progreso";
import type { MovimientoBilletera } from "../contrato/billetera";

function movimiento(
  tipo: MovimientoBilletera["tipo"],
  cantidad: number,
  creadoEn: string,
): MovimientoBilletera {
  return {
    id: creadoEn,
    tipo,
    cantidad,
    descripcion: null,
    claseId: "1",
    claseNombre: "Clase",
    creadoEn,
  };
}

describe("resumenMensualGanancias", () => {
  const ahora = new Date(2026, 10, 20); // 20 nov 2026

  it("devuelve un mes por barra, del más antiguo al actual", () => {
    const barras = resumenMensualGanancias([], 5, ahora);

    expect(barras.map((barra) => barra.mes)).toEqual([
      "Jul",
      "Ago",
      "Sep",
      "Oct",
      "Nov",
    ]);
    expect(barras.every((barra) => barra.valor === 0)).toBe(true);
    expect(barras[4]?.activa).toBe(true);
  });

  it("suma solo los `earning` dentro del período", () => {
    const barras = resumenMensualGanancias(
      [
        movimiento("earning", 30, "2026-11-02T10:00:00.000Z"),
        movimiento("earning", 20, "2026-11-15T10:00:00.000Z"),
        movimiento("spending", -50, "2026-11-16T10:00:00.000Z"),
        movimiento("reversal", 50, "2026-11-17T10:00:00.000Z"),
        movimiento("earning", 99, "2026-01-01T10:00:00.000Z"),
      ],
      5,
      ahora,
    );

    expect(barras[4]?.valor).toBe(50);
    expect(barras.reduce((total, barra) => total + barra.valor, 0)).toBe(50);
  });

  it("ignora fechas inválidas", () => {
    const barras = resumenMensualGanancias(
      [movimiento("earning", 10, "no-es-fecha")],
      2,
      ahora,
    );

    expect(barras.every((barra) => barra.valor === 0)).toBe(true);
  });
});

describe("tendenciaMensual", () => {
  const base = { mes: "X", activa: false };

  it("calcula la variación frente al mes anterior", () => {
    expect(
      tendenciaMensual([
        { ...base, valor: 100 },
        { ...base, valor: 124 },
      ]),
    ).toBe(24);
  });

  it("devuelve null sin base de comparación", () => {
    expect(tendenciaMensual([{ ...base, valor: 10 }])).toBeNull();
    expect(
      tendenciaMensual([
        { ...base, valor: 0 },
        { ...base, valor: 10 },
      ]),
    ).toBeNull();
  });
});
