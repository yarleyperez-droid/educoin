/**
 * Tests de la línea de tiempo de trazabilidad (H10.4 / T10.4.2).
 *
 * Cubren la **capa pura** compartida por "Mis canjes" (estudiante) y la
 * cola del profesor: la construcción de las etapas
 * `solicitado → resuelto → entregado` para los seis valores de
 * `redemption_status` y el texto de fechas/estados vacíos.
 *
 * Entorno: Vitest en **node** (sin DOM); no se renderiza el componente,
 * solo se ejercitan las funciones exportadas (mismo criterio que
 * `badge-estado-canje.test.ts`).
 */

import { describe, expect, it } from "vitest";

import { etapasDeCanje, textoDeEtapa } from "./linea-tiempo-canje";
import type { CanjeListado, EstadoCanje } from "../contrato/canje";

/** Fila base del listado, ajustable por prueba. */
function fila(estado: EstadoCanje, ajustes: Partial<CanjeListado> = {}): CanjeListado {
  return {
    id: "42",
    nombreEstudiante: "Ana Pérez",
    nombreItem: "Trivia game in class",
    costoMonedas: 30,
    estado,
    solicitadoEn: "2026-10-15T12:00:00.000Z",
    resueltoPor: null,
    resueltoEn: null,
    ...ajustes,
  };
}

describe("etapasDeCanje", () => {
  it("un canje pending solo tiene completado el paso Solicitado", () => {
    const etapas = etapasDeCanje(fila("pending"));

    expect(etapas.map((etapa) => etapa.etiqueta)).toEqual([
      "Solicitado",
      "Resuelto",
      "Entregado",
    ]);
    expect(etapas[0]).toMatchObject({ estado: "completada", fecha: "2026-10-15T12:00:00.000Z" });
    expect(etapas[1]).toMatchObject({ estado: "pendiente", fecha: null, detalle: null });
    expect(etapas[2]).toMatchObject({ estado: "pendiente", fecha: null, detalle: null });
  });

  it("un canje approved muestra el resolvente y su fecha, sin entrega", () => {
    const etapas = etapasDeCanje(
      fila("approved", {
        resueltoPor: "Paula Cano",
        resueltoEn: "2026-10-16T08:45:00.000Z",
      }),
    );

    expect(etapas[1]).toMatchObject({
      estado: "completada",
      fecha: "2026-10-16T08:45:00.000Z",
      detalle: "Paula Cano",
    });
    expect(etapas[2]).toMatchObject({ estado: "pendiente" });
  });

  it("un canje delivered marca la entrega, aunque la BD no registre su fecha", () => {
    // §3.2 fila 2: approved → delivered no escribe fecha.
    const etapas = etapasDeCanje(
      fila("delivered", {
        resueltoPor: "Paula Cano",
        resueltoEn: "2026-10-16T08:45:00.000Z",
      }),
    );

    expect(etapas[1]).toMatchObject({ estado: "completada", detalle: "Paula Cano" });
    expect(etapas[2]).toMatchObject({
      estado: "completada",
      fecha: null,
      detalle: "Confirmado por el profesor",
    });
  });

  it("un canje rejected marca la entrega como no aplica", () => {
    const etapas = etapasDeCanje(
      fila("rejected", {
        resueltoPor: "Paula Cano",
        resueltoEn: "2026-10-16T08:45:00.000Z",
      }),
    );

    expect(etapas[1]).toMatchObject({ estado: "completada", detalle: "Paula Cano" });
    expect(etapas[2]).toMatchObject({
      estado: "no-aplica",
      detalle: "Rechazado, monedas devueltas",
    });
  });

  it("los legados completed/reversed del MVP no inventan fechas de resolución", () => {
    const completado = etapasDeCanje(fila("completed"));
    expect(completado[1]).toMatchObject({
      estado: "completada",
      fecha: null,
      detalle: "Flujo instantáneo (legado)",
    });
    // La entrega inmediata sí tiene fecha: la de la propia solicitud.
    expect(completado[2]).toMatchObject({
      estado: "completada",
      fecha: "2026-10-15T12:00:00.000Z",
    });

    const anulado = etapasDeCanje(fila("reversed"));
    expect(anulado[1]).toMatchObject({
      estado: "completada",
      fecha: null,
      detalle: "Anulado por el estudiante (legado)",
    });
    expect(anulado[2]).toMatchObject({
      estado: "no-aplica",
      detalle: "Anulado, monedas devueltas",
    });
  });

  it("un canje resuelto sin resolvente conocido lo indica como sistema", () => {
    const etapas = etapasDeCanje(
      fila("approved", { resueltoEn: "2026-10-16T08:45:00.000Z" }),
    );

    expect(etapas[1]?.detalle).toBe("Resuelto por el sistema");
  });
});

describe("textoDeEtapa", () => {
  it("fechas en formato local para etapas completadas", () => {
    const texto = textoDeEtapa({
      etiqueta: "Solicitado",
      estado: "completada",
      fecha: "2026-10-15T12:00:00.000Z",
      detalle: null,
    });

    // Formato LOCAL (es-CO): nunca el ISO crudo del backend, y coincide con
    // lo que Intl produce en esta máquina (la zona horaria varía por entorno).
    expect(texto).not.toBe("2026-10-15T12:00:00.000Z");
    expect(texto).toBe(
      new Intl.DateTimeFormat("es-CO", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date("2026-10-15T12:00:00.000Z")),
    );
  });

  it("estados vacíos legibles: pendiente, no aplica y sin fecha registrada", () => {
    expect(
      textoDeEtapa({ etiqueta: "Resuelto", estado: "pendiente", fecha: null, detalle: null }),
    ).toBe("Pendiente");
    expect(
      textoDeEtapa({ etiqueta: "Entregado", estado: "no-aplica", fecha: null, detalle: null }),
    ).toBe("No aplica");
    expect(
      textoDeEtapa({
        etiqueta: "Entregado",
        estado: "completada",
        fecha: null,
        detalle: null,
      }),
    ).toBe("Sin fecha registrada");
  });
});
