/**
 * Listado de clases del panel docente (`/teacher/clases`) — T5.6.3 (PRO-387).
 *
 * Vista cliente con **buscador** (CA 2 de H5.6: muestra las clases con su
 * estado) y acciones de edición de clase: renombrar inline y
 * archivar/reactivar. Cada fila enlaza al detalle de la clase, donde se
 * listan sus actividades.
 *
 * Restricción importante del contrato (spec §Contrato 1): `GET /classes`
 * **exige `q` de ≥ 3 caracteres** (mecánica pg_trgm de `BuscarClasesQueryDto`)
 * y no existe "listar todas mis clases sin texto", así que la vista arranca
 * pidiendo una búsqueda en lugar de un listado completo.
 *
 * Contrato con el backend:
 * - Los datos pasan por `features/teacher/api/clases.ts` (mock hoy;
 *   T5.6.4 reemplaza el interior sin tocar esta vista).
 * - Errores → `ApiError.message` en `role="alert"` (nunca `detalles` ni
 *   códigos HTTP); la lista existente **no se limpia** si una acción falla.
 */

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  actualizarClase,
  buscarClases,
  type ResultadoBusquedaClases,
} from "@/features/teacher/api/clases";
import { BadgeEstado } from "@/features/teacher/componentes/badge-estado";
import type { ClaseListado } from "@/features/teacher/tipos";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la búsqueda no llega a 3 caracteres. */
const MENSAJE_BUSQUEDA_CORTA =
  "La búsqueda debe tener al menos 3 caracteres.";

/** Mensaje cuando falla una acción sobre una fila (renombrar/archivar). */
const MENSAJE_ERROR_ACCION =
  "No se pudo completar la operación. Intenta de nuevo.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Listado y edición de clases con estados.
 *
 * Componente cliente con estado controlado a mano (sin `react-hook-form`,
 * decisión vigente). Cubre los estados de AGENTS.md §8: **carga**
 * (`cargando`), **vacío** (sin resultados o sin búsqueda) y **error**
 * (`role="alert"`).
 *
 * @returns Buscador y tabla de clases dentro del shell del panel docente.
 */
