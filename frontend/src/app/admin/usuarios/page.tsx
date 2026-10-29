'use client';

/**
 * Usuarios del panel admin (`/admin/usuarios`).
 *
 * Listado paginado (`GET /users`, H2.4) con filtros reales del backend
 * (`q`, `rol`, `activa`, `organizacionId`) y formulario de alta (`POST
 * /users`). Tras el alta se muestra la **contraseña inicial**
 * (`contrasenaInicial`) con copia al portapapeles: solo se genera una
 * vez y la UI advierte que no volverá a verse.
 *
 * Testids/labels preservados para `e2e/admin-panel.spec.ts`:
 * `form-usuario`, `lista-usuarios`, `fila-usuario`, `contrasena-inicial`,
 * `filtro-organizacion`, labels `Organización`/`Usuario`/`Correo`/
 * `Nombre`/`Apellido`, botón `Crear usuario`.
 *
 * Estados del kit H5.2: carga, error con reintento y vacío.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  mensajeDeErrorApi,
  useToast,
} from '@/components/ui';
import {
  listarOrganizaciones,
} from '@/features/admin/organizaciones/api/organizaciones';
import type { Organizacion } from '@/features/admin/organizaciones/contrato/organizaciones';
import {
  crearUsuario,
  listarUsuarios,
  LIMITE_USUARIOS,
} from '@/features/admin/usuarios/api/usuarios';
import {
  RolCreableSchema,
  type ListadoUsuarios,
  type RolCreable,
  type RolListado,
} from '@/features/admin/usuarios/contrato/usuarios';
import { ApiError } from '@/lib/api-client';

/** Título del estado vacío sin filtro. */
const TITULO_VACIO = 'Aún no hay usuarios';

/** Descripción del estado vacío sin filtro. */
const DESCRIPCION_VACIO = 'Crea el primer usuario con el formulario de arriba.';

/** Título del estado vacío con filtro de organización. */
const TITULO_VACIO_FILTRO = 'Sin usuarios en esta organización';

/** Descripción del estado vacío con filtro. */
const DESCRIPCION_VACIO_FILTRO =
  'Elige otra organización o quita el filtro para ver todos los usuarios.';

/** Título del estado vacío con otros filtros. */
const TITULO_VACIO_OTRO_FILTRO = 'Sin usuarios con esos filtros';

/** Descripción del estado vacío con otros filtros. */
const DESCRIPCION_VACIO_OTRO_FILTRO =
  'Ajusta la búsqueda, el rol o el estado para ver más resultados.';

/** Etiquetas de rol en la UI. */
const ETIQUETAS_ROL: Record<ListadoUsuarios['data'][number]['rol'], string> = {
  admin: 'Administrador',
  teacher: 'Profesor',
  student: 'Estudiante',
};

/** Opciones de rol del alta (el backend no acepta crear admins). */
const ROLES_ALTA: ReadonlyArray<{ valor: RolCreable; etiqueta: string }> = [
  { valor: 'teacher', etiqueta: 'Profesor' },
  { valor: 'student', etiqueta: 'Estudiante' },
];

/** Texto de respaldo si el backend no devolviera `mensaje`. */
const MENSAJE_USUARIO_CREADO = 'Usuario creado con éxito.';

/** Contraseña inicial recién generada (se muestra una sola vez). */
interface ContrasenaInicial {
  /** Usuario recién creado (para rotular el bloque). */
  usuario: string;
  valor: string;
}

/** Iniciales del avatar a partir de nombre y apellido. */
function iniciales(nombre: string, apellido: string): string {
  return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase() || '??';
}

/**
 * Vista de usuarios del admin.
 *
 * @returns Filtros, formulario, caja de credencial y listado.
 */
