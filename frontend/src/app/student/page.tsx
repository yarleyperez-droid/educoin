"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  MENSAJE_ERROR_GENERICO,
  mensajeDeErrorApi,
  useToast,
  IconZap,
  IconCoin,
  IconRanking,
  IconDocumentText,
  IconBookOpen,
  IconWallet,
  IconArrowRight,
  IconPlus,
  IconTrophy,
  IconCalendar,
} from "@/components/ui";
import { obtenerSaldo } from "@/features/billetera/api/billetera";
import { unirseAClase } from "@/features/billetera/api/unirse";
import type { SaldoBilletera } from "@/features/billetera/contrato/billetera";
import { listarPublicadas } from "@/features/estudiante/api/actividades-estudiante";
import { listarInscripciones } from "@/features/estudiante/api/inscripciones";
import { ApiError } from "@/lib/api-client";

const MENSAJE_ENVIADO = "Te has unido a la clase.";
const ETIQUETA_CODIGO = "Código de la clase";

interface ActividadReciente {
  id: string;
  titulo: string;
  claseNombre: string;
  recompensaMonedas: number;
  publicadaEn: string | null;
}

const barrasProgreso = [
  { mes: "Nov", valor: 60 },
  { mes: "Dic", valor: 90 },
  { mes: "Ene", valor: 120 },
  { mes: "Feb", valor: 100 },
  { mes: "Mar", valor: 140, activa: true },
];

