/**
 * Fachada de organizaciones del panel admin (T5.5.1 / PRO-380, H5.5).
 *
 * Punto único entre `/admin/organizaciones` y el transporte. Habla con la
 * **API real de H2.4** (`src/modules/organizations/`), `@Roles('admin')`.
 *
 * ## Contrato con H2.4 (verificado en `organizations.controller.ts`)
 *
 * - `GET /api/v1/organizations?page&limit&q&tipo&activa` → `{ data, meta }`
 *   (envoltura → `api.get`); defaults `page=1`, `limit=20` (tope50).
 * - `POST /api/v1/organizations` → **201** `{ mensaje, organizacion }`
 *   objeto plano (→ `apiPlano.post`). Un nombre repetido da `409` con el
 *   mensaje del backend.
 * - `ciudad` vacía se omite del body (el DTO la marca `@IsOptional` y un
 *   string vacío rompería `@IsNotEmpty`).
 *
 * Validación en cliente antes de entregar a la vista (AGENTS.md §6):
 * cualquier payload fuera del contrato sale como `ApiError` 422 con el
 * mensaje en español de {@link mensajeDeErroresZod}.
 */

import { ApiError, api, apiPlano } from "@/lib/api-client";

import {
  ListadoOrganizacionesSchema,
  OrganizacionCreadaSchema,
  mensajeDeErroresZod,
  type CrearOrganizacionInput,
  type FiltrosOrganizaciones,
  type ListadoOrganizaciones,
  type OrganizacionCreada,
} from "../contrato/organizaciones";

/** Límite por defecto del listado (igual que el backend). */
export const LIMITE_ORGANIZACIONES = 20;

/**
 * Lista una página de organizaciones (`GET /organizations`).
 *
 * @param filtros Página, límite y filtros opcionales `q`/`tipo`/`activa`.
 * @returns La página con su meta.
 * @throws {ApiError} 422 (contrato) o el error del backend (401/403).
 */
export async function listarOrganizaciones(
  filtros: FiltrosOrganizaciones = {},
): Promise<ListadoOrganizaciones> {
  const parametros = new URLSearchParams({
    page: String(filtros.page ?? 1),
    limit: String(filtros.limit ?? LIMITE_ORGANIZACIONES),
  });

  if (filtros.q !== undefined && filtros.q.trim() !== "") {
    parametros.set("q", filtros.q.trim());
  }
  if (filtros.tipo !== undefined) {
    parametros.set("tipo", filtros.tipo);
  }
  if (filtros.activa !== undefined) {
    parametros.set("activa", String(filtros.activa));
  }

  const respuesta = await api.get<unknown>(
    `organizations?${parametros.toString()}`,
  );

  const filas = ListadoOrganizacionesSchema.safeParse(respuesta);

  if (!filas.success) {
    throw new ApiError(mensajeDeErroresZod(filas.error.issues), 422);
  }

  return { data: filas.data.data, meta: filas.data.meta };
}

/**
 * Crea una organización (`POST /organizations`).
 *
 * @param input Datos del formulario (la ciudad vacía se omite).
 * @returns El mensaje del backend y la organización creada.
 * @throws {ApiError} 400/409/403 del backend,422 de contrato.
 */
export async function crearOrganizacion(
  input: CrearOrganizacionInput,
): Promise<OrganizacionCreada> {
  const ciudad = input.ciudad?.trim();

  const cuerpo = {
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    ...(ciudad !== undefined && ciudad !== "" ? { ciudad } : {}),
  };

  const respuesta = await apiPlano.post<unknown>("organizations", cuerpo);

  const creacion = OrganizacionCreadaSchema.safeParse(respuesta);

  if (!creacion.success) {
    throw new ApiError(mensajeDeErroresZod(creacion.error.issues), 422);
  }

  return creacion.data;
}
