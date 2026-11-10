/**
 * Cola de canjes del profesor (`/teacher/canjes`) — H7.4 (canje revisable).
 *
 * Cola paginada de las solicitudes `pending` de SUS clases
 * (`GET /redemptions/pending`, T7.2.4, FIFO por `redeemed_at`) con las
 * acciones de resolución de T7.2.3: **Aprobar** y **Rechazar** (solo en
 * `pending`) y **Entregar** (solo en `approved`), cada una con
 * confirmación en un `Modal` accesible, toast de éxito/error y recarga de
 * la cola. Los mensajes de error (`403`/`404`/`409` "El canje ya fue
 * resuelto") llegan con el texto exacto del backend vía
 * `mensajeDeErrorApi` (cliente H5.1).
 *
 * Nota de contrato (`redemptions.service.ts:colaPendientes`): el endpoint
 * solo devuelve filas `pending`, así que una fila **aprobada** en esta
 * sesión se conserva en la lista hasta que se entregue (el backend la
 * ocultaría al recargar); las filas terminales (`delivered`/`rejected`)
 * salen de la lista y la cola se recarga contra el servidor.
 *
 * Estados cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **vacío** ("No hay canjes pendientes") y **error** con reintento. El
 * badge de estado vive en `features/billetera/componentes/`
 * (`badge-estado-canje`): una sola fuente de etiquetas para
 * `redemption_status`, compartida con "Mis canjes" del estudiante.
 */

"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  Modal,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import {
  aprobarCanje,
  entregarCanje,
  listarPendientes,
  rechazarCanje,
} from "@/features/teacher/api/canjes";
import { BadgeEstadoCanje } from "@/features/billetera/componentes/badge-estado-canje";
import type {
  CanjeListado,
  Meta,
} from "@/features/billetera/contrato/canje";
import { ApiError } from "@/lib/api-client";

/** Tamaño de página fijo de la cola (el backend acepta 1–100). */
const LIMITE_COLA = 20;

/** Título del estado vacío. */
const TITULO_VACIO = "No hay canjes pendientes";

/** Descripción del estado vacío. */
const DESCRIPCION_VACIO =
  "Cuando tus estudiantes soliciten canjear recompensas, sus solicitudes aparecerán aquí.";

/** Acciones de resolución que el profesor puede pedir desde la fila. */
type AccionUI = "aprobar" | "rechazar" | "entregar";

/** Título del diálogo de confirmación por acción. */
const TITULOS_CONFIRMACION: Readonly<Record<AccionUI, string>> = {
  aprobar: "Aprobar canje",
  rechazar: "Rechazar canje",
  entregar: "Entregar canje",
};

/** Texto del botón de confirmación por acción. */
const BOTONES_CONFIRMACION: Readonly<Record<AccionUI, string>> = {
  aprobar: "Aprobar",
  rechazar: "Rechazar",
  entregar: "Marcar como entregado",
};

/** Toast de éxito por acción resuelta. */
const MENSAJES_EXITO: Readonly<Record<AccionUI, string>> = {
  aprobar: "Canje aprobado. Ya puedes marcarlo como entregado.",
  rechazar: "Canje rechazado. Las monedas fueron devueltas al estudiante.",
  entregar: "Canje entregado.",
};

/**
 * Cuerpo del diálogo de confirmación: qué se va a resolver y para quién.
 *
 * @param fila Canje afectado.
 * @param accion Acción que se va a confirmar.
 * @returns Texto legible para el diálogo.
 */
function textoConfirmacion(fila: CanjeListado, accion: AccionUI): string {
  switch (accion) {
    case "aprobar":
      return `¿Aprobar el canje de “${fila.nombreItem}” para ${fila.nombreEstudiante}? Quedará pendiente de entrega.`;
    case "rechazar":
      return `¿Rechazar el canje de “${fila.nombreItem}” para ${fila.nombreEstudiante}? Se devolverán las ${fila.costoMonedas} monedas al estudiante.`;
    case "entregar":
      return `¿Confirmar que “${fila.nombreItem}” ya fue entregado a ${fila.nombreEstudiante}?`;
  }
}

/**
 * Formatea la fecha de solicitud en formato local legible.
 *
 * @param iso Fecha ISO del backend.
 * @returns Fecha local, p. ej. "18/10/2026, 12:30".
 */
function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Cola de canjes: tabla paginada con resolución por fila y confirmación.
 *
 * @returns Contenido de la cola dentro del shell del panel docente.
 */
