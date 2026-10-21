"use client";

import { useEffect, useMemo, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  useToast,
  IconDownload,
  IconSearch,
  IconCheckCircle,
  IconShield,
  IconLock,
  IconDocumentText,
  IconBookOpen,
} from "@/components/ui";
import {
  obtenerHistorial,
  obtenerSaldo,
} from "@/features/billetera/api/billetera";
import type {
  MovimientoBilletera,
  SaldoBilletera,
  TipoMovimiento,
} from "@/features/billetera/contrato/billetera";
import { ApiError } from "@/lib/api-client";

const LIMITE_HISTORIAL = 20;

const TITULO_VACIO = "Aún no hay movimientos";
const DESCRIPCION_VACIO =
  "Cuando resuelvas actividades o registres canjes, tus movimientos de monedas aparecerán aquí.";

const ETIQUETAS_TIPO: Readonly<Record<TipoMovimiento, string>> = {
  earning: "Emisión de Recompensa",
  spending: "Canje de Tienda",
  reversal: "Devolución / Ajuste",
  adjustment: "Ajuste",
};

const SUB_ETIQUETAS_TIPO: Readonly<Partial<Record<TipoMovimiento, string>>> = {
  earning: "Calificación Académica",
  spending: "Beneficio Académico",
  reversal: "Garantía Institucional",
  adjustment: "Onboarding Institucional",
};

const ESTADO_TIPO: Readonly<Record<TipoMovimiento, string>> = {
  earning: "Acreditado",
  spending: "Canjeado",
  reversal: "Reembolsado",
  adjustment: "Ajustado",
};

const FILTROS: { key: TipoMovimiento | "todos"; label: string; corto: string }[] = [
  { key: "todos", label: "Todos los movimientos", corto: "Todos" },
  { key: "earning", label: "Ganancias (+)", corto: "Ganancias" },
  { key: "spending", label: "Canjes (-)", corto: "Canjes" },
  { key: "reversal", label: "Anulaciones / Devoluciones", corto: "Anulaciones" },
  { key: "adjustment", label: "Ajustes", corto: "Ajustes" },
];

function clasePorTipo(tipo: TipoMovimiento): string {
  switch (tipo) {
    case "earning":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "spending":
      return "bg-red-50 text-red-700 ring-red-200";
    case "reversal":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "adjustment":
      return "bg-amber-50 text-amber-700 ring-amber-200";
  }
}

function colorImpacto(cantidad: number): string {
  return cantidad < 0 ? "text-red-600" : "text-emerald-600";
}

