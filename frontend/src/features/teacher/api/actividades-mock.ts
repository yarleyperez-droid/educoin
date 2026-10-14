/**
 * Mock del contrato de actividades (H3.3) — T5.6.2 (PRO-386).
 *
 * **MOCK temporal:** no existe ningún endpoint de actividades en el backend
 * (H3.3 / PRO-275 está en **Backlog**; `src/modules/` solo tiene `auth`,
 * `autorizacion` y `classes`). Este módulo simula `POST /activities` y
 * `PATCH /activities/:id { status }` con la misma validación que el
 * contrato zod, de modo que T5.6.3 pueda listar/editar/publicar y T5.6.4
 * sustituya **solo el interior** de la fachada sin tocar las vistas.
 *
 * Limitaciones documentadas del mock:
 * - Persistencia en memoria (module scope): al recargar la página vuelve al
 *   estado inicial.
 * - Sin auto-calificación (H3.4, también pendiente): publicar solo cambia
 *   `draft → published` y fija `publicadaEn`.
 */

import type { Actividad } from "../tipos";
import type { Pregunta } from "../contrato/actividades";

/** Duración simulada de la "petición" (ms). */
const LATENCIA_MOCK_MS = 150;

/** Catálogo en memoria de las actividades creadas en la sesión del mock. */
const catalogo: Actividad[] = [];

/** Contador de IDs opacos (el real es un BigInt serializado como string). */
let contador = 0;

/**
 * Datos de entrada para crear una actividad en el mock.
 *
 * Reproduce lo que enviaría la fachada tras validar con los esquemas zod.
 */
export interface DatosActividadMock {
  /** Clase dueña de la actividad (FK `activities.class_id`). */
  claseId: string;

  /** Título visible. */
  titulo: string;

  /** Descripción opcional. */
  descripcion?: string;

  /** Monedas que otorga al ser calificada (≥ 0). */
  recompensaMonedas: number;

  /** Preguntas ya validadas y con `position` normalizado. */
  preguntas: Pregunta[];
}

/**
 * Crea una actividad en `draft` dentro del catálogo mock.
 *
 * La validación (título, recompensa, JSONB) vive en la fachada
 * `api/actividades.ts`; aquí solo se persiste con los valores ya sanos.
 *
 * @param datos Datos de la actividad (ya validados).
 * @returns La actividad creada en estado `draft`.
 */
export async function crearActividadMock(
  datos: DatosActividadMock,
): Promise<Actividad> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  contador += 1;
  const ahora = new Date().toISOString();
  const actividad: Actividad = {
    id: `mock-actividad-${contador}-${Date.now()}`,
    claseId: datos.claseId,
    titulo: datos.titulo,
    descripcion: datos.descripcion ?? null,
    recompensaMonedas: datos.recompensaMonedas,
    estado: "draft",
    preguntas: datos.preguntas,
    publicadaEn: null,
    creadaEn: ahora,
    actualizadaEn: ahora,
  };

  catalogo.unshift(actividad);

  return actividad;
}

/**
 * Busca una actividad por su id en el catálogo mock.
 *
 * @param id Identificador de la actividad.
 * @returns La actividad, o `null` si no existe.
 */
export function obtenerActividadMock(id: string): Actividad | null {
  return catalogo.find((actividad) => actividad.id === id) ?? null;
}

/**
 * Publica una actividad del catálogo mock (`draft → published`).
 *
 * **No valida el estado** (lo hace la fachada, que es quien decide los
 * códigos de error): solo aplica la transición y fija `publicadaEn`.
 *
 * @param id Identificador de la actividad en `draft`.
 * @returns La actividad publicada.
 * @throws {Error} Si el id no existe (la fachada lo previene antes).
 */
export async function publicarActividadMock(id: string): Promise<Actividad> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  const actividad = catalogo.find((item) => item.id === id);

  if (!actividad) {
    throw new Error(`Actividad ${id} no encontrada en el mock.`);
  }

  const ahora = new Date().toISOString();
  const publicada: Actividad = {
    ...actividad,
    estado: "published",
    publicadaEn: ahora,
    actualizadaEn: ahora,
  };

  // Reemplaza la entrada del catálogo (el mock vive en memoria).
  const indice = catalogo.indexOf(actividad);
  catalogo[indice] = publicada;

  return publicada;
}

/**
 * Devuelve las actividades del catálogo mock (opcionalmente de una clase).
 *
 * @param claseId Si se indica, filtra las actividades de esa clase.
 * @returns Copia de las actividades de la sesión del mock.
 */
export function listarActividadesMock(claseId?: string): Actividad[] {
  const actividades = catalogo.filter(
    (actividad) => claseId === undefined || actividad.claseId === claseId,
  );

  return [...actividades];
}
