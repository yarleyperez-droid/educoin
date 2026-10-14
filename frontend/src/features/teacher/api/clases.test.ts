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
  actualizarClase,
  crearClase,
  buscarClases,
  LONGITUD_MAXIMA_NOMBRE,
  LONGITUD_MINIMA_NOMBRE,
  obtenerClase,
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

describe("buscarClases", () => {
  it("rechaza búsquedas de menos de 3 caracteres con ApiError 422", async () => {
    await expect(buscarClases("ma")).rejects.toBeInstanceOf(ApiError);
    await expect(buscarClases("ma")).rejects.toMatchObject({ status: 422 });
    await expect(buscarClases("   ")).rejects.toMatchObject({ status: 422 });
  });

  it("encuentra clases por subcadena y devuelve { data, meta } sin código", async () => {
    const resultado = await buscarClases("Mathematics");

    expect(resultado.meta.total).toBeGreaterThanOrEqual(1);
    expect(resultado.data[0].nombre).toBe("Mathematics 10A");
    expect(resultado.data[0].estado).toBe("active");
    expect(resultado.data[0].profesorNombre).not.toBe("");
    // ClaseListadoDto no expone el código de unión (decisión del backend).
    expect(resultado.data[0]).not.toHaveProperty("codigo");
  });

  it("devuelve meta de paginación coherente (página 1)", async () => {
    const resultado = await buscarClases("Universal", 1, 50);

    expect(resultado.meta.page).toBe(1);
    expect(resultado.meta.limit).toBe(50);
    expect(resultado.data.length).toBeLessThanOrEqual(50);
  });
});

describe("obtenerClase", () => {
  it("devuelve la clase creada por su id", async () => {
    const creada = await crearClase({ nombre: "Biología General 11A" });

    const encontrada = obtenerClase(creada.id);

    expect(encontrada).not.toBeNull();
    expect(encontrada?.id).toBe(creada.id);
    expect(encontrada?.codigo).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("devuelve null para un id inexistente", () => {
    expect(obtenerClase("no-existe")).toBeNull();
  });
});

describe("actualizarClase", () => {
  it("rechaza un parche sin ningún campo con ApiError 400", async () => {
    const creada = await crearClase({ nombre: "Historia del Arte 10C" });

    await expect(actualizarClase(creada.id, {})).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(actualizarClase(creada.id, {})).rejects.toMatchObject({
      status: 400,
    });
  });

  it("archiva una clase sin tocar su nombre", async () => {
    const creada = await crearClase({ nombre: "Literatura Global 11D" });

    const archivada = await actualizarClase(creada.id, {
      estado: "archived",
    });

    expect(archivada.estado).toBe("archived");
    expect(archivada.nombre).toBe(creada.nombre);
    expect(archivada.actualizadoEn).not.toBe(creada.actualizadoEn);
  });

  it("renombra una clase normalizando el nombre con trim", async () => {
    const creada = await crearClase({ nombre: "Educación Física 9A" });

    const renombrada = await actualizarClase(creada.id, {
      nombre: "   Deporte Escolar 9A   ",
    });

    expect(renombrada.nombre).toBe("Deporte Escolar 9A");
  });

  it("rechaza un nombre corto al editar con ApiError 422", async () => {
    const creada = await crearClase({ nombre: "Ciencias Políticas 12B" });

    await expect(
      actualizarClase(creada.id, { nombre: "corto" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("responde ApiError 404 para una clase inexistente", async () => {
    await expect(
      actualizarClase("no-existe", { estado: "archived" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