function formatearFechaPublicacion(iso: string | null): string {
  if (iso === null) return "Recientemente publicada";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function StudentPage() {
  const { mostrar } = useToast();
  const [saldo, setSaldo] = useState<SaldoBilletera | null>(null);
  const [actividades, setActividades] = useState<ActividadReciente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargarTodo(): Promise<void> {
      try {
        const [saldoNuevo, inscripcionesRespuesta] = await Promise.all([
          obtenerSaldo(),
          listarInscripciones(),
        ]);

        const activas = inscripcionesRespuesta.data.filter(
          (i) => i.estado === "active",
        );

        const recientes: ActividadReciente[] = [];
        if (activas.length > 0) {
          const listas = await Promise.all(
            activas.map((inscripcion) =>
              listarPublicadas(inscripcion.id, 1, 50),
            ),
          );
          activas.forEach((inscripcion, indice) => {
            (listas[indice]?.data ?? []).forEach((actividad) => {
              recientes.push({
                id: actividad.id,
                titulo: actividad.titulo,
                claseNombre: inscripcion.clase.nombre,
                recompensaMonedas: actividad.recompensaMonedas,
                publicadaEn: actividad.publicadaEn,
              });
            });
          });
          recientes.sort((a, b) => {
            const aTime = a.publicadaEn ? new Date(a.publicadaEn).getTime() : 0;
            const bTime = b.publicadaEn ? new Date(b.publicadaEn).getTime() : 0;
            return bTime - aTime;
          });
        }

        if (vigente) {
          setSaldo(saldoNuevo);
          setActividades(recientes);
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

    void cargarTodo();

    return () => {
      vigente = false;
    };
  }, [recarga]);

  function reintentar(): void {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  }

  async function enviarUnion(
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    evento.preventDefault();
    const limpio = codigo.trim();
    if (limpio === "") {
      mostrar("Escribe el código de la clase.", "error");
      return;
    }
    setEnviando(true);
    try {
      const resultado = await unirseAClase(limpio);
      mostrar(resultado.mensaje || MENSAJE_ENVIADO, "exito");
      setCodigo("");
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), "error");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <div className='flex min-h-[60vh] items-center justify-center'>
        <EstadoCarga mensaje='Cargando tu panel…' />
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

  const disponibles = saldo?.monedasDisponibles ?? 0;
  const ganadas = saldo?.monedasGanadas ?? 0;
  const gastadas = saldo?.monedasGastadas ?? 0;
  const actividadesVisibles = actividades.slice(0, 4);

  return (
    <div className='space-y-6'>
      {/* Hero */}
      <section className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-lg lg:p-8'>
        <div className='relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
          <div className='lg:max-w-xl'>
            <span className='inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm'>
              <IconZap className='h-3.5 w-3.5' />
              Panel del Estudiante
            </span>
            <h1 className='mt-3 text-3xl font-bold lg:text-4xl'>
              ¡Hola de nuevo!
            </h1>
            <p className='mt-2 text-indigo-100'>
              Revisa tus actividades, tu billetera y tu posición en el ranking.
            </p>
          </div>

          <div className='rounded-xl bg-white p-4 text-slate-900 shadow-md lg:w-80'>
            <h3 className='text-sm font-semibold text-slate-800'>Unirse a una clase</h3>
            <p className='text-xs text-slate-500'>Pide el código a tu profesor.</p>
            <form
              onSubmit={(evento) => void enviarUnion(evento)}
              className='mt-3 flex gap-2'
            >
              <label htmlFor='codigo-union' className='sr-only'>
                {ETIQUETA_CODIGO}
              </label>
              <input
                id='codigo-union'
                type='text'
                value={codigo}
                onChange={(evento) => setCodigo(evento.target.value)}
                autoComplete='off'
                placeholder='ej. AB12CD'
                className='flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
              />
              <button
                type='submit'
                disabled={enviando}
                className='inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white enabled:hover:bg-indigo-700 disabled:opacity-60'
              >
                <IconPlus className='h-4 w-4' />
                {enviando ? "Uniendo…" : "Unirme"}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Saldo disponible
            </span>
            <IconCoin className='h-5 w-5 text-amber-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='saldo-disponibles'>
            {disponibles} <span className='text-base font-medium text-amber-600'>EduCoins</span>
          </p>
          <Link
            href='/student/billetera'
            className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
          >
            Ver mi billetera
            <IconArrowRight className='h-4 w-4' />
          </Link>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Histórico ganado
            </span>
            <IconTrophy className='h-5 w-5 text-indigo-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='monedas-ganadas'>
            {ganadas} <span className='text-base font-medium text-slate-600'>ganadas</span>
          </p>
          <Link
            href='/student/ranking'
            className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
          >
            Ver ranking
            <IconArrowRight className='h-4 w-4' />
          </Link>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Monedas gastadas
            </span>
            <IconWallet className='h-5 w-5 text-amber-500' />
          </div>
          <p className='mt-2 text-2xl font-bold text-slate-900' data-testid='monedas-gastadas'>
            {gastadas} <span className='text-base font-medium text-slate-600'>gastadas</span>
          </p>
          <Link
            href='/student/progreso'
            className='mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
          >
            Ver mi progreso
            <IconArrowRight className='h-4 w-4' />
          </Link>
        </div>
      </section>

      {/* Actividades recientemente publicadas + Progreso */}
      <section className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2'>
          <div className='flex items-center justify-between'>
            <h2 className='text-lg font-semibold text-slate-900'>Actividades Recientemente Publicadas</h2>
            <Link
              href='/student/actividades'
              className='inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700'
            >
              Ver todas ({actividades.length})
              <IconArrowRight className='h-4 w-4' />
            </Link>
          </div>

          {actividadesVisibles.length === 0 ? (
            <p className='mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500'>
              Aún no hay actividades publicadas en tus clases.
            </p>
          ) : (
            <div className='mt-4 space-y-3'>
              {actividadesVisibles.map((actividad) => (
                <div
                  key={actividad.id}
                  className='flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50'
                >
                  <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600'>
                    <IconBookOpen className='h-5 w-5' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700'>
                        {actividad.claseNombre}
                      </span>
                      <span className='inline-flex items-center gap-1 text-xs text-slate-500'>
                        <IconCalendar className='h-3 w-3' />
                        Publicada el {formatearFechaPublicacion(actividad.publicadaEn)}
                      </span>
                    </div>
                    <h3 className='mt-1 text-sm font-semibold text-slate-900'>{actividad.titulo}</h3>
                  </div>
                  <div className='flex shrink-0 flex-col items-end gap-2'>
                    <span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700'>
                      <IconCoin className='h-3 w-3' />
                      +{actividad.recompensaMonedas} EduCoins
                    </span>
                    <Link
                      href={`/student/actividades/${actividad.id}`}
                      className='rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700'
                    >
                      Resolver
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <h2 className='text-lg font-semibold text-slate-900'>Mi Progreso en Monedas</h2>
              <p className='text-xs text-slate-500'>Últimos 5 meses</p>
            </div>
            <Link
              href='/student/progreso'
              className='text-xs font-medium text-indigo-600 hover:text-indigo-700'
            >
              Ver todo
            </Link>
          </div>
          <div className='mt-4 flex h-40 items-end justify-between gap-2'>
            {barrasProgreso.map((barra) => (
              <div key={barra.mes} className='flex flex-1 flex-col items-center gap-2'>
                <div
                  className={`w-full max-w-[2rem] rounded-t-lg ${
                    barra.activa ? 'bg-indigo-600' : 'bg-indigo-200'
                  }`}
                  style={{ height: `${barra.valor}%` }}
                />
                <span className='text-xs font-medium text-slate-500'>{barra.mes}</span>
              </div>
            ))}
          </div>
          <p className='mt-4 text-xs text-slate-500'>
            Total: <span className='font-semibold text-slate-900'>{ganadas} EduCoins</span>
          </p>
        </div>
      </section>

      {/* Accesos rápidos */}
      <section className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <Link
          href='/student/actividades'
          className='group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'
        >
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600'>
            <IconDocumentText className='h-5 w-5' />
          </div>
          <h3 className='mt-3 text-base font-semibold text-slate-900'>Mis Actividades</h3>
          <p className='mt-1 text-xs text-slate-500'>
            {actividades.length} actividad{actividades.length === 1 ? "" : "es"} publicada{actividades.length === 1 ? "" : "s"} en tus clases.
          </p>
        </Link>

        <Link
          href='/student/billetera'
          className='group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'
        >
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600'>
            <IconWallet className='h-5 w-5' />
          </div>
          <h3 className='mt-3 text-base font-semibold text-slate-900'>Mi Billetera Digital</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Libro mayor, transferencias y recibos auditados.
          </p>
        </Link>

        <Link
          href='/student/ranking'
          className='group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'
        >
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600'>
            <IconRanking className='h-5 w-5' />
          </div>
          <h3 className='mt-3 text-base font-semibold text-slate-900'>Tabla de Posiciones</h3>
          <p className='mt-1 text-xs text-slate-500'>
            Consulta tu ranking por monedas ganadas.
          </p>
        </Link>
      </section>
    </div>
  );
}