export default function UsuariosPage() {
  const { mostrar } = useToast();
  const [usuarios, setUsuarios] = useState<ListadoUsuarios | null>(null);
  const [organizaciones, setOrganizaciones] = useState<Organizacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [filtroOrganizacion, setFiltroOrganizacion] = useState('');
  /** Contador para forzar una recarga desde un evento (reintento/alta). */
  const [recarga, setRecarga] = useState(0);
  /** Contraseña inicial del último alta (se muestra hasta el siguiente alta). */
  const [contrasenaInicial, setContrasenaInicial] =
    useState<ContrasenaInicial | null>(null);
  /** Contraseña copiada al portapapeles (feedback del botón). */
  const [copiada, setCopiada] = useState(false);

  // Filtros reales del backend.
  const [busqueda, setBusqueda] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroActiva, setFiltroActiva] = useState('');

  // Formulario de alta.
  const [rol, setRol] = useState<RolCreable>('student');
  const [usuario, setUsuario] = useState('');
  const [correo, setCorreo] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [organizacionId, setOrganizacionId] = useState('');
  const [especialidad, setEspecialidad] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [listaUsuarios, listaOrganizaciones] = await Promise.all([
          listarUsuarios({
            page: pagina,
            limit: LIMITE_USUARIOS,
            ...(filtroOrganizacion !== ''
              ? { organizacionId: filtroOrganizacion }
              : {}),
            ...(busqueda.trim() !== '' ? { q: busqueda.trim() } : {}),
            ...(filtroRol !== '' ? { rol: filtroRol as RolListado } : {}),
            ...(filtroActiva !== '' ? { activa: filtroActiva === 'true' } : {}),
          }),
          listarOrganizaciones({ page: 1, limit: 50 }),
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
  }, [pagina, filtroOrganizacion, recarga, busqueda, filtroRol, filtroActiva]);

  const cambiarPagina = (nueva: number): void => {
    setCargando(true);
    setPagina(nueva);
  };

  const cambiarFiltro = (actualizador: () => void): void => {
    setCargando(true);
    setPagina(1);
    actualizador();
  };

  const reintentar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  const enviar = async (
    evento: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    evento.preventDefault();

    if (organizacionId === '') {
      mostrar('Elige la organización del usuario.', 'error');
      return;
    }
    if (
      usuario.trim() === '' ||
      correo.trim() === '' ||
      nombre.trim() === '' ||
      apellido.trim() === ''
    ) {
      mostrar('Completa usuario, correo, nombre y apellido.', 'error');
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
      mostrar(creacion.mensaje || MENSAJE_USUARIO_CREADO, 'exito');
      setContrasenaInicial({
        usuario: creacion.usuario.usuario,
        valor: creacion.contrasenaInicial,
      });
      setCopiada(false);
      setUsuario('');
      setCorreo('');
      setNombre('');
      setApellido('');
      setEspecialidad('');
      setPagina(1);
      setCargando(true);
      setRecarga((anterior) => anterior + 1);
    } catch (e) {
      mostrar(mensajeDeErrorApi(e), 'error');
    } finally {
      setEnviando(false);
    }
  };

  const copiarContrasena = async (): Promise<void> => {
    if (contrasenaInicial === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(contrasenaInicial.valor);
      setCopiada(true);
      mostrar('Contraseña copiada al portapapeles.', 'exito');
      setTimeout(() => setCopiada(false), 2200);
    } catch {
      mostrar('No se pudo copiar. Selecciona y copia manualmente.', 'error');
    }
  };

  const nombreDeOrganizacion = (id: string | null): string => {
    if (id === null) {
      return '—';
    }
    return organizaciones.find((organizacion) => organizacion.id === id)
      ?.nombre ?? '—';
  };

  const hayAnterior = (usuarios?.meta.page ?? 1) > 1;
  const haySiguiente =
    usuarios !== null &&
    usuarios.meta.page * usuarios.meta.limit < usuarios.meta.total;
  const filtrandoOrg = filtroOrganizacion !== '';
  const filtrandoOtros =
    busqueda.trim() !== '' || filtroRol !== '' || filtroActiva !== '';

  const tituloVacio = filtrandoOrg
    ? TITULO_VACIO_FILTRO
    : filtrandoOtros
      ? TITULO_VACIO_OTRO_FILTRO
      : TITULO_VACIO;
  const descripcionVacio = filtrandoOrg
    ? DESCRIPCION_VACIO_FILTRO
    : filtrandoOtros
      ? DESCRIPCION_VACIO_OTRO_FILTRO
      : DESCRIPCION_VACIO;

  return (
    <div className='space-y-6'>
      <header className='space-y-1'>
        <p className='text-[11px] font-semibold uppercase tracking-wider text-indigo-600'>
          Gestión Institucional
        </p>
        <h1 className='text-2xl font-bold tracking-tight text-slate-900'>
          Directorio de Usuarios
        </h1>
        <p className='max-w-3xl text-sm text-slate-500'>
          Alta de profesores y estudiantes con su contraseña inicial, y
          listado con filtros por organización, rol y estado.
        </p>
      </header>

      {contrasenaInicial !== null && (
        <div
          role='status'
          data-testid='contrasena-inicial'
          className='relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
        >
          <div
            className='absolute inset-y-0 left-0 w-1 bg-amber-400'
            aria-hidden='true'
          />
          <div className='pl-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='space-y-1.5'>
                <span className='inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700'>
                  Credencial temporal
                </span>
                <h2 className='text-base font-bold text-slate-900'>
                  Usuario creado con éxito
                </h2>
                <p className='text-sm text-slate-500'>
                  La contraseña se muestra una sola vez. Cópiala y entrégala
                  al usuario antes de que inicie sesión (deberá cambiarla).
                </p>
              </div>
              <button
                type='button'
                onClick={() => setContrasenaInicial(null)}
                className='rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900'
                aria-label='Cerrar aviso de contraseña'
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 20 20'
                  fill='currentColor'
                  className='h-4 w-4'
                  aria-hidden='true'
                >
                  <path d='M5.293 5.293a1 1 0 0 1 1.414 0L10 8.586l3.293-3.293a1 1 0 1 1 1.414 1.414L11.414 10l3.293 3.293a1 1 0 0 1-1.414 1.414L10 11.414l-3.293 3.293a1 1 0 0 1-1.414-1.414L8.586 10 5.293 6.707a1 1 0 0 1 0-1.414Z' />
                </svg>
              </button>
            </div>

            <div className='mt-4 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 p-4'>
              <div className='min-w-0'>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-slate-500'>
                  Usuario
                </p>
                <p className='truncate font-semibold text-slate-900'>
                  {contrasenaInicial.usuario}
                </p>
              </div>
              <div className='min-w-0 flex-1'>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-amber-700'>
                  Contraseña inicial
                </p>
                <p className='select-all break-all font-mono text-lg font-bold tracking-wider text-slate-900'>
                  {contrasenaInicial.valor}
                </p>
              </div>
              <button
                type='button'
                onClick={() => void copiarContrasena()}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  copiada
                    ? 'bg-green-100 text-green-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {copiada ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
        <h2 className='text-base font-bold text-slate-900'>
          Registrar usuario
        </h2>
        <p className='mt-1 text-sm text-slate-500'>
          Credenciales de profesores y estudiantes con contraseña inicial.
        </p>

        <form
          data-testid='form-usuario'
          onSubmit={(evento) => void enviar(evento)}
          className='mt-4 grid gap-4 sm:grid-cols-2'
        >
          <div className='flex flex-col gap-1.5'>
            <span className='text-sm font-semibold text-slate-700'>
              Rol
            </span>
            <div
              role='radiogroup'
              aria-label='Rol'
              className='grid grid-cols-2 gap-2'
            >
              {ROLES_ALTA.map((opcion) => (
                <label
                  key={opcion.valor}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    rol === opcion.valor
                      ? 'border-indigo-500 bg-indigo-50 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className='flex items-center gap-2'>
                    <input
                      type='radio'
                      name='rol'
                      value={opcion.valor}
                      checked={rol === opcion.valor}
                      onChange={(evento) =>
                        setRol(RolCreableSchema.parse(evento.target.value))
                      }
                      className='accent-indigo-600'
                    />
                    {opcion.etiqueta}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='usuario-organizacion'
              className='text-sm font-semibold text-slate-700'
            >
              Organización
            </label>
            <select
              id='usuario-organizacion'
              name='organizacion'
              value={organizacionId}
              onChange={(evento) => setOrganizacionId(evento.target.value)}
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              <option value=''>Elige una organización…</option>
              {organizaciones.map((organizacion) => (
                <option key={organizacion.id} value={organizacion.id}>
                  {organizacion.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='usuario-usuario'
              className='text-sm font-semibold text-slate-700'
            >
              Usuario
            </label>
            <input
              id='usuario-usuario'
              name='usuario'
              type='text'
              autoComplete='off'
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
              placeholder='nombre.apellido'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='usuario-correo'
              className='text-sm font-semibold text-slate-700'
            >
              Correo
            </label>
            <input
              id='usuario-correo'
              name='correo'
              type='email'
              autoComplete='off'
              value={correo}
              onChange={(evento) => setCorreo(evento.target.value)}
              placeholder='correo@educoins.test'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='usuario-nombre'
              className='text-sm font-semibold text-slate-700'
            >
              Nombre
            </label>
            <input
              id='usuario-nombre'
              name='nombre'
              type='text'
              autoComplete='off'
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder='Nombre'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='usuario-apellido'
              className='text-sm font-semibold text-slate-700'
            >
              Apellido
            </label>
            <input
              id='usuario-apellido'
              name='apellido'
              type='text'
              autoComplete='off'
              value={apellido}
              onChange={(evento) => setApellido(evento.target.value)}
              placeholder='Apellido'
              className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          {rol === 'teacher' && (
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <label
                htmlFor='usuario-especialidad'
                className='text-sm font-semibold text-slate-700'
              >
                Especialidad (opcional, solo profesores)
              </label>
              <input
                id='usuario-especialidad'
                name='especialidad'
                type='text'
                autoComplete='off'
                value={especialidad}
                onChange={(evento) => setEspecialidad(evento.target.value)}
                placeholder='Matemáticas'
                className='rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
              />
            </div>
          )}

          <div className='sm:col-span-2'>
            <button
              type='submit'
              disabled={enviando}
              className='rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {enviando ? 'Enviando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>

      <div className='rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h2 className='text-base font-bold text-slate-900'>
              Listado
            </h2>
            {usuarios !== null && (
              <p className='mt-0.5 text-xs text-slate-500'>
                {usuarios.meta.total.toLocaleString('es-CO')} usuario
                {usuarios.meta.total === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        <div className='mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
          <div className='relative'>
            <label htmlFor='busqueda-usuario' className='sr-only'>
              Buscar usuario
            </label>
            <input
              id='busqueda-usuario'
              data-testid='busqueda-usuario'
              type='search'
              value={busqueda}
              onChange={(evento) =>
                cambiarFiltro(() => setBusqueda(evento.target.value))
              }
              placeholder='Buscar nombre, correo o usuario…'
              className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            />
          </div>

          <div className='relative'>
            <label
              htmlFor='filtro-organizacion'
              className='sr-only'
            >
              Filtrar por organización
            </label>
            <select
              id='filtro-organizacion'
              data-testid='filtro-organizacion'
              value={filtroOrganizacion}
              onChange={(evento) =>
                cambiarFiltro(() => setFiltroOrganizacion(evento.target.value))
              }
              className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              <option value=''>Organización: Todas</option>
              {organizaciones.map((organizacion) => (
                <option key={organizacion.id} value={organizacion.id}>
                  {organizacion.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className='relative'>
            <label htmlFor='filtro-rol' className='sr-only'>
              Filtrar por rol
            </label>
            <select
              id='filtro-rol'
              data-testid='filtro-rol'
              value={filtroRol}
              onChange={(evento) =>
                cambiarFiltro(() => setFiltroRol(evento.target.value))
              }
              className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              <option value=''>Rol: Todos</option>
              <option value='admin'>Administrador</option>
              <option value='teacher'>Profesor</option>
              <option value='student'>Estudiante</option>
            </select>
          </div>

          <div className='relative'>
            <label htmlFor='filtro-activa' className='sr-only'>
              Filtrar por estado
            </label>
            <select
              id='filtro-activa'
              data-testid='filtro-activa'
              value={filtroActiva}
              onChange={(evento) =>
                cambiarFiltro(() => setFiltroActiva(evento.target.value))
              }
              className='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
            >
              <option value=''>Estado: Todos</option>
              <option value='true'>Solo activos</option>
              <option value='false'>Solo desactivados</option>
            </select>
          </div>
        </div>

        {cargando && <EstadoCarga mensaje='Cargando usuarios…' />}

        {error !== null && !cargando && (
          <EstadoError mensaje={error} alReintentar={reintentar} />
        )}

        {error === null && !cargando && usuarios !== null && (
          <>
            {usuarios.meta.total === 0 ? (
              <EstadoVacio titulo={tituloVacio} descripcion={descripcionVacio} />
            ) : (
              <div className='mt-4 overflow-x-auto'>
                <table
                  className='w-full text-left text-sm'
                  data-testid='lista-usuarios'
                  aria-label='Listado de usuarios'
                >
                  <thead>
                    <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
                      <th scope='col' className='px-4 py-3'>
                        Usuario
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Rol
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Organización
                      </th>
                      <th scope='col' className='px-4 py-3'>
                        Especialidad
                      </th>
                      <th scope='col' className='px-4 py-3 text-center'>
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-slate-100'>
                    {usuarios.data.map((fila) => (
                      <tr
                        key={fila.id}
                        data-testid='fila-usuario'
                        className='transition-colors hover:bg-slate-50/50'
                      >
                        <td className='px-4 py-3'>
                          <div className='flex items-center gap-3'>
                            <span
                              className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700'
                              aria-hidden='true'
                            >
                              {iniciales(fila.nombre, fila.apellido)}
                            </span>
                            <div className='min-w-0'>
                              <span className='block truncate font-semibold text-slate-900'>
                                {fila.nombre} {fila.apellido}
                              </span>
                              <span className='block truncate font-mono text-[11px] text-indigo-600'>
                                {fila.usuario}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className='px-4 py-3'>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              fila.rol === 'admin'
                                ? 'bg-indigo-100 text-indigo-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {ETIQUETAS_ROL[fila.rol]}
                          </span>
                        </td>
                        <td className='max-w-[180px] truncate px-4 py-3 text-slate-600'>
                          {nombreDeOrganizacion(fila.organizacionId)}
                        </td>
                        <td className='max-w-[160px] truncate px-4 py-3 text-slate-600'>
                          {fila.especialidad ?? '—'}
                        </td>
                        <td className='px-4 py-3 text-center'>
                          {fila.activo ? (
                            <span className='inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700'>
                              <span
                                className='h-1.5 w-1.5 rounded-full bg-green-600'
                                aria-hidden='true'
                              />
                              Activo
                            </span>
                          ) : (
                            <span className='inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600'>
                              Desactivado
                            </span>
                          )}
                          {fila.debeCambiarContrasena && fila.activo && (
                            <span className='mt-1 block text-[10px] font-semibold text-amber-700'>
                              Pendiente cambio de contraseña
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {usuarios.meta.total > 0 && (
              <div
                className='mt-4 flex items-center justify-between'
                aria-label='Paginación de usuarios'
              >
                <span className='text-xs text-slate-500'>
                  Página {usuarios.meta.page} de{' '}
                  {Math.max(
                    1,
                    Math.ceil(usuarios.meta.total / usuarios.meta.limit),
                  )}
                </span>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    onClick={() => cambiarPagina(usuarios.meta.page - 1)}
                    disabled={!hayAnterior}
                    className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    Anterior
                  </button>
                  <button
                    type='button'
                    onClick={() => cambiarPagina(usuarios.meta.page + 1)}
                    disabled={!haySiguiente}
                    className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className='text-sm'>
        <Link
          href='/admin'
          className='font-semibold text-indigo-600 underline-offset-2 hover:underline'
        >
          Volver al panel
        </Link>
      </p>
    </div>
  );
}
