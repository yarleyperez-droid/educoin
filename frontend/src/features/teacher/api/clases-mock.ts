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

import type { Clase, ClaseListado, Meta } from "../tipos";

/** Duración simulada de la "petición" (ms). */
const LATENCIA_MOCK_MS = 150;

/** Alfabeto del código de unión (el de la BD es `A-Z0-9`, 8 caracteres). */
const ALFABETO_CODIGO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Longitud del código de unión generado por la BD (comentario de `classes.code`). */
export const LONGITUD_CODIGO = 8;

/** Profesor dueño del catálogo mock (prof.lopez, id 2 del seed). */
const PROFESOR_MOCK = {
  id: "2",
  nombre: "Ana López",
};

/** Tope de filas por página (igual que `BuscarClasesQueryDto`, H3.1). */
const LIMITE_MAXIMO = 50;

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
    profesorId: PROFESOR_MOCK.id,
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
    profesorId: PROFESOR_MOCK.id, // el profesor sale del token en el backend real
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

/**
 * Busca clases del profesor mock por nombre (simula `GET /classes`).
 *
 * Reproduce las reglas de `BuscarClasesQueryDto` (H3.1): coincidencia por
 * subcadena insensible a mayúsculas (el `ILIKE` del backend; el `pg_trgm`
 * puro no se simula), orden alfabético, paginación 1-indexada y tope de
 * {@link LIMITE_MAXIMO} filas por página. El filtro por profesor imita
 * `condicionPorRol`: solo se devuelven clases de {@link PROFESOR_MOCK}.
 *
 * La validación de `q ≥ 3` vive en la fachada (es quien decide los
 * errores); aquí se asume ya validado.
 *
 * @param q Texto de búsqueda (ya validado, ≥ 3 caracteres).
 * @param page Página 1-indexada.
 * @param limit Filas por página (1..50).
 * @returns Página de resultados con su `meta` de paginación.
 */
export async function buscarClasesMock(
  q: string,
  page: number,
  limit: number,
): Promise<{ data: ClaseListado[]; meta: Meta }> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  const texto = q.trim().toLowerCase();
  const limite = Math.min(Math.max(limit, 1), LIMITE_MAXIMO);
  const pagina = Math.max(page, 1);

  const coincidencias = catalogo
    .filter(
      (clase) =>
        clase.profesorId === PROFESOR_MOCK.id &&
        clase.nombre.toLowerCase().includes(texto),
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const desde = (pagina - 1) * limite;

  return {
    data: coincidencias.slice(desde, desde + limite).map((clase) => ({
      id: clase.id,
      nombre: clase.nombre,
      estado: clase.estado,
      profesorNombre: PROFESOR_MOCK.nombre,
      creadoEn: clase.creadoEn,
    })),
    meta: {
      total: coincidencias.length,
      page: pagina,
      limit: limite,
    },
  };
}

/**
 * Busca una clase por id en el catálogo mock.
 *
 * @param id Identificador de la clase.
 * @returns La clase completa (incluye `codigo`), o `null` si no existe.
 */
export function obtenerClaseMock(id: string): Clase | null {
  return catalogo.find((clase) => clase.id === id) ?? null;
}

/**
 * Aplica un parche a una clase del catálogo mock (simula `PATCH /classes/:id`).
 *
 * **No valida** el parche (lo hace la fachada, que decide los códigos de
 * error): solo reemplaza los campos indicados y refresca `actualizadoEn`.
 *
 * @param id Identificador de la clase.
 * @param parche Campos a cambiar (`nombre` y/o `estado`).
 * @returns La clase actualizada.
 * @throws {Error} Si el id no existe (la fachada lo previene antes).
 */
export async function actualizarClaseMock(
  id: string,
  parche: { nombre?: string; estado?: Clase["estado"] },
): Promise<Clase> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  const indice = catalogo.findIndex((clase) => clase.id === id);

  if (indice === -1) {
    throw new Error(`Clase ${id} no encontrada en el mock.`);
  }

  const actualizada: Clase = {
    ...catalogo[indice],
    ...parche,
    actualizadoEn: new Date().toISOString(),
  };

  catalogo[indice] = actualizada;

  return actualizada;
}
