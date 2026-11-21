/**
 * Fachada de datos de los rankings del estudiante (T5.10.1 / PRO-403,
 * H5.10).
 *
 * Punto único entre las vistas de `/student/ranking` y el transporte
 * (`@/lib/api-client`). Habla con la **API real de H4.3**
 * (`src/modules/rankings/`); no hay mocks.
 *
 * ## Responsabilidades
 *
 * 1. **Primera red de validación en cliente** (AGENTS.md §6): valida filas
 *    y meta contra `contrato/rankings.ts` antes de entregarlo a la vista;
 *    un payload que viole el esquema sale como `ApiError` 422 con el
 *    mensaje en español de {@link mensajeDeErroresZod}.
 * 2. **Mapper a dominio**: {@link aFilaRanking} normaliza `estudianteId`
 *    a `string` por defensa (el backend ya lo emite como string).
 *
 * ## Contrato con H4.3 (verificado en `rankings.controller.ts`)
 *
 * - `GET /api/v1/rankings?page&limit` → `{ data: FilaRankingDto[], meta }`
 *   (envoltura estándar → `api.get`, nunca `apiPlano`). `@Roles('student',
 *   'teacher', 'admin')`; multi-tenant: el student ve su organización.
 * - `GET /api/v1/rankings/classes/:id?page&limit` → idem por clase; da
 *   `404` (mensaje estándar de recurso no encontrado) si la clase no
 *   existe o el estudiante no está inscripto. El global nunca da `404`.
 * - `page` 1-indexada; `limit` default20, tope100.
 *
 * Los errores del backend (401/403/404/400) se transportan como
 * `ApiError.message` tal cual: la fachada no pre-comprueba nada contra el
 * servidor.
 */

import { ApiError, api } from "@/lib/api-client";

import {
  FilaRankingSchema,
  MetaRankingSchema,
  mensajeDeErroresZod,
  type FilaRanking,
  type MetaRanking,
  type RankingPaginado,
} from "../contrato/rankings";

/** Límite por defecto de las vistas (igual que el backend). */
export const LIMITE_RANKING = 20;

/**
 * Fila de ranking tal cual sale del backend (`FilaRankingDto`).
 *
 * Shape estático de referencia para el mapper {@link aFilaRanking}; la red
 * de validación en runtime es {@link FilaRankingSchema}.
 */
interface FilaRankingBackend {
  posicion: number;
  estudianteId: string;
  nombres: string;
  monedasGanadas: number;
  monedasDisponibles: number;
}

/**
 * Traduce `FilaRankingDto` al tipo de dominio {@link FilaRanking}.
 *
 * @param backend Fila ya validada por {@link FilaRankingSchema}.
 * @returns La fila con el vocabulario del frontend (ids `string`).
 */
function aFilaRanking(backend: FilaRankingBackend): FilaRanking {
  return {
    posicion: Number(backend.posicion),
    estudianteId: String(backend.estudianteId),
    nombres: backend.nombres,
    monedasGanadas: Number(backend.monedasGanadas),
    monedasDisponibles: Number(backend.monedasDisponibles),
  };
}

/**
 * Pide una página de ranking y la valida contra el contrato.
 *
 * Flujo compartido por el global y el por-clase: construye la query
 * `?page&limit`, valida `data` y `meta` con safeParse y mapea las filas.
 *
 * @param ruta Relativa al recurso (`"rankings"` o
 *   `"rankings/classes/:id"`).
 * @param page Página solicitada (1-indexada).
 * @param limit Filas por página (default {@link LIMITE_RANKING}).
 * @returns La página de ranking con su meta.
 * @throws {ApiError} 422 si la respuesta viola el contrato; el resto de
 *   errores del backend se propagan sin enmascarar.
 */
async function obtenerRanking(
  ruta: string,
  page: number,
  limit: number,
): Promise<RankingPaginado> {
  const parametros = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  const respuesta = await api.get<unknown>(`${ruta}?${parametros.toString()}`);

  const filas = FilaRankingSchema.array().safeParse(respuesta.data);

  if (!filas.success) {
    throw new ApiError(mensajeDeErroresZod(filas.error.issues), 422);
  }

  const meta = MetaRankingSchema.safeParse(respuesta.meta);

  if (!meta.success) {
    throw new ApiError(mensajeDeErroresZod(meta.error.issues), 422);
  }

  return {
    data: filas.data.map(aFilaRanking),
    meta: meta.data,
  };
}

/**
 * Ranking global de la organización del estudiante
 * (`GET /rankings`).
 *
 * @param page Página (default1).
 * @param limit Filas por página (default {@link LIMITE_RANKING}).
 * @returns Página del ranking global.
 * @throws {ApiError} 422 (contrato), o el error del backend.
 */
export async function obtenerRankingGlobal(
  page = 1,
  limit = LIMITE_RANKING,
): Promise<RankingPaginado> {
  return obtenerRanking("rankings", page, limit);
}

/**
 * Ranking de una clase (`GET /rankings/classes/:id`).
 *
 * El `404` del backend (clase inexistente o estudiante no inscripto)
 * llega como `ApiError` tal cual: la vista decide cómo mostrarlo.
 *
 * @param claseId Clase dueña del ranking.
 * @param page Página (default1).
 * @param limit Filas por página (default {@link LIMITE_RANKING}).
 * @returns Página del ranking de la clase.
 * @throws {ApiError} 422 (contrato), 404/403 del backend.
 */
export async function obtenerRankingPorClase(
  claseId: string,
  page = 1,
  limit = LIMITE_RANKING,
): Promise<RankingPaginado> {
  return obtenerRanking(`rankings/classes/${claseId}`, page, limit);
}

/** Re-exporta la meta de dominio para las vistas. */
export type { MetaRanking, RankingPaginado };
