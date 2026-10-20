/**
 * Tests de la fachada de usuarios del panel admin (T5.5.2 / PRO-383,
 * H5.5).
 *
 * Mockean el transporte (`@/lib/api-client`) con los shapes verificados
 * de H2.4 y cubren:
 *
 * 1. `{ data, meta }` válido → `ListadoUsuarios`.
 * 2. Query con y sin `organizacionId` (solo se agrega si hay filtro).
 * 3. `crearUsuario` envía el body correcto: `especialidad` incluida para
 *    `teacher`, OMITIDA para `student` (si viajara, el backend daría400).
 * 4. Respuesta sin `contrasenaInicial` → `ApiError` 422.
 * 5. `ApiError` 409 (usuario/correo duplicado) se propaga.
 *
 * Entorno: Vitest en node (sin DOM, ver `vitest.config.mts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();

  return {
    ...original,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    apiPlano: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

import { api, ApiError, apiPlano } from "@/lib/api-client";

import { crearUsuario, listarUsuarios } from "./usuarios";

/** `UsuarioRespuestaDto` de H2.4 (id como string). */
const USUARIO_BACKEND = {
  id: "12",
  usuario: "ana.garcia",
  correo: "ana@educoins.test",
  rol: "teacher" as const,
  nombre: "Ana",
  apellido: "García",
  especialidad: "Mathematics",
  organizacionId: "1",
  debeCambiarContrasena: true,
  activo: true,
  creadoEn: "2026-10-20T12:00:00.000Z",
};

const LISTADO_BACKEND = {
  data: [USUARIO_BACKEND],
  meta: { total: 1, page: 1, limit: 20 },
};

const CREACION_BACKEND = {
  mensaje: "Usuario creado con éxito. La contraseña inicial solo se muestra esta vez: el usuario debe cambiarla en su primer inicio de sesión.",
  contrasenaInicial: "aBcDeFgHiJkLmNoP",
  usuario: USUARIO_BACKEND,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarUsuarios", () => {
  it("devuelve { data, meta } validado", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    const resultado = await listarUsuarios();

    expect(resultado.data).toHaveLength(1);
    expect(resultado.data[0].usuario).toBe("ana.garcia");
    expect(resultado.meta).toEqual({ total: 1, page: 1, limit: 20 });
  });

  it("sin filtro no agrega organizacionId a la query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    await listarUsuarios({ page: 2 });

    expect(api.get).toHaveBeenCalledWith("users?page=2&limit=20");
  });

  it("con filtro agrega organizacionId exacto a la query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTADO_BACKEND);

    await listarUsuarios({ organizacionId: "7" });

    expect(api.get).toHaveBeenCalledWith(
      "users?page=1&limit=20&organizacionId=7",
    );
  });

  it("payload fuera de contrato lanza ApiError 422 con el mensaje de zod", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: [{ ...USUARIO_BACKEND, rol: "superadmin" }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const rechazo = listarUsuarios();

    await expect(rechazo).rejects.toBeInstanceOf(ApiError);
    await expect(rechazo).rejects.toMatchObject({ status: 422 });
    await expect(rechazo).rejects.toThrow(/rol/);
  });
});

describe("crearUsuario", () => {
  it("teacher: envía especialidad y devuelve la contraseña inicial", async () => {
    vi.mocked(apiPlano.post).mockResolvedValueOnce(CREACION_BACKEND);

    const resultado = await crearUsuario({
      rol: "teacher",
      usuario: "ana.garcia",
      correo: "ana@educoins.test",
      nombre: "Ana",
      apellido: "García",
      organizacionId: "1",
      especialidad: "Mathematics",
    });

    expect(apiPlano.post).toHaveBeenCalledWith("users", {
      rol: "teacher",
      usuario: "ana.garcia",
      correo: "ana@educoins.test",
      nombre: "Ana",
      apellido: "García",
      organizacionId: "1",
      especialidad: "Mathematics",
    });
    expect(resultado.contrasenaInicial).toBe("aBcDeFgHiJkLmNoP");
    expect(resultado.usuario.usuario).toBe("ana.garcia");
  });

  it("student: OMITE especialidad (el backend daría 400 si viajara)", async () => {
    vi.mocked(apiPlano.post).mockResolvedValueOnce(CREACION_BACKEND);

    await crearUsuario({
      rol: "student",
      usuario: "juan.perez",
      correo: "juan@educoins.test",
      nombre: "Juan",
      apellido: "Pérez",
      organizacionId: "1",
      especialidad: "  ",
    });

    expect(apiPlano.post).toHaveBeenCalledWith("users", {
      rol: "student",
      usuario: "juan.perez",
      correo: "juan@educoins.test",
      nombre: "Juan",
      apellido: "Pérez",
      organizacionId: "1",
    });
  });

  it("propaga el ApiError 409 del backend sin enmascarar", async () => {
    vi.mocked(apiPlano.post).mockRejectedValueOnce(
      new ApiError("Ya existe un usuario con ese nombre de usuario.", 409),
    );

    await expect(
      crearUsuario({
        rol: "student",
        usuario: "repetido",
        correo: "rep@educoins.test",
        nombre: "Rep",
        apellido: "Etido",
        organizacionId: "1",
      }),
    ).rejects.toMatchObject({
      message: "Ya existe un usuario con ese nombre de usuario.",
      status: 409,
    });
  });

  it("respuesta sin contrasenaInicial lanza ApiError 422", async () => {
    vi.mocked(apiPlano.post).mockResolvedValueOnce({
      mensaje: "ok",
      usuario: USUARIO_BACKEND,
    });

    await expect(
      crearUsuario({
        rol: "student",
        usuario: "x.y",
        correo: "x@educoins.test",
        nombre: "X",
        apellido: "Y",
        organizacionId: "1",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
