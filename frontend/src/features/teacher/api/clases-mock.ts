/**
 * Mock del contrato de `POST /classes` (H3.1) — T5.6.1 (PRO-385).
 *
 * **MOCK temporal:** H3.1 (PRO-273) ya está Done en `main`, pero esta tarea
 * trabaja contra el contrato (spec §"Contrato con el backend") y deja la
 * sustitución por la API real para **T5.6.4 (PRO-388)**, igual que T5.4.1
 * hizo con auth. Mientras tanto, este módulo simula el comportamiento
 * verificado de `src/modules/classes/`:
 *
 * - `POST /classes` solo acepta `nombre` (8–150); el **código de unión lo
 *   genera la BD** y jamás viaja del cliente — aquí se simula con
 *   {@link generarCodigoUnico} (8 caracteres `A-Z0-9`).
 * - La clase nace en `estado: "active"` (DEFAULT de `class_status`).
 * - Los IDs son opacos (`string`), como los IDs BigInt del backend.
 *
 * El catálogo vive en memoria de la app (module scope): sirve de andamio
 * para que T5.6.2 y T5.6.3 puedan listarlo/editarlo antes de existir la API
 * real de actividades. **No hay persistencia**: al recargar la página vuelve
 * al estado inicial (limitación documentada del mock).
 */

import type { Clase } from "../tipos";

/** Duración simulada de la "petición" (ms). */
const LATENCIA_MOCK_MS = 150;

/** Alfabeto del código de unión (el de la BD es `A-Z0-9`, 8 caracteres). */
const ALFABETO_CODIGO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Longitud del código de unión generado por la BD (comentario de `classes.code`). */
export const LONGITUD_CODIGO = 8;

/**
 * Catálogo en memoria de las clases creadas en esta sesión del mock.
 *
 * Parte con la clase del seed (`db/002_seed.sql`: "Mathematics 10A", del
 * profesor `prof.lopez` id 2) para que el listado de T5.6.3 no arranque
 * vacío. El `codigo` del seed es un valor de simulación: el real solo lo
 * conoce la BD.
 */
const catalogo: Clase[] = [
  {
    id: "mock-clase-seed",
    profesorId: "2",
    nombre: "Mathematics 10A",
    codigo: "MATH10A0",
    estado: "active",
    creadoEn: "2026-10-01T12:00:00.000Z",
    actualizadoEn: "2026-10-01T12:00:00.000Z",
  },
];

/**
 * Genera un código de unión de 8 caracteres `A-Z0-9`.
 *
 * Reproduce el DEFAULT de `classes.code` en PostgreSQL (comentario del
 * esquema: código aleatorio de 8 caracteres, legible, sin caracteres
 * ambiguos). No colisiona con los códigos ya presentes en el catálogo.
 *
 * @returns Código de unión de {@link LONGITUD_CODIGO} caracteres.
 */
export function generarCodigoUnico(): string {
  let codigo: string;

  do {
    codigo = "";
    for (let i = 0; i < LONGITUD_CODIGO; i += 1) {
      codigo += ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)];
    }
  } while (catalogo.some((clase) => clase.codigo === codigo));

  return codigo;
}

/**
 * Crea una clase en el catálogo mock (simula `POST /classes`).
 *
 * La validación del nombre vive en la fachada (`api/clases.ts`), que es la
 * que replica las reglas de `CrearClaseDto`; aquí solo se persiste.
 *
 * @param datos Nombre ya normalizado (trim) de la clase.
 * @returns La clase creada con código único y estado `active`.
 */
export async function crearClaseMock(datos: { nombre: string }): Promise<Clase> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  const ahora = new Date().toISOString();
  const clase: Clase = {
    // ID opaco estilo backend: el real es un BigInt serializado como string.
    id: `mock-${catalogo.length + 1}-${Date.now()}`,
    profesorId: "2", // prof.lopez: el profesor sale del token en el backend real
    nombre: datos.nombre,
    codigo: generarCodigoUnico(),
    estado: "active",
    creadoEn: ahora,
    actualizadoEn: ahora,
  };

  catalogo.unshift(clase);

  return clase;
}

/**
 * Devuelve una copia del catálogo mock (para tests y para T5.6.3).
 *
 * @returns Copia de las clases creadas en la sesión del mock.
 */
export function listarClasesMock(): Clase[] {
  return [...catalogo];
}