export default function ColaCanjesPage() {
  const { mostrar } = useToast();
  const [filas, setFilas] = useState<CanjeListado[]>([]);
  const [meta, setMeta] = useState<Meta>({
    total: 0,
    page: 1,
    limit: LIMITE_COLA,
  });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  /** Contador para forzar una recarga desde un evento (reintento/resolución). */
  const [recarga, setRecarga] = useState(0);
  /** Confirmación abierta (fila + acción), o `null` si no hay ninguna. */
  const [confirmacion, setConfirmacion] = useState<{
    fila: CanjeListado;
    accion: AccionUI;
  } | null>(null);
  const [resolviendo, setResolviendo] = useState(false);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const cola = await listarPendientes(pagina, LIMITE_COLA);

        if (vigente) {
          // Conserva las filas aprobadas en esta sesión (a la espera de
          // entrega): el backend solo lista `pending`, así que la recarga
          // no las devuelve y el profesor aún debe poder entregarlas.
          setFilas((actuales) => {
            const idsServidor = new Set(cola.data.map((fila) => fila.id));
            const enEsperaDeEntrega = actuales.filter(
              (fila) => fila.estado === "approved" && !idsServidor.has(fila.id),
            );
            return [...enEsperaDeEntrega, ...cola.data];
          });
          setMeta(cola.meta);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setFilas([]);
          setError(e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO);
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

  /**
   * Cambia la página de la cola (Anterior/Siguiente).
   *
   * @param nueva Página destino (1-indexada).
   */
  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  /** Recarga la cola contra el servidor (reintento / tras resolver). */
  const recargar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  /**
   * Abre el diálogo de confirmación de la acción pedida sobre una fila.
   *
   * @param fila Canje afectado.
   * @param accion Acción solicitada (aprobar/rechazar/entregar).
   */
  const pedirConfirmacion = (fila: CanjeListado, accion: AccionUI): void => {
    setConfirmacion({ fila, accion });
  };

  /**
   * Ejecuta la resolución confirmada: aplica el estado devuelto por la
   * API a la fila, avisa con un toast y recarga la cola. Si la resolución
   * es terminal (`delivered`/`rejected`) la fila sale de la lista. Los
   * errores muestran el mensaje exacto del backend y también recargan
   * (p. ej. el `409` de una resolución ya tomada).
   */
  async function resolver(): Promise<void> {
    if (confirmacion === null) return;

    const { fila, accion } = confirmacion;
    setResolviendo(true);

    try {
      const resolucion =
        accion === "aprobar"
          ? await aprobarCanje(fila.id)
          : accion === "rechazar"
            ? await rechazarCanje(fila.id)
            : await entregarCanje(fila.id);

      mostrar(MENSAJES_EXITO[accion], "exito");

      setFilas((actuales) =>
        actuales
          .map((actual) =>
            actual.id === resolucion.id
              ? { ...actual, estado: resolucion.estado }
              : actual,
          )
          .filter(
            (actual) =>
              actual.estado !== "delivered" && actual.estado !== "rejected",
          ),
      );
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setResolviendo(false);
      setConfirmacion(null);
      recargar();
    }
  }

  const hayAnterior = meta.page > 1;
  const haySiguiente = meta.page * meta.limit < meta.total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
          Canjes pendientes
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Solicitudes de recompensas de tus clases, en orden de llegada.
          Apruébalas, recházalas (con devolución de monedas) o márcalas como
          entregadas.
        </p>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {cargando && <EstadoCarga mensaje="Cargando canjes…" />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={recargar} />
        )}

        {error === null && !cargando && filas.length === 0 && (
          <EstadoVacio titulo={TITULO_VACIO} descripcion={DESCRIPCION_VACIO} />
        )}

        {error === null && !cargando && filas.length > 0 && (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Estudiante
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Recompensa
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Costo
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Solicitado
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map((fila) => (
                    <tr key={fila.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">
                          {fila.nombreEstudiante}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{fila.nombreItem}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {fila.costoMonedas} monedas
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatearFecha(fila.solicitadoEn)}
                      </td>
                      <td className="px-4 py-3">
                        <BadgeEstadoCanje estado={fila.estado} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {fila.estado === "pending" && (
                            <>
                              <button
                                type="button"
                                onClick={() => pedirConfirmacion(fila, "aprobar")}
                                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                onClick={() => pedirConfirmacion(fila, "rechazar")}
                                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                          {fila.estado === "approved" && (
                            <button
                              type="button"
                              onClick={() => pedirConfirmacion(fila, "entregar")}
                              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                            >
                              Entregar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav
              className="mt-4 flex items-center justify-between text-sm"
              aria-label="Paginación de la cola"
            >
              <button
                type="button"
                onClick={() => cambiarPagina(pagina - 1)}
                disabled={!hayAnterior}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-slate-500" role="status">
                Página {meta.page} de{" "}
                {Math.max(1, Math.ceil(meta.total / meta.limit))}
              </span>
              <button
                type="button"
                onClick={() => cambiarPagina(pagina + 1)}
                disabled={!haySiguiente}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
              >
                Siguiente
              </button>
            </nav>
          </>
        )}
      </div>

      {/* Confirmación antes de resolver: aprobar/rechazar/entregar. */}
      <Modal
        abierto={confirmacion !== null}
        titulo={
          confirmacion !== null ? TITULOS_CONFIRMACION[confirmacion.accion] : ""
        }
        alCerrar={() => {
          if (!resolviendo) setConfirmacion(null);
        }}
        acciones={
          <>
            <button
              type="button"
              onClick={() => void resolver()}
              disabled={resolviendo}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${
                confirmacion?.accion === "rechazar"
                  ? "bg-red-600 hover:bg-red-700"
                  : confirmacion?.accion === "entregar"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {resolviendo
                ? "Procesando…"
                : confirmacion !== null
                  ? BOTONES_CONFIRMACION[confirmacion.accion]
                  : ""}
            </button>
            <button
              type="button"
              onClick={() => setConfirmacion(null)}
              disabled={resolviendo}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancelar
            </button>
          </>
        }
      >
        {confirmacion !== null && (
          <p className="text-sm text-slate-700">
            {textoConfirmacion(confirmacion.fila, confirmacion.accion)}
          </p>
        )}
      </Modal>
    </div>
  );
}
