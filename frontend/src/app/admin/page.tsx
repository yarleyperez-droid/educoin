'use client';

/**
 * Hub del panel de administración (`/admin`).
 *
 * Punto de entrada con **KPIs reales** derivados de `meta.total` de
 * `GET /organizations` y `GET /users` (sin métricas inventadas: no hay
 * endpoint de agregados en el backend). Además muestra las últimas
 * organizaciones (`GET /organizations?page=1&limit=5`) y el top de
 * estudiantes (`GET /rankings?limit=5`, `@Roles` incluye admin).
 *
 * Los testids `link-admin-organizaciones` y `link-admin-usuarios` los
 * exige el e2e `admin-panel.spec.ts`.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  IconArrowRight,
  IconBuilding,
  IconCoin,
  IconTrophy,
  IconUsers,
} from '@/components/ui';
import {
  listarOrganizaciones,
} from '@/features/admin/organizaciones/api/organizaciones';
import type {
  Organizacion,
} from '@/features/admin/organizaciones/contrato/organizaciones';
import { listarUsuarios } from '@/features/admin/usuarios/api/usuarios';
import { obtenerRankingGlobal } from '@/features/rankings/api/rankings';
import type { FilaRanking } from '@/features/rankings/contrato/rankings';
import { ApiError } from '@/lib/api-client';

/** Etiquetas de tipo de organización en la UI. */
const ETIQUETAS_TIPO: Record<Organizacion['tipo'], string> = {
  school: 'Escuela',
  university: 'Universidad',
  other: 'Otra',
};

/** Tarjetas hub hacia las secciones (testids del e2e). */
const HUB = [
  {
    href: '/admin/organizaciones',
    testid: 'link-admin-organizaciones',
    titulo: 'Gestión de Organizaciones',
    descripcion:
      'Alta, listado y filtro de las instituciones de la plataforma.',
    Icono: IconBuilding,
  },
  {
    href: '/admin/usuarios',
    testid: 'link-admin-usuarios',
    titulo: 'Directorio de Usuarios',
    descripcion:
      'Alta de profesores y estudiantes con contraseña inicial, y listado con filtros.',
    Icono: IconUsers,
  },
] as const;

/** Contadores derivados de `meta.total` (uno por consulta con limit=1). */
interface Contadores {
  organizaciones: number;
  organizacionesActivas: number;
  usuarios: number;
  usuariosActivos: number;
}

/**
 * Vista del hub admin.
 *
 * @returns KPIs reales, tarjetas hub, últimas orgs y top rankings.
 */
