"use client";

/**
 * Usuarios del panel admin (`/admin/usuarios`) — T5.5.2 / PRO-383 (H5.5).
 *
 * Listado paginado de usuarios (`GET /users`, H2.4) con filtro por
 * organización y formulario de alta (`POST /users`). Tras el alta se
 * muestra la **contraseña inicial** del backend (`contrasenaInicial`)
 * en un bloque `role="status"`: solo se genera una vez y la UI advierte
 * que no volverá a verse.
 *
 * Estados cubiertos (kit H5.2): carga, error con reintento y vacío
 * (también con el filtro de organización activo).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import {
  listarOrganizaciones,
} from "@/features/admin/organizaciones/api/organizaciones";
import type { Organizacion } from "@/features/admin/organizaciones/contrato/organizaciones";
import {
  crearUsuario,
  listarUsuarios,
  LIMITE_USUARIOS,
} from "@/features/admin/usuarios/api/usuarios";
import {
  RolCreableSchema,
  type ListadoUsuarios,
  type RolCreable,
} from "@/features/admin/usuarios/contrato/usuarios";
import { ApiError } from "@/lib/api-client";

/** Título del estado vacío sin filtro. */
const TITULO_VACIO = "Aún no hay usuarios";

/** Descripción del estado vacío sin filtro. */
const DESCRIPCION_VACIO = "Crea el primer usuario con el formulario de arriba.";

/** Título del estado vacío con filtro de organización. */
const TITULO_VACIO_FILTRO = "Sin usuarios en esta organización";

/** Descripción del estado vacío con filtro. */
const DESCRIPCION_VACIO_FILTRO =
  "Elige otra organización o quita el filtro para ver todos los usuarios.";

/** Etiquetas de rol en la UI. */
const ETIQUETAS_ROL: Record<ListadoUsuarios["data"][number]["rol"], string> = {
  admin: "Administrador",
  teacher: "Profesor",
  student: "Estudiante",
};

/** Opciones de rol del alta (el backend no acepta crear admins). */
const ROLES_ALTA: ReadonlyArray<{ valor: RolCreable; etiqueta: string }> = [
  { valor: "teacher", etiqueta: "Profesor" },
  { valor: "student", etiqueta: "Estudiante" },
];

/** Texto de respaldo si el backend no devolviera `mensaje`. */
const MENSAJE_USUARIO_CREADO = "Usuario creado con éxito.";

/** Contraseña inicial recién generada (se muestra una sola vez). */
interface ContrasenaInicial {
  /** Usuario recién creado (para rotular el bloque). */
  usuario: string;
  valor: string;
}

/**
 * Vista de usuarios del admin.
 *
 * @returns Formulario, listado y filtro dentro del shell de `/admin`.
 */
