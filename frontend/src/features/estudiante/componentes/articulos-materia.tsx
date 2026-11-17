/**
 * Artículos de la materia + canje — H10.3 (T10.3.3).
 *
 * Segundo nivel de la tienda: los artículos **activos** de la materia
 * elegida (décimas, costo en EduCoins y stock) y el canje reutilizando el
 * flujo existente sin cambios de contrato:
 *
 * - **Previsualización** (H4.4): `GET /redemptions/preview` congela
 *   costo, saldo y stock ANTES de confirmar; `puedeCanjear=false`
 *   deshabilita el botón mostrando el motivo del backend.
 * - **Canje revisable** (H7.3): `POST /redemptions` devuelve el estado
 *   real — `pending` ("Solicitud enviada") o `approved` con
 *   `aprobacionAutomatica` ("Aprobado automáticamente, pendiente de
 *   entrega"). El panel de resultado permite saltar a la pestaña
 *   "Mis canjes" (CA 4).
 *
 * Tras cualquier resultado (éxito o error) el saldo y el catálogo se
 * **refrescan contra la API** vía el contenedor (`alRecargar`): el
 * rollback total lo garantiza la BD, el front no recalcula (H4.4).
 */

"use client";

import { useState } from "react";

import {
  EstadoCarga,
  EstadoVacio,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import {
  canjear,
  previsualizarCanje,
} from "@/features/billetera/api/canje";
import type {
  Canje,
  ItemCanje,
  PrevisualizacionCanje,
} from "@/features/billetera/contrato/canje";
import type { MateriaConArticulos } from "./materias-estudiante";

/** Texto del botón de confirmación del canje. */
const TEXTO_CONFIRMAR = "Confirmar canje";

/** Texto del botón de cancelar la confirmación. */
const TEXTO_CANCELAR = "Cancelar";

/** Toast cuando el canje nace `pending` (H7.3). */
const MENSAJE_PENDIENTE =
  "Solicitud enviada: pendiente de aprobación del profesor.";

/** Toast cuando el canje sale `approved` por auto-aprobación (H7.3). */
const MENSAJE_AUTOAPROBADO = "Aprobado automáticamente, pendiente de entrega.";

/** Propiedades de la vista de artículos de la materia. */
interface PropsArticulos {
  materia: MateriaConArticulos;
  /** Artículos activos de ESA clase (ya filtrados por el contenedor). */
  items: ItemCanje[];
  /** Saldo actual en monedas (`null` mientras carga). */
  saldo: number | null;
  /** Recarga catálogo + saldo contra la API (tras canje o error). */
  alRecargar: () => void;
  /** Vuelve al listado de materias. */
  alVolver: () => void;
  /** Salta a la pestaña "Mis canjes" desde el panel de resultado. */
  alVerMisCanjes: () => void;
}

/**
 * Título del panel de resultado según el estado real del canje.
 *
 * @param canje Canje recién confirmado (`CanjeRespuestaDto`).
 * @returns Título corto del panel.
 */
function tituloResultado(canje: Canje): string {
  if (canje.estado === "approved") {
    return canje.aprobacionAutomatica
      ? "Aprobado automáticamente"
      : "Aprobado";
  }

  if (canje.estado === "completed") {
    return "Canje realizado";
  }

  return "Solicitud enviada";
}

/**
 * Descripción del panel de resultado según el estado real del canje.
 *
 * @param canje Canje recién confirmado (`CanjeRespuestaDto`).
 * @returns Texto que explica qué pasa ahora con el canje y las monedas.
 */
function descripcionResultado(canje: Canje): string {
  if (canje.estado === "approved") {
    return `Tu canje de “${canje.nombreItem}” fue aprobado${
      canje.aprobacionAutomatica ? " automáticamente" : ""
    } y está pendiente de entrega.`;
  }

  if (canje.estado === "completed") {
    return `Tu canje de “${canje.nombreItem}” se completó.`;
  }

  return `Tu canje de “${canje.nombreItem}” está pendiente de aprobación del profesor. Tus ${canje.costoMonedas} monedas ya quedaron reservadas: si el profesor rechaza la solicitud, te las devolveremos.`;
}

/**
 * Etiqueta visible del stock: "Sin límite" cuando el backend devuelve
 * `null` (stock ilimitado).
 *
 * @param stock Número o `null`.
 * @returns Texto listo para la vista.
 */
function formatearStock(stock: number | null): string {
  return stock === null ? "Sin límite" : `${stock} disponibles`;
}

/**
 * Etiqueta del tipo de ítem con sus décimas (H10.1: 0.1–0.5).
 *
 * @param item Ítem del catálogo.
 * @returns Texto del tipo, p. ej. "Bono de nota (+0.5 puntos)".
 */
function textoTipo(item: ItemCanje): string {
  return item.type === "grade_bonus"
    ? `Bono de nota (+${item.gradePoints ?? "?"} puntos)`
    : "Actividad lúdica";
}

/**
 * Vista de artículos de la materia: catálogo acotado, confirmación de
 * costo/saldo/stock y resultado con el estado REAL del canje.
 *
 * @param props Materia, artículos, saldo y callbacks de navegación.
 * @returns Contenido del segundo nivel de la tienda del estudiante.
 */
export function ArticulosMateria({
  materia,
  items,
  saldo,
  alRecargar,
  alVolver,
  alVerMisCanjes,
}: PropsArticulos) {
  const { mostrar } = useToast();
  const [seleccion, setSeleccion] = useState<ItemCanje | null>(null);
  const [preview, setPreview] = useState<PrevisualizacionCanje | null>(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [canjeando, setCanjeando] = useState(false);
  /** Último canje confirmado (panel de resultado con su estado real). */
  const [resultado, setResultado] = useState<Canje | null>(null);

  /**
   * Selecciona un ítem y carga su previsualización
   * (`GET /redemptions/preview`).
   *
   * @param item Ítem elegido del catálogo.
   */
  async function seleccionar(item: ItemCanje): Promise<void> {
    setSeleccion(item);
    setCargandoPreview(true);
    setPreview(null);
    try {
      setPreview(await previsualizarCanje(item.id));
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
      setSeleccion(null);
    } finally {
      setCargandoPreview(false);
    }
  }

  /** Cancela la confirmación en curso. */
  function cancelar(): void {
    setSeleccion(null);
    setPreview(null);
  }

  /**
   * Confirma el canje y muestra su **estado real** (H7.3: `pending` o
   * `approved` con auto-aprobación), forzando además el refresco de
   * saldo/catálogo contra la API, tanto en éxito como en error (el saldo
   * no cambia si falla y el front nunca recalcula). Los errores 422/409
   * se muestran con el mensaje exacto del backend.
   */
  async function confirmar(): Promise<void> {
    if (seleccion === null) return;
    setCanjeando(true);
    setResultado(null);
    try {
      const canje = await canjear(seleccion.id);
      setResultado(canje);
      mostrar(
        canje.estado === "approved"
          ? MENSAJE_AUTOAPROBADO
          : MENSAJE_PENDIENTE,
        "exito",
      );
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setCanjeando(false);
      cancelar();
      alRecargar();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={alVolver}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            ← Volver a materias
          </button>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {materia.nombre}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Elige un artículo de esta materia y confirma antes de descontar
            tus monedas.
          </p>
        </div>
      </div>

      {saldo !== null && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          Saldo disponible:{" "}
          <span data-testid="saldo-canje">{saldo}</span> monedas
        </p>
      )}

      {/* Resultado del último canje: estado REAL (H7.3), no "Canje realizado". */}
      {resultado !== null && (
        <section
          aria-label="Resultado del canje"
          className={`rounded-md border p-4 ${
            resultado.estado === "approved"
              ? "border-emerald-200 bg-emerald-50"
              : "border-indigo-200 bg-indigo-50"
          }`}
        >
          <h3 className="text-sm font-semibold text-slate-900">
            {tituloResultado(resultado)}
          </h3>
          <p className="mt-1 text-sm text-slate-700">
            {descripcionResultado(resultado)}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={alVerMisCanjes}
              data-testid="ver-mis-canjes"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
            >
              Ver mis canjes
            </button>
            <button
              type="button"
              onClick={() => setResultado(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Seguir canjeando
            </button>
          </div>
        </section>
      )}

      {items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <EstadoVacio
            titulo="Esta materia todavía no tiene artículos"
            descripcion="Cuando tu profesor publique bonos de nota o actividades lúdicas, aparecerán aquí."
            accion={{ texto: "Volver a materias", alHacerClic: alVolver }}
          />
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.name}
                    </p>
                    {item.description !== null && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {textoTipo(item)} · Stock: {formatearStock(item.stock)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {item.costCoins} monedas
                    </span>
                    <button
                      type="button"
                      onClick={() => void seleccionar(item)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                    >
                      Canjear
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {seleccion !== null && (
        <section
          className="rounded-md border border-slate-300 bg-slate-50 p-4"
          aria-label="Confirmar canje"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            Confirmar canje
          </h3>

          {cargandoPreview && (
            <EstadoCarga mensaje="Verificando costo y saldo…" />
          )}

          {preview !== null && !cargandoPreview && (
            <>
              <dl className="mt-3 space-y-1 text-sm text-slate-700">
                <div className="flex justify-between">
                  <dt>Ítem</dt>
                  <dd className="font-medium">{preview.item.nombre}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Costo</dt>
                  <dd>{preview.item.costoMonedas} monedas</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Tu saldo</dt>
                  <dd>{preview.saldo.monedasDisponibles} monedas</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Stock</dt>
                  <dd>{formatearStock(preview.item.stock)}</dd>
                </div>
              </dl>

              {!preview.puedeCanjear && (
                <p
                  role="alert"
                  className="mt-3 text-sm font-medium text-red-700"
                >
                  {preview.motivo ?? "No puedes canjear este ítem."}
                </p>
              )}

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void confirmar()}
                  disabled={!preview.puedeCanjear || canjeando}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-40"
                >
                  {canjeando ? "Canjeando…" : TEXTO_CONFIRMAR}
                </button>
                <button
                  type="button"
                  onClick={cancelar}
                  disabled={canjeando}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 enabled:hover:bg-slate-50 disabled:opacity-40"
                >
                  {TEXTO_CANCELAR}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