export default function AdminPage() {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [ultimasOrgs, setUltimasOrgs] = useState<Organizacion[]>([]);
  const [topRanking, setTopRanking] = useState<FilaRanking[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [
          orgsTotal,
          orgsActivas,
          usuariosTotal,
          usuariosActivos,
          recientes,
          ranking,
        ] = await Promise.all([
          listarOrganizaciones({ page: 1, limit: 1 }),
          listarOrganizaciones({ page: 1, limit: 1, activa: true }),
          listarUsuarios({ page: 1, limit: 1 }),
          listarUsuarios({ page: 1, limit: 1, activa: true }),
          listarOrganizaciones({ page: 1, limit: 5 }),
          obtenerRankingGlobal(1, 5),
        ]);

        if (vigente) {
          setContadores({
            organizaciones: orgsTotal.meta.total,
            organizacionesActivas: orgsActivas.meta.total,
            usuarios: usuariosTotal.meta.total,
            usuariosActivos: usuariosActivos.meta.total,
          });
          setUltimasOrgs(recientes.data);
          setTopRanking(ranking.data);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setContadores(null);
          setError(
            e instanceof ApiError
              ? e.message
              : 'Ocurrió un error inesperado. Intenta de nuevo.',
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
  }, [recarga]);

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const tarjetasKpi: ReadonlyArray<{
    clave: keyof Contadores;
    etiqueta: string;
    Icono: typeof IconBuilding;
  }> = [
    { clave: 'organizaciones', etiqueta: 'Organizaciones', Icono: IconBuilding },
    {
      clave: 'organizacionesActivas',
      etiqueta: 'Organizaciones activas',
      Icono: IconBuilding,
    },
    { clave: 'usuarios', etiqueta: 'Usuarios', Icono: IconUsers },
    { clave: 'usuariosActivos', etiqueta: 'Usuarios activos', Icono: IconUsers },
  ];

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-indigo-600'>
          Panel de administración
        </p>
        <h1 className='text-2xl font-bold tracking-tight text-slate-900'>
          Centro de Mando Administrativo
        </h1>
        <p className='max-w-3xl text-sm text-slate-500'>
          Gestión de instituciones y cuentas de la plataforma EduCoins.
        </p>
      </header>

      {cargando && <EstadoCarga mensaje='Cargando panel…' />}

      {error !== null && !cargando && (
        <EstadoError mensaje={error} alReintentar={reintentar} />
      )}

      {error === null && !cargando && contadores !== null && (
        <>
          <section
            aria-label='Indicadores'
            className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'
          >
            {tarjetasKpi.map(({ clave, etiqueta, Icono }) => (
              <div
                key={clave}
                className='rounded-xl border border-slate-200 bg-white p-4 shadow-sm'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='space-y-1'>
                    <p className='text-[11px] font-semibold uppercase tracking-wider text-slate-500'>
                      {etiqueta}
                    </p>
                    <p className='pt-1 text-3xl font-extrabold tracking-tight text-slate-900'>
                      {contadores[clave].toLocaleString('es-CO')}
                    </p>
                  </div>
                  <span
                    className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600'
                    aria-hidden='true'
                  >
                    <Icono className='h-5 w-5' />
                  </span>
                </div>
              </div>
            ))}
          </section>

          <section
            aria-label='Accesos rápidos'
            className='grid grid-cols-1 gap-4 md:grid-cols-2'
          >
            {HUB.map(({ href, testid, titulo, descripcion, Icono }) => (
              <Link
                key={href}
                href={href}
                data-testid={testid}
                className='group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-200'
              >
                <div className='space-y-3'>
                  <span className='flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600'>
                    <Icono className='h-6 w-6' />
                  </span>
                  <div>
                    <h2 className='text-base font-bold text-slate-900'>
                      {titulo}
                    </h2>
                    <p className='mt-1 text-sm text-slate-500'>{descripcion}</p>
                  </div>
                </div>
                <span className='mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-indigo-600'>
                  Abrir sección
                  <IconArrowRight className='h-4 w-4 transition-transform group-hover:translate-x-1' />
                </span>
              </Link>
            ))}
          </section>

          <section className='grid grid-cols-1 gap-4 lg:grid-cols-5'>
            <div className='overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-3'>
              <div className='flex items-center justify-between px-5 py-4'>
                <h2 className='text-base font-bold text-slate-900'>
                  Últimas organizaciones
                </h2>
                <Link
                  href='/admin/organizaciones'
                  className='text-sm font-semibold text-indigo-600 hover:underline'
                >
                  Ver todas
                </Link>
              </div>
              {ultimasOrgs.length === 0 ? (
                <div className='px-5 pb-5'>
                  <EstadoVacio titulo='Aún no hay organizaciones' />
                </div>
              ) : (
                <ul className='divide-y divide-slate-100'>
                  {ultimasOrgs.map((org) => (
                    <li
                      key={org.id}
                      className='flex items-center justify-between gap-3 px-5 py-3 text-sm'
                    >
                      <div className='min-w-0'>
                        <p className='truncate font-semibold text-slate-900'>
                          {org.nombre}
                        </p>
                        <p className='text-[11px] text-slate-500'>
                          {ETIQUETAS_TIPO[org.tipo]}
                          {org.ciudad !== null ? ` · ${org.ciudad}` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          org.activa
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {org.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className='overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2'>
              <div className='flex items-center gap-2 px-5 py-4'>
                <IconTrophy className='h-5 w-5 text-amber-500' />
                <h2 className='text-base font-bold text-slate-900'>
                  Top estudiantes
                </h2>
              </div>
              {topRanking.length === 0 ? (
                <div className='px-5 pb-5'>
                  <EstadoVacio titulo='Aún no hay ranking' />
                </div>
              ) : (
                <ol className='divide-y divide-slate-100'>
                  {topRanking.map((fila) => (
                    <li
                      key={fila.estudianteId}
                      className='flex items-center gap-3 px-5 py-3 text-sm'
                    >
                      <span className='w-6 text-center font-bold text-indigo-600'>
                        {fila.posicion}
                      </span>
                      <span className='min-w-0 flex-1 truncate font-medium text-slate-900'>
                        {fila.nombres}
                      </span>
                      <span className='inline-flex shrink-0 items-center gap-1 font-semibold text-slate-900'>
                        {fila.monedasGanadas.toLocaleString('es-CO')}
                        <IconCoin className='h-4 w-4' />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