export default function ListadoClasesPage() {
  const [q, setQ] = useState("");
  const [resultado, setResultado] = useState<ResultadoBusquedaClases | null>(
    null,
  );
  const [cargando, setCargando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState("");

  /**
   * Ejecuta la búsqueda contra la capa de datos.
   *
   * @param texto Texto de búsqueda (≥ 3 caracteres ya validados).
   * @param pagina Página a consultar.
   */
  async function ejecutarBusqueda(texto: string, pagina: number): Promise<void> {
    setCargando(true);
    setErrorBusqueda(null);

    try {
      const encontradas = await buscarClases(texto, pagina);
      setResultado(encontradas);
    } catch (e) {
      setErrorBusqueda(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
      );
    } finally {
      setCargando(false);
    }
  }

  /**
   * Procesa el envío del buscador.
   *
   * Valida en cliente los 3 caracteres mínimos (sin llamar a la capa) y
   * arranca la búsqueda en la página 1.
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarBusqueda(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();

    if (q.trim().length < 3) {
      setErrorBusqueda(MENSAJE_BUSQUEDA_CORTA);
      return;
    }

    await ejecutarBusqueda(q.trim(), 1);
  }

  /**
   * Cambia de página conservando el texto de búsqueda actual.
   *
   * @param pagina Nueva página (1-indexada).
   */
  async function cambiarPagina(pagina: number): Promise<void> {
    await ejecutarBusqueda(q.trim(), pagina);
  }

  /**
   * Refresca la lista tras una acción (conserva texto y página).
   */
  async function refrescar(): Promise<void> {
    if (resultado) {
      await ejecutarBusqueda(q.trim(), resultado.meta.page);
    }
  }

  /**
   * Guarda el nuevo nombre de la clase en edición.
   *
   * Si falla, el error queda en `errorAccion` y **la fila conserva lo
   * escrito** (no se cierra el modo edición).
   */
  async function guardarRenombrar(): Promise<void> {
    if (!editandoId) {
      return;
    }

    setErrorAccion(null);

    try {
      await actualizarClase(editandoId, { nombre: nombreEdicion });
      setEditandoId(null);
      await refrescar();
    } catch (e) {
      setErrorAccion(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_ACCION,
      );
    }
  }

  /**
   * Archiva una clase activa o la reactiva si está archivada.
   *
   * @param clase Fila de la clase afectada.
   */
  async function cambiarEstado(clase: ClaseListado): Promise<void> {
    setErrorAccion(null);

    try {
      await actualizarClase(clase.id, {
        estado: clase.estado === "active" ? "archived" : "active",
      });
      await refrescar();
    } catch (e) {
      setErrorAccion(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_ACCION,
      );
    }
  }

  return (
    <div className="w-full max-w-3xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            Mis clases
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Busca una clase por nombre (mínimo 3 caracteres) para verla y
            editarla.
          </p>
        </div>
        <Link
          href="/teacher/clases/nueva"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
        >
          Nueva clase
        </Link>
      </div>

      <form
        onSubmit={manejarBusqueda}
        noValidate
        className="mt-6 flex items-end gap-2"
      >
        <div className="flex-1">
          <label
            htmlFor="buscar-clase"
            className="block text-sm font-medium text-neutral-700"
          >
            Buscar clase
          </label>
          <input
            id="buscar-clase"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={cargando}
            placeholder="p. ej. Matemáticas"
            aria-describedby="ayuda-busqueda"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p id="ayuda-busqueda" className="mt-1 text-xs text-neutral-500">
            Mínimo 3 caracteres.
          </p>
        </div>
        <button
          type="submit"
          disabled={cargando}
          aria-busy={cargando}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cargando ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {errorBusqueda !== null && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {errorBusqueda}
        </p>
      )}

      {errorAccion !== null && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {errorAccion}
        </p>
      )}

      {resultado === null && errorBusqueda === null && (
        <p className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          Escribe al menos 3 caracteres para buscar tus clases.
        </p>
      )}

      {resultado !== null && resultado.data.length === 0 && !cargando && (
        <p className="mt-6 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          No encontramos clases que coincidan con «{q.trim()}».
        </p>
      )}

      {resultado !== null && resultado.data.length > 0 && (
        <>
          <ul className="mt-6 space-y-3">
            {resultado.data.map((clase) => (
              <li
                key={clase.id}
                className="rounded-md border border-neutral-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {editandoId === clase.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <label htmlFor={`nombre-${clase.id}`} className="sr-only">
                        Nuevo nombre de la clase
                      </label>
                      <input
                        id={`nombre-${clase.id}`}
                        type="text"
                        value={nombreEdicion}
                        onChange={(e) => setNombreEdicion(e.target.value)}
                        autoFocus
                        className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                      />
                      <button
                        type="button"
                        onClick={guardarRenombrar}
                        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditandoId(null)}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/teacher/clases/${clase.id}`}
                          className="text-sm font-medium text-neutral-900 underline-offset-2 hover:underline"
                        >
                          {clase.nombre}
                        </Link>
                        <BadgeEstado estado={clase.estado} />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditandoId(clase.id);
                            setNombreEdicion(clase.nombre);
                            setErrorAccion(null);
                          }}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                        >
                          Renombrar
                        </button>
                        <button
                          type="button"
                          onClick={() => cambiarEstado(clase)}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                        >
                          {clase.estado === "active"
                            ? "Archivar"
                            : "Reactivar"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <p className="mt-1 text-xs text-neutral-500">
                  {clase.profesorNombre} · Creada el{" "}
                  {new Date(clase.creadoEn).toLocaleDateString("es-CO")}
                </p>
              </li>
            ))}
          </ul>

          {resultado.meta.total > resultado.meta.limit && (
            <nav
              aria-label="Paginación de clases"
              className="mt-4 flex items-center justify-between text-sm"
            >
              <button
                type="button"
                disabled={cargando || resultado.meta.page <= 1}
                onClick={() => cambiarPagina(resultado.meta.page - 1)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Anterior
              </button>
              <span className="text-neutral-500">
                Página {resultado.meta.page} de{" "}
                {Math.max(
                  1,
                  Math.ceil(resultado.meta.total / resultado.meta.limit),
                )}
              </span>
              <button
                type="button"
                disabled={
                  cargando ||
                  resultado.meta.page * resultado.meta.limit >=
                    resultado.meta.total
                }
                onClick={() => cambiarPagina(resultado.meta.page + 1)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
