/**
 * Mock de entregas con la regla UNIQUE (T5.8.2, PRO-395).
 *
 * **MOCK temporal:** no existe endpoint de entregas (H3.4 / PRO-276 está en
 * **Backlog**; `src/modules/` no tiene módulo `submissions`). Este módulo
 * simula `POST /submissions` replicando la **garantía de la BD**:
 * `UNIQUE (activity_id, enrollment_id)` — una sola entrega por estudiante
 * y actividad; el segundo INSERT fallaría y H3.4 lo traducirá a `409`.
 *
 * Limitaciones documentadas:
 * - Catálogo en memoria (module scope): al recargar la página vuelve al
 *   estado inicial. La vista lo compensa leyendo la entrega al montar
 *   (en una sesión real el `409` protege el reintento).
 * - Estudiante fijo del seed (`est.perez`, id 3): con API real saldrá del
 *   JWT (H2.1).
 * - Sin calificación: `calificadaEn`/`puntaje`/`retroalimentacion` llegan
 *   con T5.8.3 (y de verdad con H3.4/H3.5).
 */

import { ApiError } from "@/lib/api-client";

import type { Entrega, Respuesta } from "../contrato/entregas";

/** Duración simulada de la "petición" (ms). */
const LATENCIA_MOCK_MS = 150;

/** Estudiante de la sesión simulada (`db/002_seed.sql`: est.perez, id 3). */
export const ESTUDIANTE_MOCK_ID = "3";

/** Mensaje real que produciría el conflicto UNIQUE (H3.4 → 409). */
const MENSAJE_DUPLICADA =
  "Ya enviaste esta actividad; solo se permite un intento por estudiante.";

/** Catálogo de entregas de la sesión del mock. */
const catalogo: Entrega[] = [];

/** Contador de IDs opacos (el real es un BigInt serializado como string). */
let contador = 0;

/**
 * Busca la entrega de un estudiante para una actividad.
 *
 * @param actividadId Actividad consultada.
 * @returns La entrega, o `null` si aún no existe.
 */
export function obtenerEntregaMock(actividadId: string): Entrega | null {
  return (
    catalogo.find(
      (entrega) =>
        entrega.actividadId === actividadId &&
        entrega.estudianteId === ESTUDIANTE_MOCK_ID,
    ) ?? null
  );
}

/**
 * Crea la entrega de una actividad (simula el `INSERT` de `submissions`).
 *
 * El estado inicial es `submitted` (criterio del ticket: "el envío crea la
 * entrega `submitted` la primera vez"); en la BD el DEFAULT es
 * `in_progress`, pero H3.4 marcará `submitted_at` en el mismo
 * POST/confirmación.
 *
 * **No valida duplicados** — eso lo decide la fachada con
 * {@link obtenerEntregaMock} (replicando el `UNIQUE`); aquí solo persiste.
 *
 * @param actividadId Actividad respondida.
 * @param respuestas Respuestas ya validadas por el contrato.
 * @returns La entrega creada.
 */
export async function crearEntregaMock(
  actividadId: string,
  respuestas: Respuesta[],
): Promise<Entrega> {
  await new Promise<void>((resolver) => setTimeout(resolver, LATENCIA_MOCK_MS));

  contador += 1;
  const ahora = new Date().toISOString();
  const entrega: Entrega = {
    id: `mock-entrega-${contador}-${Date.now()}`,
    actividadId,
    estudianteId: ESTUDIANTE_MOCK_ID,
    estado: "submitted",
    respuestas,
    iniciadaEn: ahora,
    enviadaEn: ahora,
    calificadaEn: null,
    puntaje: null,
    monedasOtorgadas: 0,
    retroalimentacion: null,
  };

  catalogo.push(entrega);

  return entrega;
}

/**
 * Lanza el `409` que produciría el `UNIQUE (activity_id, enrollment_id)`.
 *
 * Exportada para que la fachada mantenga el mensaje del servidor en un
 * solo lugar (y para poder probarlo).
 */
export function lanzarDuplicada(): never {
  throw new ApiError(MENSAJE_DUPLICADA, 409);
}
