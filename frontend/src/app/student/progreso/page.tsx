"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  MENSAJE_ERROR_GENERICO,
  IconCoin,
  IconProgress,
  IconTrophy,
} from "@/components/ui";
import { obtenerHistorial, obtenerSaldo } from "@/features/billetera/api/billetera";
import {
  GraficaProgreso,
  type BarraProgreso,
  resumenMensualGanancias,
  tendenciaMensual,
} from "@/features/billetera/componentes/grafica-progreso";
import type { SaldoBilletera } from "@/features/billetera/contrato/billetera";
import { ApiError } from "@/lib/api-client";

export default function ProgresoPage() {
  const [saldo, setSaldo] = useState<SaldoBilletera | null>(null);
  const [barras, setBarras] = useState<BarraProgreso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        // shortcut: máximo 100 movimientos; con historiales mayores la
        // gráfica de meses viejos puede quedar corta. Subir el tope o pedir
        // un endpoint agregado cuando alguien supere esa cifra.
        const [saldoNuevo, historial] = await Promise.all([
          obtenerSaldo(),
          obtenerHistorial(1, 100),
        ]);
        if (vigente) {
          setSaldo(saldoNuevo);
          setBarras(resumenMensualGanancias(historial.data));
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
  }, [recarga]);

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando tu progreso…' />
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

  const ganadas = saldo?.monedasGanadas ?? 0;
  const gastadas = saldo?.monedasGastadas ?? 0;
  const disponibles = saldo?.monedasDisponibles ?? 0;

  const tendencia = tendenciaMensual(barras);
  const mejorMes = barras.reduce(
    (mejor, barra) => (barra.valor > mejor.valor ? barra : mejor),
    barras[0] ?? { mes: "—", valor: 0, activa: false },
  );
  const ganadoEnPeriodo = barras.reduce((total, barra) => total + barra.valor, 0);
  const promedio =
    barras.length > 0 ? Math.round(ganadoEnPeriodo / barras.length) : 0;

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div>
        <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Seguimiento Académico
        </p>
        <h1 className='mt-1 text-2xl font-bold text-slate-900 lg:text-3xl'>
          Mi Progreso
        </h1>
        <p className='mt-1 max-w-2xl text-sm text-slate-500'>
          Monedas ganadas y gastadas en tus clases. Tu esfuerzo académico se traduce en recompensas.
        </p>
      </div>

      {/* Stats */}
      <section className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Ganadas
            </span>
            <IconTrophy className='h-5 w-5 text-indigo-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='progreso-ganadas'>
            {ganadas}
          </p>
          <p className='mt-1 text-xs text-slate-500'>Total histórico acumulado</p>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Gastadas
            </span>
            <IconCoin className='h-5 w-5 text-amber-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='progreso-gastadas'>
            {gastadas}
          </p>
          <p className='mt-1 text-xs text-slate-500'>Canjes y beneficios aplicados</p>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Disponibles
            </span>
            <IconProgress className='h-5 w-5 text-emerald-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='progreso-disponibles'>
            {disponibles}
          </p>
          <p className='mt-1 text-xs text-slate-500'>Saldo listo para canjear</p>
        </div>
      </section>

      {/* Gráfico */}
      <section className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold text-slate-900'>
              Mi Progreso en Monedas
            </h2>
            <p className='text-xs text-slate-500'>Últimos 5 meses</p>
          </div>
          {tendencia !== null && (
            <span className='inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700'>
              <IconProgress className='h-3 w-3' />
              {tendencia >= 0 ? "+" : ""}
              {tendencia}% vs mes anterior
            </span>
          )}
        </div>

        <GraficaProgreso barras={barras} />

        <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <div className='rounded-xl bg-slate-50 p-3'>
            <p className='text-xs text-slate-500'>Período con mayor ganancia</p>
            <p className='text-sm font-semibold text-slate-900'>
              {mejorMes.mes} · +{mejorMes.valor} EduCoins
            </p>
          </div>
          <div className='rounded-xl bg-slate-50 p-3'>
            <p className='text-xs text-slate-500'>Promedio mensual</p>
            <p className='text-sm font-semibold text-slate-900'>
              {promedio} EduCoins
            </p>
          </div>
          <div className='rounded-xl bg-slate-50 p-3'>
            <p className='text-xs text-slate-500'>Total acumulado</p>
            <p className='text-sm font-semibold text-slate-900'>{ganadas} EduCoins</p>
          </div>
        </div>
      </section>
    </div>
  );
}
