/**
 * Vista de canje del estudiante (`/student/canje`) — T5.7.2 / PRO-391.
 *
 * Tienda de recompensas: lista los ítems **activos** de las clases donde
 * el estudiante está inscrito (catálogo abierto en T5.7.2) y, al
 * seleccionar uno, muestra la **confirmación previa** con costo, saldo y
 * stock (previsualización de H4.4) antes de descontar (CA 2 de H5.7).
 *
 * Reglas (spec §supuestos): el estudiante no envía costo/saldo/stock —
 * solo el `itemId`; tras cualquier resultado (éxito o error) el saldo se
 * **refresca contra la API** (el rollback total lo garantiza la BD, el
 * front no recalcula). Errores 422/409 salen con el `message` real del
 * backend vía toast (cliente H5.1).
 */

"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import {
  canjear,
  listarItems,
  previsualizarCanje,
} from "@/features/billetera/api/canje";
import { obtenerSaldo } from "@/features/billetera/api/billetera";
import type {
  ItemCanje,
  PrevisualizacionCanje,
} from "@/features/billetera/contrato/canje";
import { ApiError } from "@/lib/api-client";

/** Título del estado vacío del catálogo. */
const TITULO_VACIO = "Aún no hay ítems canjeables";

/** Descripción del estado vacío del catálogo. */
const DESCRIPCION_VACIO =
  "Cuando tu profesor agregue recompensas a tus clases, aparecerán aquí.";

/** Texto del botón de confirmación del canje. */
const TEXTO_CONFIRMAR = "Confirmar canje";

/** Texto del botón de cancelar la confirmación. */
const TEXTO_CANCELAR = "Cancelar";

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
 * Vista de canje: catálogo, confirmación de costo/saldo/stock y resultado.
 *
 * @returns Contenido de la tienda dentro del shell del panel estudiante.
 */
export default function CanjePage() {
  const { mostrar } = useToast();
  const [items, setItems] = useState<ItemCanje[]>([]);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<ItemCanje | null>(null);
  const [preview, setPreview] = useState<PrevisualizacionCanje | null>(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [canjeando, setCanjeando] = useState(false);
  /** Contador para forzar una recarga desde un evento (tras canje/error). */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function recargar(): Promise<void> {
      try {
        const [lista, saldoNuevo] = await Promise.all([
          listarItems(),
          obtenerSaldo(),
        ]);
        if (vigente) {
          setItems(lista);
          setSaldo(saldoNuevo.monedasDisponibles);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setError(e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO);
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void recargar();

    return () => {
      vigente = false;
    };
  }, [recarga]);

  /** Recarga el catálogo y el saldo contra la API (evento de usuario). */
  function recargarDesdeEvento(): void {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  }

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

  /** Reintenta la carga del catálogo tras un error (evento de usuario). */
  function reintentar(): void {
    recargarDesdeEvento();
  }

  /**
   * Confirma el canje y fuerza el refresco de saldo/catálogo contra la
   * API, tanto en éxito como en error (CA 3: el saldo no cambia si falla
   * y el front nunca recalcula).
   */
  async function confirmar(): Promise<void> {
    if (seleccion === null) return;
    setCanjeando(true);
    try {
      const canje = await canjear(seleccion.id);
      mostrar(`Canje realizado: ${canje.nombreItem}.`, "exito");
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setCanjeando(false);
      cancelar();
      recargarDesdeEvento();
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">
        Canjear monedas
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Elige una recompensa y confirma antes de descontar tus monedas.
      </p>

      {saldo !== null && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Saldo disponible:{" "}
          <span data-testid="saldo-canje">{saldo}</span> monedas
        </p>
      )}

      {cargando && <EstadoCarga mensaje="Cargando recompensas…" />}

      {error !== null && !cargando && (
        <EstadoError mensaje={error} alReintentar={reintentar} />
      )}

      {error === null && !cargando && items.length === 0 && (
        <EstadoVacio
          titulo={TITULO_VACIO}
          descripcion={DESCRIPCION_VACIO}
        />
      )}

      {error === null && !cargando && items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-neutral-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {item.name}
                  </p>
                  {item.description !== null && (
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-neutral-500">
                    {item.type === "grade_bonus"
                      ? `Bono de nota (+${item.gradePoints ?? "?"} puntos)`
                      : "Actividad lúdica"}{" "}
                    · Stock: {formatearStock(item.stock)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {item.costCoins} monedas
                  </span>
                  <button
                    type="button"
                    onClick={() => void seleccionar(item)}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2"
                  >
                    Canjear
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {seleccion !== null && (
        <section
          className="mt-6 rounded-md border border-neutral-300 bg-neutral-50 p-4"
          aria-label="Confirmar canje"
        >
          <h3 className="text-sm font-semibold text-neutral-900">
            Confirmar canje
          </h3>

          {cargandoPreview && (
            <EstadoCarga mensaje="Verificando costo y saldo…" />
          )}

          {preview !== null && !cargandoPreview && (
            <>
              <dl className="mt-3 space-y-1 text-sm text-neutral-700">
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
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-neutral-700 disabled:opacity-40"
                >
                  {canjeando ? "Canjeando…" : TEXTO_CONFIRMAR}
                </button>
                <button
                  type="button"
                  onClick={cancelar}
                  disabled={canjeando}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 enabled:hover:bg-neutral-50 disabled:opacity-40"
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