function formatearCantidad(cantidad: number): string {
  const signo = cantidad > 0 ? "+" : "";
  return `${signo}${cantidad}`;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function BilleteraPage() {
  const { mostrar } = useToast();
  const [saldo, setSaldo] = useState<SaldoBilletera | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoBilletera[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: LIMITE_HISTORIAL });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);
  const [filtro, setFiltro] = useState<TipoMovimiento | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [saldoNuevo, historial] = await Promise.all([
          obtenerSaldo(),
          obtenerHistorial(pagina, LIMITE_HISTORIAL),
        ]);
        if (vigente) {
          setSaldo(saldoNuevo);
          setMovimientos(historial.data);
          setMeta(historial.meta);
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

  const conteos = useMemo(() => {
    const total = movimientos.length;
    const porTipo = {
      earning: movimientos.filter((m) => m.tipo === "earning").length,
      spending: movimientos.filter((m) => m.tipo === "spending").length,
      reversal: movimientos.filter((m) => m.tipo === "reversal").length,
      adjustment: movimientos.filter((m) => m.tipo === "adjustment").length,
    };
    return { total, porTipo };
  }, [movimientos]);

  const movimientosFiltrados = useMemo(() => {
    const normalizada = busqueda.trim().toLowerCase();
    return movimientos.filter((movimiento) => {
      const coincideTipo = filtro === "todos" || movimiento.tipo === filtro;
      const coincideBusqueda =
        normalizada === "" ||
        (movimiento.descripcion?.toLowerCase().includes(normalizada) ?? false) ||
        movimiento.claseNombre.toLowerCase().includes(normalizada);
      return coincideTipo && coincideBusqueda;
    });
  }, [movimientos, filtro, busqueda]);

  const hayAnterior = meta.page > 1;
  const haySiguiente = meta.page * meta.limit < meta.total;

  const disponibles = saldo?.monedasDisponibles ?? 0;
  const ganadas = saldo?.monedasGanadas ?? 0;
  const gastadas = saldo?.monedasGastadas ?? 0;

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando tu billetera…' />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoError mensaje={error} alReintentar={reintentar} />
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-slate-900 lg:text-3xl'>
            Mi Billetera Digital
          </h1>
          <p className='mt-1 max-w-2xl text-sm text-slate-500'>
            Consulta tu balance líquido, tus monedas ganadas históricas y el registro de transacciones académicas.
          </p>
        </div>
        <div className='flex shrink-0 gap-2'>
          <button
            type='button'
            onClick={() => mostrar("Descarga de extracto próximamente.", "exito")}
            className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
          >
            <IconDownload className='h-4 w-4' />
            Descargar Extracto PDF
          </button>
        </div>
      </div>

      {/* Hero saldo */}
      <section className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg lg:p-8'>
        <div className='relative z-10 space-y-6'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-wide text-indigo-100'>
              Saldo disponible para gastar
            </p>
            <div className='mt-1 flex items-center gap-3'>
              <p className='text-4xl font-bold lg:text-5xl' data-testid='saldo-disponibles'>
                {disponibles}
              </p>
              <span className='text-lg font-medium text-indigo-100'>EduCoins</span>
            </div>
          </div>

          <div className='rounded-xl bg-white/10 p-4 backdrop-blur-sm'>
            <p className='text-sm text-indigo-50'>
              Recuerda: Gastar tus monedas <strong>NO reduce</strong> tu puntaje histórico en el ranking ni tu posición en el podio escolar. Tu prestigio académico siempre se calcula sobre el total ganado acumulado.
            </p>
          </div>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div className='rounded-xl bg-white/10 p-4 backdrop-blur-sm'>
              <p className='text-xs font-semibold uppercase tracking-wide text-indigo-100'>
                Total ganado histórico
              </p>
              <p className='mt-1 text-2xl font-bold'>{ganadas} <span className='text-sm font-medium'>EduCoins</span></p>
            </div>
            <div className='rounded-xl bg-white/10 p-4 backdrop-blur-sm'>
              <p className='text-xs font-semibold uppercase tracking-wide text-indigo-100'>
                Total gastado
              </p>
              <p className='mt-1 text-2xl font-bold'>{gastadas} <span className='text-sm font-medium'>EduCoins</span></p>
            </div>
          </div>
        </div>
      </section>

      {/* Libro mayor */}
      <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <div className='flex items-center gap-2'>
              <h2 className='text-lg font-semibold text-slate-900'>Libro Mayor Inmutable</h2>
              <span className='rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600'>
                SHA-256 Ledger
              </span>
            </div>
            <p className='text-xs text-slate-500'>
              Historial con valor probatorio de cada emisión, canje y reajuste en tus clases.
            </p>
          </div>
          <div className='relative w-full lg:w-72'>
            <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
            <input
              type='search'
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder='Buscar por concepto o clase…'
              className='w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>
        </div>

        <div className='mt-4 flex flex-wrap gap-2'>
          {FILTROS.map(({ key, label, corto }) => {
            const count =
              key === "todos" ? conteos.total : conteos.porTipo[key];
            const activo = filtro === key;
            return (
              <button
                key={key}
                type='button'
                onClick={() => setFiltro(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activo
                    ? "bg-indigo-600 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {key === "todos" ? label : corto}
                {key !== "todos" && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      activo ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {movimientos.length === 0 ? (
          <div className='mt-6'>
            <EstadoVacio titulo={TITULO_VACIO} descripcion={DESCRIPCION_VACIO} />
          </div>
        ) : (
          <>
            <div className='mt-4 overflow-x-auto rounded-xl border border-slate-200'>
              <table className='w-full min-w-[44rem] text-sm'>
                <thead>
                  <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
                    <th className='px-4 py-3 font-medium'>Tipo y movimiento</th>
                    <th className='px-4 py-3 font-medium'>Concepto / Actividad</th>
                    <th className='px-4 py-3 font-medium'>Clase / Asignatura</th>
                    <th className='px-4 py-3 font-medium'>Fecha y hora</th>
                    <th className='px-4 py-3 font-medium'>Impacto en saldo</th>
                    <th className='px-4 py-3 font-medium'>Estado</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-slate-100'>
                  {movimientosFiltrados.map((movimiento) => (
                    <tr key={movimiento.id} className='hover:bg-slate-50/50'>
                      <td className='px-4 py-3'>
                        <div className='flex items-center gap-3'>
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${clasePorTipo(
                              movimiento.tipo,
                            )}`}
                          >
                            {movimiento.cantidad > 0 ? "+" : "−"}
                          </div>
                          <div>
                            <p className='font-medium text-slate-900'>
                              {ETIQUETAS_TIPO[movimiento.tipo]}
                            </p>
                            <p className='text-xs text-slate-500'>
                              {SUB_ETIQUETAS_TIPO[movimiento.tipo]}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className='px-4 py-3'>
                        <p className='max-w-xs text-slate-700'>
                          {movimiento.descripcion ?? "—"}
                        </p>
                      </td>
                      <td className='px-4 py-3'>
                        <span className='inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700'>
                          <IconBookOpen className='h-3 w-3' />
                          {movimiento.claseNombre}
                        </span>
                      </td>
                      <td className='px-4 py-3 text-slate-600'>
                        {formatearFecha(movimiento.creadoEn)}
                      </td>
                      <td className='px-4 py-3'>
                        <span className={`font-semibold ${colorImpacto(movimiento.cantidad)}`}>
                          {formatearCantidad(movimiento.cantidad)} EduCoins
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${clasePorTipo(
                            movimiento.tipo,
                          )}`}
                        >
                          <IconCheckCircle className='h-3 w-3' />
                          {ESTADO_TIPO[movimiento.tipo]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav
              className='mt-4 flex items-center justify-between text-sm'
              aria-label='Paginación del historial'
            >
              <button
                type='button'
                onClick={() => cambiarPagina(pagina - 1)}
                disabled={!hayAnterior}
                className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
              >
                Anterior
              </button>
              <span className='text-xs text-slate-500'>
                Mostrando {(meta.page - 1) * meta.limit + 1}-{Math.min(meta.page * meta.limit, meta.total)} de{" "}
                {meta.total} movimientos
              </span>
              <button
                type='button'
                onClick={() => cambiarPagina(pagina + 1)}
                disabled={!haySiguiente}
                className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40'
              >
                Siguiente
              </button>
            </nav>
          </>
        )}
      </section>

      {/* Footer info */}
      <section className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <div className='rounded-xl border border-slate-200 bg-white p-4 shadow-sm'>
          <div className='mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600'>
            <IconLock className='h-4 w-4' />
          </div>
          <h3 className='text-sm font-semibold text-slate-900'>Transacciones Inmutables</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Cada registro se firma criptográficamente contra el sistema central del colegio.
          </p>
        </div>
        <div className='rounded-xl border border-slate-200 bg-white p-4 shadow-sm'>
          <div className='mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600'>
            <IconDocumentText className='h-4 w-4' />
          </div>
          <h3 className='text-sm font-semibold text-slate-900'>Doble Contabilidad</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Los canjes descuentan saldo líquido sin restar méritos a tu historial de honor.
          </p>
        </div>
        <div className='rounded-xl border border-slate-200 bg-white p-4 shadow-sm'>
          <div className='mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600'>
            <IconShield className='h-4 w-4' />
          </div>
          <h3 className='text-sm font-semibold text-slate-900'>Auditoría Docente</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Tus profesores aprueban las monedas al asentar las notas finales de las guías.
          </p>
        </div>
      </section>
    </div>
  );
}
