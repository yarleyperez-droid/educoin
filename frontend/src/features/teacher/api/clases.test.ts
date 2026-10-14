/**
 * Tests de la fachada de clases (T5.6.1, PRO-385).
 *
 * Cubren el plan §4: validación de `crearClase` (reglas de `CrearClaseDto`),
 * el shape devuelto por el mock (código de 8 caracteres, estado `active`),
 * unicidad de IDs/códigos y el catálogo que alimentará a T5.6.3.
 *
 * Entorno: Vitest en **node** (sin DOM, ver `vitest.config.mts`); el mock no
 * usa `fetch` todavía (T5.6.4 lo stubbeará cuando hable con la API real).
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  crearClase,
  LONGITUD_MAXIMA_NOMBRE,
  LONGITUD_MINIMA_NOMBRE,
} from "./clases";
import {
  generarCodigoUnico,
  listarClasesMock,
  LONGITUD_CODIGO,
} from "./clases-mock";

/** Nombre válido de ejemplo (≥ 8 caracteres). */
const NOMBRE_VALIDO = "Historia Universal 11B";

describe("crearClase", () => {
  it("crea una clase con nombre válido y devuelve su código de unión", async () => {
    const clase = await crearClase({ nombre: NOMBRE_VALIDO });

    expect(clase.nombre).toBe(NOMBRE_VALIDO);
    expect(clase.estado).toBe("active");
    expect(clase.codigo).toMatch(/^[A-Z0-9]{8}$/);
    expect(clase.id).not.toBe("");
    expect(clase.creadoEn).not.toBe("");
  });

  it("normaliza el nombre con trim antes de crear", async () => {
    const clase = await crearClase({ nombre: `   ${NOMBRE_VALIDO}   ` });

    expect(clase.nombre).toBe(NOMBRE_VALIDO);
  });

  it("rechaza un nombre con menos de 8 caracteres con ApiError 422", async () => {
    const nombreCorto = "A".repeat(LONGITUD_MINIMA_NOMBRE - 1);

    await expect(crearClase({ nombre: nombreCorto })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });

    await expect(crearClase({ nombre: nombreCorto })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("acepta un nombre de exactamente el mínimo (8 caracteres)", async () => {
    const nombreJusto = "A".repeat(LONGITUD_MINIMA_NOMBRE);

    const clase = await crearClase({ nombre: nombreJusto });

    expect(clase.nombre).toBe(nombreJusto);
  });

  it("rechaza un nombre vacío con ApiError 422", async () => {
    const intento = crearClase({ nombre: "   " });

    await expect(intento).rejects.toBeInstanceOf(ApiError);
    await expect(crearClase({ nombre: "" })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("rechaza un nombre con más de 150 caracteres con ApiError 422", async () => {
    const nombreLargo = "A".repeat(LONGITUD_MAXIMA_NOMBRE + 1);

    await expect(crearClase({ nombre: nombreLargo })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });
  });

  it("crea clases con IDs y códigos distintos (sin colisiones)", async () => {
    const [primera, segunda] = await Promise.all([
      crearClase({ nombre: "Química General 10A" }),
      crearClase({ nombre: "Química General 10B" }),
    ]);

    expect(primera.id).not.toBe(segunda.id);
    expect(primera.codigo).not.toBe(segunda.codigo);
  });

  it("registra la clase creada en el catálogo (andamio para T5.6.3)", async () => {
    const creada = await crearClase({ nombre: "Física Aplicada 12A" });

    const nombres = listarClasesMock().map((clase) => clase.nombre);

    expect(nombres).toContain(creada.nombre);
    expect(nombres).toContain("Mathematics 10A"); // clase seed del mock
  });
});

describe("generarCodigoUnico", () => {
  it("genera códigos de 8 caracteres alfanuméricos en mayúscula", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generarCodigoUnico()).toMatch(/^[A-Z0-9]{8}$/);
      expect(generarCodigoUnico().length).toBe(LONGITUD_CODIGO);
    }
  });
});
