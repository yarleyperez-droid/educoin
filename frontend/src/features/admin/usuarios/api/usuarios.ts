/**
 * Fachada de usuarios del panel admin (T5.5.2 / PRO-383, H5.5).
 *
 * Punto único entre `/admin/usuarios` y el transporte. Habla con la
 * **API real de H2.4** (`src/modules/users/`), `@Roles('admin')`.
 *
 * ## Contrato con H2.4 (verificado en `users.controller.ts`)
 *
 * - `GET /api/v1/users?page&limit&organizacionId` → `{ data, meta }`
 *   (envoltura → `api.get`); `organizacionId` es el nombre exacto del
 *   param y solo se agrega cuando hay filtro. Orden `created_at desc`
 *   (los recién creados aparecen primero).
 * - `POST /api/v1/users` → **201** `{ mensaje, contrasenaInicial,
 *   usuario }` objeto plano (→ `apiPlano.post`). La contraseña inicial
 *   se genera en el servidor (no viaja en el body).
 * - `especialidad` solo viaja cuando el rol es `teacher` y tiene valor;
 *   el backend responde `400` si llega con `rol: 'student'`.
 *
 * Validación en cliente antes de entregar a la vista (AGENTS.md §6):
 * cualquier payload fuera del contrato sale como `ApiError` 422 con el
 * mensaje en español de {@link mensajeDeErroresZod}.
 */

import { ApiError, api, apiPlano } from "@/lib/api-client";

import {
  ListadoUsuariosSchema,
  UsuarioCreadoSchema,
  mensajeDeErroresZod,
  type CrearUsuarioInput,
  type FiltrosUsuarios,
  type ListadoUsuarios,
  type UsuarioCreado,
} from "../contrato/usuarios";

/** Límite por defecto del listado (igual que el backend). */
export const LIMITE_USUARIOS = 20;

/**
 * Lista una página de usuarios (`GET /users`).
 *
 * @param filtros Página, límite y filtro opcional por organización.
 * @returns La página con su meta.
 * @throws {ApiError} 422 (contrato) o el error del backend (401/403/400).
 */
export async function listarUsuarios(
  filtros: FiltrosUsuarios = {},
): Promise<ListadoUsuarios> {
  const parametros = new URLSearchParams({
    page: String(filtros.page ?? 1),
    limit: String(filtros.limit ?? LIMITE_USUARIOS),
  });

  if (filtros.organizacionId !== undefined && filtros.organizacionId !== "") {
    parametros.set("organizacionId", filtros.organizacionId);
  }
  if (filtros.q !== undefined && filtros.q.trim() !== "") {
    parametros.set("q", filtros.q.trim());
  }
  if (filtros.rol !== undefined) {
    parametros.set("rol", filtros.rol);
  }
  if (filtros.activa !== undefined) {
    parametros.set("activa", String(filtros.activa));
  }

  const respuesta = await api.get<unknown>(
    `users?${parametros.toString()}`,
  );

  const listado = ListadoUsuariosSchema.safeParse(respuesta);

  if (!listado.success) {
    throw new ApiError(mensajeDeErroresZod(listado.error.issues), 422);
  }

  return listado.data;
}

/**
 * Crea un usuario (`POST /users`).
 *
 * La contraseña inicial solo viene en la respuesta del backend (se
 * muestra una sola vez en la UI).
 *
 * @param input Datos del formulario (la especialidad solo se envía para
 *   `teacher` y no vacía).
 * @returns Mensaje, contraseña inicial y usuario creado.
 * @throws {ApiError} 400/404/409/403 del backend,422 de contrato.
 */
export async function crearUsuario(
  input: CrearUsuarioInput,
): Promise<UsuarioCreado> {
  const especialidad = input.especialidad?.trim();

  const cuerpo = {
    rol: input.rol,
    usuario: input.usuario.trim(),
    correo: input.correo.trim(),
    nombre: input.nombre.trim(),
    apellido: input.apellido.trim(),
    organizacionId: input.organizacionId,
    ...(input.rol === "teacher" && especialidad !== undefined && especialidad !== ""
      ? { especialidad }
      : {}),
  };

  const respuesta = await apiPlano.post<unknown>("users", cuerpo);

  const creacion = UsuarioCreadoSchema.safeParse(respuesta);

  if (!creacion.success) {
    throw new ApiError(mensajeDeErroresZod(creacion.error.issues), 422);
  }

  return creacion.data;
}
