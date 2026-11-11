/**
 * Tests de la presentación de estados de canje (H7.3 / T7.3.4).
 *
 * Cubren la **capa pura** que comparten "Mis canjes" (estudiante) y la
 * cola del profesor: la etiqueta en español de cada valor de
 * `redemption_status` y el texto del costo, que hace explícito si las
 * monedas están reservadas, devueltas o forman parte del gasto
 * definitivo (criterios de aceptación 2 y 3 de PRO-449).
 *
 * Entorno: Vitest en **node** (sin DOM); no se renderiza el componente,
 * solo se ejercitan las funciones exportadas.
 */

import { describe, expect, it } from "vitest";

import {
  etiquetaEstadoCanje,
  textoCostoCanje,
} from "./badge-estado-canje";
import type { EstadoCanje } from "../contrato/canje";

describe("etiquetaEstadoCanje", () => {
  it("traduce los seis estados de redemption_status al español", () => {
    const esperado: Record<EstadoCanje, string> = {
      pending: "Pendiente de aprobación",
      approved: "Aprobado, pendiente de entrega",
      delivered: "Entregado",
      rejected: "Rechazado, monedas devueltas",
      completed: "Completado",
      reversed: "Anulado, monedas devueltas",
    };

    for (const [estado, etiqueta] of Object.entries(esperado)) {
      expect(etiquetaEstadoCanje(estado as EstadoCanje)).toBe(etiqueta);
    }
  });
});

describe("textoCostoCanje", () => {
  it("marca las monedas como reservadas mientras el canje no se resuelve", () => {
    expect(textoCostoCanje("pending", 30)).toBe("30 monedas reservadas");
    expect(textoCostoCanje("approved", 30)).toBe("30 monedas reservadas");
  });

  it("marca las monedas como devueltas en un rechazo o anulación", () => {
    expect(textoCostoCanje("rejected", 30)).toBe("30 monedas devueltas");
    expect(textoCostoCanje("reversed", 30)).toBe("30 monedas devueltas");
  });

  it("deja el costo como gasto definitivo cuando el canje se entregó", () => {
    expect(textoCostoCanje("delivered", 30)).toBe("30 monedas");
    expect(textoCostoCanje("completed", 30)).toBe("30 monedas");
  });

  it("usa el costo congelado que recibe, sin recalcularlo", () => {
    expect(textoCostoCanje("pending", 0)).toBe("0 monedas reservadas");
    expect(textoCostoCanje("delivered", 115)).toBe("115 monedas");
  });
});