export default function UsuariosPage() {
  const { mostrar } = useToast();
  const [usuarios, setUsuarios] = useState<ListadoUsuarios | null>(null);
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [filtroOrganizacion, setFiltroOrganizacion] = useState("");
  /** Contador para forzar una recarga desde un evento (reintento/alta). */
  const [recarga, setRecarga] = useState(0);
  /** Contraseña inicial del último alta (se muestra hasta el siguiente alta). */
  const [contrasenaInicial, setContrasenaInicial] =
    useState<ContrasenaInicial | null>(null);

  // Formulario de alta.
  const [rol, setRol] = useState<RolCreable>("student");
  const [usuario, setUsuario] = useState("");
  const [correo, setCorreo] = useState("");
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [organizacionId, setOrganizacionId] = useState("");
  const [especialidad, setEspecialidad] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [listaUsuarios, listaOrganizaciones] = await Promise.all([
          listarUsuarios({
            page: pagina,
            limit: LIMITE_USUARIOS,
            ...(filtroOrganizacion !== ""
              ? { organizacionId: filtroOrganizacion }
              : {}),
          }),
          listarOrganizaciones(1, 50),
        ]);
        if (vigente) {
          setUsuarios(listaUsuarios);
          setOrganizaciones(listaOrganizaciones.data);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setUsuarios(null);
          setError(
            e instanceof ApiError
              ? e.message
              : "Ocurrió un error inesperado. Intenta de nuevo.",
          );
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void cargar();

    return () => {
      vigente = false;
    };
  }, [pagina, filtroOrganizacion, recarga]);

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const cambiarFiltro = (valor: string): void => {
    setCargando(true);
    setPagina(1);
    setFiltroOrganizacion(valor);
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const enviar = async (
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    evento.preventDefault();

    if (organizacionId === "") {
      mostrar("Elige la organización del usuario.", "error");
      return;
    }
    if (
      usuario.trim() === "" ||
      correo.trim() === "" ||
      nombre.trim() === "" ||
      apellido.trim() === ""
    ) {
      mostrar("Completa usuario, correo, nombre y apellido.", "error");
      return;
    }

    setEnviando(true);
    try {
      const creacion = await crearUsuario({
        rol,
        usuario: usuario.trim(),
        correo: correo.trim(),
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        organizacionId,
        especialidad: especialidad.trim(),
      });
      mostrar(creacion.mensaje || MENSAJE_USUARIO_CREADO, "exito");
      setContrasenaInicial({
        usuario: creacion.usuario.usuario,
        valor: creacion.contrasenaInicial,
      });
      setUsuario("");
      setCorreo("");
      setNombre("");
      setApellido("");
      setEspecialidad("");
      setPagina(1);
      setCargando(true);
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setEnviando(false);
    }
  };

  const nombreDeOrganizacion = (id: string | null): string => {
    if (id === null) {
      return "—";
    }
    return organizaciones.find((organizacion) => organizacion.id === id)
      ?.nombre ?? "—";
  };

  const hayAnterior = (usuarios?.meta.page ?? 1) > 1;
  const haySiguiente =
    usuarios !== null &&
    usuarios.meta.page * usuarios.meta.limit < usuarios.meta.total;
  const filtrando = filtroOrganizacion !== "";

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-medium text-neutral-700">Usuarios</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Alta de profesores y estudiantes con su contraseña inicial.
        </p>

        <form
          data-testid="form-usuario"
          onSubmit={(evento) => void enviar(evento)}
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-rol"
              className="text-sm font-medium text-neutral-700"
            >
              Rol
            </label>
            <select
              id="usuario-rol"
              name="rol"
              value={rol}
              onChange={(evento) =>
                setRol(RolCreableSchema.parse(evento.target.value))
              }
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {ROLES_ALTA.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-organizacion"
              className="text-sm font-medium text-neutral-700"
            >
              Organización
            </label>
            <select
              id="usuario-organizacion"
              name="organizacion"
              value={organizacionId}
              onChange={(evento) => setOrganizacionId(evento.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">Elige una organización…</option>
              {organizaciones.map((organizacion) => (
                <option key={organizacion.id} value={organizacion.id}>
                  {organizacion.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-usuario"
              className="text-sm font-medium text-neutral-700"
            >
              Usuario
            </label>
            <input
              id="usuario-usuario"
              name="usuario"
              type="text"
              autoComplete="off"
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
              placeholder="nombre.apellido"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-correo"
              className="text-sm font-medium text-neutral-700"
            >
              Correo
            </label>
            <input
              id="usuario-correo"
              name="correo"
              type="email"
              autoComplete="off"
              value={correo}
              onChange={(evento) => setCorreo(evento.target.value)}
              placeholder="correo@educoins.test"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-nombre"
              className="text-sm font-medium text-neutral-700"
            >
              Nombre
            </label>
            <input
              id="usuario-nombre"
              name="nombre"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="usuario-apellido"
              className="text-sm font-medium text-neutral-700"
            >
              Apellido
            </label>
            <input
              id="usuario-apellido"
              name="apellido"
              type="text"
              autoComplete="off"
              value={apellido}
              onChange={(evento) => setApellido(evento.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          {rol === "teacher" && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label
                htmlFor="usuario-especialidad"
                className="text-sm font-medium text-neutral-700"
              >
                Especialidad (opcional, solo profesores)
              </label>
              <input
                id="usuario-especialidad"
                name="especialidad"
                type="text"
                autoComplete="off"
                value={especialidad}
                onChange={(evento) => setEspecialidad(evento.target.value)}
                placeholder="Mathematics"
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Enviando…" : "Crear usuario"}
            </button>
          </div>
        </form>

        {contrasenaInicial !== null && (
          <div
            role="status"
            data-testid="contrasena-inicial"
            className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
              Contraseña inicial de{" "}
              <span className="normal-case">{contrasenaInicial.usuario}</span>
            </p>
            <p className="mt-1 break-all font-mono text-lg font-semibold text-amber-900">
              {contrasenaInicial.valor}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Esta contraseña se muestra una sola vez: compártela con el
              usuario antes de que inicie sesión (deberá cambiarla al
              entrar).
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-base font-semibold text-neutral-900">
            Listado
          </h3>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="filtro-organizacion"
              className="text-xs font-medium text-neutral-500"
            >
              Filtrar por organización
            </label>
            <select
              id="filtro-organizacion"
              data-testid="filtro-organizacion"
              value={filtroOrganizacion}
              onChange={(evento) => cambiarFiltro(evento.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {organizaciones.map((organizacion) => (
                <option key={organizacion.id} value={organizacion.id}>
                  {organizacion.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {cargando && <EstadoCarga mensaje="Cargando usuarios…" />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={reintentar} />
        )}

        {error === null && !cargando && usuarios !== null && (
          <>
            {usuarios.meta.total === 0 ? (
              <EstadoVacio
                titulo={filtrando ? TITULO_VACIO_FILTRO : TITULO_VACIO}
                descripcion={
                  filtrando ? DESCRIPCION_VACIO_FILTRO : DESCRIPCION_VACIO
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table
                  className="w-full text-sm"
                  data-testid="lista-usuarios"
                  aria-label="Listado de usuarios"
                >
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th scope="col" className="py-2 font-medium">
                        Usuario
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Correo
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Rol
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Nombre
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Organización
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.data.map((fila) => (
                      <tr
                        key={fila.id}
                        data-testid="fila-usuario"
                        className="border-b border-neutral-100"
                      >
                        <td className="py-2 text-neutral-900">{fila.usuario}</td>
                        <td className="py-2 text-neutral-700">{fila.correo}</td>
                        <td className="py-2 text-neutral-700">
                          {ETIQUETAS_ROL[fila.rol]}
                        </td>
                        <td className="py-2 text-neutral-700">
                          {fila.nombre} {fila.apellido}
                        </td>
                        <td className="py-2 text-neutral-700">
                          {nombreDeOrganizacion(fila.organizacionId)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {usuarios.meta.total > 0 && (
              <div
                className="mt-4 flex items-center justify-between"
                aria-label="Paginación de usuarios"
              >
                <button
                  type="button"
                  onClick={() => cambiarPagina(usuarios.meta.page - 1)}
                  disabled={!hayAnterior}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-xs text-neutral-500">
                  Página {usuarios.meta.page} de{" "}
                  {Math.max(
                    1,
                    Math.ceil(usuarios.meta.total / usuarios.meta.limit),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => cambiarPagina(usuarios.meta.page + 1)}
                  disabled={!haySiguiente}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-sm">
        <Link
          href="/admin"
          className="font-medium text-neutral-700 underline-offset-2 hover:underline"
        >
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
