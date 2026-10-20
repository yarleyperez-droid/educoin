"use client";

/**
 * Organizaciones del panel admin (`/admin/organizaciones`) — T5.5.1 /
 * PRO-380 (H5.5).
 *
 * Listado paginado de organizaciones (`GET /organizations`, H2.4) con
 * formulario de alta (`POST /organizations`) en la misma página. El
 * alta muestra el toast del backend y vuelve a pedir la lista (el
 * backend es la fuente de verdad; AGENTS.md §6).
 *
 * Estados cubiertos (kit H5.2): carga, error con reintento y vacío.
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
  crearOrganizacion,
  listarOrganizaciones,
  LIMITE_ORGANIZACIONES,
} from "@/features/admin/organizaciones/api/organizaciones";
import {
  TipoOrganizacionSchema,
  type ListadoOrganizaciones,
  type TipoOrganizacion,
} from "@/features/admin/organizaciones/contrato/organizaciones";
import { ApiError } from "@/lib/api-client";

/** Título del estado vacío. */
const TITULO_VACIO = "Aún no hay organizaciones";

/** Descripción del estado vacío. */
const DESCRIPCION_VACIO =
  "Crea la primera institución con el formulario de arriba.";

/** Etiquetas de los tipos de organización en la UI. */
const ETIQUETAS_TIPO: Record<TipoOrganizacion, string> = {
  school: "Escuela",
  university: "Universidad",
  other: "Otra",
};

/** Texto de respaldo si el backend no devolviera `mensaje`. */
const MENSAJE_CREADA = "Organización creada con éxito.";

/**
 * Vista de organizaciones del admin.
 *
 * @returns Listado + formulario dentro del shell de `/admin`.
 */
export default function OrganizacionesPage() {
  const { mostrar } = useToast();
  const [listado, setListado] = useState<ListadoOrganizaciones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /** Contador para forzar una recarga desde un evento (reintento/alta). */
  const [recarga, setRecarga] = useState(0);

  // Formulario de alta.
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoOrganizacion>("school");
  const [ciudad, setCiudad] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const resultado = await listarOrganizaciones(pagina, LIMITE_ORGANIZACIONES);
        if (vigente) {
          setListado(resultado);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setListado(null);
          setError(e instanceof ApiError ? e.message : "Ocurrió un error inesperado. Intenta de nuevo.");
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
  }, [pagina, recarga]);

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const enviar = async (
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    evento.preventDefault();
    const nombreLimpio = nombre.trim();
    if (nombreLimpio.length < 3) {
      mostrar("El nombre debe tener al menos 3 caracteres.", "error");
      return;
    }

    setEnviando(true);
    try {
      const creacion = await crearOrganizacion({
        nombre: nombreLimpio,
        tipo,
        ciudad: ciudad.trim(),
      });
      mostrar(creacion.mensaje || MENSAJE_CREADA, "exito");
      setNombre("");
      setCiudad("");
      // Volver a pedir la lista (fuente de verdad: la API).
      setPagina(1);
      setCargando(true);
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setEnviando(false);
    }
  };

  const hayAnterior = (listado?.meta.page ?? 1) > 1;
  const haySiguiente =
    listado !== null &&
    listado.meta.page * listado.meta.limit < listado.meta.total;

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-medium text-neutral-700">
          Organizaciones
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Alta y listado de las instituciones de la plataforma.
        </p>

        <form
          data-testid="form-organizacion"
          onSubmit={(evento) => void enviar(evento)}
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="org-nombre"
              className="text-sm font-medium text-neutral-700"
            >
              Nombre
            </label>
            <input
              id="org-nombre"
              name="nombre"
              type="text"
              autoComplete="off"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder="Nombre de la institución"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="org-tipo"
              className="text-sm font-medium text-neutral-700"
            >
              Tipo
            </label>
            <select
              id="org-tipo"
              name="tipo"
              value={tipo}
              onChange={(evento) =>
                setTipo(TipoOrganizacionSchema.parse(evento.target.value))
              }
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {TipoOrganizacionSchema.options.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {ETIQUETAS_TIPO[opcion]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="org-ciudad"
              className="text-sm font-medium text-neutral-700"
            >
              Ciudad (opcional)
            </label>
            <input
              id="org-ciudad"
              name="ciudad"
              type="text"
              autoComplete="off"
              value={ciudad}
              onChange={(evento) => setCiudad(evento.target.value)}
              placeholder="Ciudad"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={enviando}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Enviando…" : "Crear organización"}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-base font-semibold text-neutral-900">
          Listado
        </h3>

        {cargando && <EstadoCarga mensaje="Cargando organizaciones…" />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={reintentar} />
        )}

        {error === null && !cargando && listado !== null && (
          <>
            {listado.meta.total === 0 ? (
              <EstadoVacio
                titulo={TITULO_VACIO}
                descripcion={DESCRIPCION_VACIO}
              />
            ) : (
              <table
                className="mt-4 w-full text-sm"
                data-testid="lista-organizaciones"
                aria-label="Listado de organizaciones"
              >
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th scope="col" className="py-2 font-medium">
                      Nombre
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Tipo
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Ciudad
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listado.data.map((organizacion) => (
                    <tr
                      key={organizacion.id}
                      data-testid="fila-organizacion"
                      className="border-b border-neutral-100"
                    >
                      <td className="py-2 text-neutral-900">
                        {organizacion.nombre}
                      </td>
                      <td className="py-2 text-neutral-700">
                        {ETIQUETAS_TIPO[organizacion.tipo]}
                      </td>
                      <td className="py-2 text-neutral-700">
                        {organizacion.ciudad ?? "—"}
                      </td>
                      <td className="py-2 text-neutral-700">
                        {organizacion.activa ? "Activa" : "Inactiva"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {listado.meta.total > 0 && (
              <div
                className="mt-4 flex items-center justify-between"
                aria-label="Paginación de organizaciones"
              >
                <button
                  type="button"
                  onClick={() => cambiarPagina(listado.meta.page - 1)}
                  disabled={!hayAnterior}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-xs text-neutral-500">
                  Página {listado.meta.page} de{" "}
                  {Math.max(
                    1,
                    Math.ceil(listado.meta.total / listado.meta.limit),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => cambiarPagina(listado.meta.page + 1)}
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
