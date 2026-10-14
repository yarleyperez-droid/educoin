/**
 * Fachada de datos de actividades del panel docente (T5.6.2, PRO-386).
 *
 * Punto único entre las vistas del editor y el transporte. **Hoy el
 * interior es un mock** porque H3.3 (PRO-275) está en Backlog y no existe
 * ningún endpoint de actividades; T5.6.4 (PRO-388) —tras la decisión de
 * alcance correspondiente— sustituirá **solo el cuerpo** de estas funciones
 * por `api.post/api.patch` sin cambiar las firmas (mismo criterio que
 * T5.4.3 con auth y T5.6.1 con clases).
 *
 * ## Responsabilidades de la fachada
 *
 * 1. **Primera red de validación en cliente** (AGENTS.md §6): normaliza
 *    `position` ({@link normalizarPosiciones}) y valida con
 *    `BorradorActividadSchema` + `PreguntasSchema` antes de tocar el
 *    transporte → cualquier problema sale como `ApiError` 422 con el
 *    mensaje en español de `mensajeDeErroresZod`.
 * 2. **Transiciones de estado**: solo `draft → published`
 *    ({@link publicarActividad}); no existe reversión (CA 3 de H5.6) ni
 *    acciones sobre `deleted`.
 *
 * ## Contrato previsto con H3.3 (provisional)
 *
 * `POST /api/v1/activities` (crear), `GET /api/v1/activities?claseId=` y
 * `PATCH /api/v1/activities/:id { status }` — **especulativo**: H3.3 no ha
 * publicado DTOs. El envelope {@link Actividad} deriva de
 * `db/001_schema.sql`; si el Swagger real difiere, se ajusta solo el
 * mapeo interno de este archivo.
 *
 * Las vistas solo leen `error.message` de `ApiError` (nunca `detalles` ni
 * códigos HTTP).
 */

import { ApiError } from "@/lib/api-client";

import type { Actividad } from "../tipos";
import {
  BorradorActividadSchema,
  mensajeDeErroresZod,
  normalizarPosiciones,
  PreguntasSchema,
  type Pregunta,
} from "../contrato/actividades";

import {
  crearActividadMock,
  obtenerActividadMock,
  publicarActividadMock,
} from "./actividades-mock";

export type { Actividad };

/** Mensaje cuando la actividad no existe en el catálogo. */
const MENSAJE_NO_ENCONTRADA =
  "No se encontró la actividad solicitada.";

/** Mensaje cuando se intenta publicar algo ya publicado (sin reversión). */
const MENSAJE_YA_PUBLICADA =
  "La actividad ya está publicada; no puede volver a borrador.";

/** Mensaje cuando la actividad está eliminada lógicamente. */
const MENSAJE_ELIMINADA =
  "La actividad está eliminada y no se puede publicar.";

/**
 * Datos de entrada para crear una actividad.
 *
 * Coincide con los campos editables del formulario (spec §Interfaces):
 * `recompensaMonedas` es entero ≥ 0 (CHECK de la BD) y `preguntas` llega
 * sin normalizar — la fachada renumera `position` antes de validar.
 */
export interface DatosCrearActividad {
  /** Clase dueña de la actividad. */
  claseId: string;

  /** Título (1–150 tras `trim`). */
  titulo: string;

  /** Descripción opcional (vacío → `undefined`). */
  descripcion?: string;

  /** Monedas otorgadas al calificar (entero ≥ 0). */
  recompensaMonedas: number;

  /** Preguntas del editor (posición sin normalizar). */
  preguntas: Pregunta[];
}

/**
 * Crea una actividad en `draft` validando contra el contrato zod.
 *
 * Flujo:
 * 1. Normaliza `position` (1..n) — el índice es derivado del orden del
 *    editor, no un dato del usuario.
 * 2. Valida los datos generales (`BorradorActividadSchema`) y el JSONB
 *    `questions` (`PreguntasSchema`). Cualquier problema → `ApiError` 422
 *    con el mensaje legible de {@link mensajeDeErroresZod} (la vista lo
 *    muestra en el resumen `role="alert"` **sin limpiar el formulario**).
 * 3. Persiste vía el mock (T5.6.4 cambiará este paso por `api.post`).
 *
 * **MOCK temporal:** ver cabecera del archivo.
 *
 * @param datos Datos del formulario (título, recompensa y preguntas).
 * @returns La actividad creada, en estado `draft`.
 * @throws {ApiError} 422 si el JSONB o los datos generales no validan.
 */
export async function crearActividad(
  datos: DatosCrearActividad,
): Promise<Actividad> {
  const preguntasNormalizadas = normalizarPosiciones(datos.preguntas);

  const borrador = BorradorActividadSchema.safeParse({
    titulo: datos.titulo,
    descripcion:
      datos.descripcion === undefined || datos.descripcion.trim() === ""
        ? undefined
        : datos.descripcion,
    recompensaMonedas: datos.recompensaMonedas,
  });

  if (!borrador.success) {
    throw new ApiError(mensajeDeErroresZod(borrador.error.issues), 422);
  }

  const preguntas = PreguntasSchema.safeParse(preguntasNormalizadas);

  if (!preguntas.success) {
    throw new ApiError(mensajeDeErroresZod(preguntas.error.issues), 422);
  }

  return crearActividadMock({
    claseId: datos.claseId,
    titulo: borrador.data.titulo,
    descripcion: borrador.data.descripcion,
    recompensaMonedas: borrador.data.recompensaMonedas,
    preguntas: preguntas.data,
  });
}

/**
 * Publica una actividad (`draft → published`).
 *
 * **No existe reversión** `published → draft` (CA 3 de H5.6): intentarlo
 * responde `ApiError` 409 con mensaje claro. Las actividades `deleted`
 * tampoco se pueden publicar (borrado lógico de la BD).
 *
 * **MOCK temporal:** ver cabecera del archivo.
 *
 * @param id Identificador de la actividad en `draft`.
 * @returns La actividad publicada (con `publicadaEn`).
 * @throws {ApiError} 404 si no existe; 409 si no está en `draft`.
 */
export async function publicarActividad(id: string): Promise<Actividad> {
  const existente = obtenerActividadMock(id);

  if (!existente) {
    throw new ApiError(MENSAJE_NO_ENCONTRADA, 404);
  }

  if (existente.estado === "published") {
    throw new ApiError(MENSAJE_YA_PUBLICADA, 409);
  }

  if (existente.estado === "deleted") {
    throw new ApiError(MENSAJE_ELIMINADA, 409);
  }

  return publicarActividadMock(id);
}
