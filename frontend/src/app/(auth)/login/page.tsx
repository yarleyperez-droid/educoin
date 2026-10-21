/**
 * Página de inicio de sesión (`/login`) — T5.4.1 (PRO-377), integrada con la
 * API real en T5.4.3 (PRO-381).
 *
 * Formulario real de login (usuario **o** correo + contraseña) que delega la
 * validación de credenciales en la capa `@/features/auth/api/auth` (que habla
 * con `POST auth/login` real de H2.1).
 *
 * Responsabilidades de esta vista:
 * - Capturar identificador y contraseña con `label` accesible (`htmlFor`).
 * - Validar en cliente que ambos campos vengan rellenos (sin llamar a la
 *   capa de auth si falta alguno) y mostrar el mensaje de validación.
 * - Mostrar el estado de carga: sustituir el botón por `EstadoCarga`
 *   mientras hay una petición en curso.
 * - Anunciar los errores de envío con el **toast accesible** del kit UI
 *   (H5.2 / PRO-283): variante `error`, región `aria-live`, con **solo** el
 *   mensaje legible de `ApiError` (`mensajeDeErrorApi`).
 * - Redirigir al panel del rol tras el login (`rutaPorRol`).
 *
 * Contrato con el backend:
 * - La vista **no** conoce usuarios, cookies ni tokens: todo eso vive en la
 *   capa de auth; los cambios de H2.x se absorben allí.
 * - El frontend no es barrera de seguridad (AGENTS.md §9): el rol validado
 *   aquí es UX; el backend revalida cada petición.
 *
 * Selectores con contrato E2E (`e2e/helpers.ts`, `e2e/login.spec.ts`):
 * labels exactos "Usuario o correo" y "Contraseña", botón "Iniciar sesión" y
 * `role="alert"` con los mensajes de validación/error. No se renombran.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  EstadoCarga,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import { iniciarSesion, rutaPorRol } from "@/features/auth/api/auth";

/** Mensaje de validación cuando falta algún campo del formulario. */
const MENSAJE_CAMPOS_INCOMPLETOS =
  "Ingresa tu usuario o correo y tu contraseña para continuar.";

/**
 * Icono informativo del aviso de primer ingreso (SVG inline, sin dependencias).
 *
 * @returns SVG decorativo (`aria-hidden`).
 */
function IconoInfo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v.5h1.5v-.5Zm-.75 3a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Formulario de inicio de sesión.
 *
 * Componente cliente (App Router): solo él lleva estado, efectos y eventos
 * (AGENTS.md §8). El estado es React controlado a mano (spec §Supuestos 4):
 * `react-hook-form` no está instalado en `frontend/` y esta tarea no suma
 * dependencias.
 *
 * Estados cubiertos (AGENTS.md §8: carga, vacío y error):
 * - **Vacío / validación:** `errorCampo` si identificador o contraseña
 *   vienen vacíos (con `trim`); no se llama a la capa de auth.
 * - **Carga:** `cargando` sustituye el botón por `<EstadoCarga />`
 *   (kit UI, `role="status"` + `aria-live`); los campos quedan deshabilitados.
 * - **Error de envío:** toast `error` con `mensajeDeErrorApi(error)` —
 *   validaciones de campo siguen en el área `role="alert"` en línea.
 *
 * @returns Vista de login centrada sobre el fondo neutro.
 */
export default function LoginPage() {
  const router = useRouter();
  const { mostrar } = useToast();

  const [identificador, setIdentificador] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);

  /**
   * Procesa el envío del formulario.
   *
   * Flujo: valida campos vacíos (sin llamar a la capa) → llama a
   * `iniciarSesion` → redirige al panel del rol con `rutaPorRol`. Si falla,
   * `mensajeDeErrorApi` extrae el mensaje legible (`ApiError.message`) o
   * devuelve el genérico (sin filtrar detalles internos) y se anuncia con el
   * toast `error` del kit UI (H5.2).
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();

    const identificadorNormalizado = identificador.trim();

    if (identificadorNormalizado === "" || contrasena.trim() === "") {
      setErrorCampo(MENSAJE_CAMPOS_INCOMPLETOS);
      return;
    }

    setErrorCampo(null);
    setCargando(true);

    try {
      const sesion = await iniciarSesion({
        usuarioOEmail: identificadorNormalizado,
        contrasena,
      });

      router.push(rutaPorRol(sesion.role));
    } catch (error) {
      mostrar(mensajeDeErrorApi(error), "error");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className='flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 sm:p-8'>
      <div className='w-full max-w-md'>
        {/* Marca */}
        <div className='mb-6 flex items-center justify-center gap-2'>
          <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white'>
            E
          </div>
          <span className='text-xl font-bold text-slate-900'>EduCoins</span>
          <span className='rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700'>
            Campus Beta
          </span>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
          {/* Aviso de primer ingreso (coincide con el flujo de cambio obligatorio) */}
          <div className='flex items-start gap-2 rounded-xl bg-indigo-50 p-3'>
            <IconoInfo />
            <p className='text-xs leading-relaxed text-indigo-800'>
              <strong>¿Primer ingreso a EduCoins?</strong> Si tu institución te
              registró recientemente, el sistema te solicitará renovar tu
              contraseña temporal otorgada por coordinación al ingresar.
            </p>
          </div>

          <h1 className='mt-6 text-2xl font-bold text-slate-900'>
            Bienvenido de nuevo
          </h1>
          <p className='mt-1 text-sm text-slate-500'>
            Ingresa a tu cuenta de EduCoins para acceder a tu billetera y módulos.
          </p>

          <form onSubmit={manejarEnvio} noValidate className='mt-6 space-y-4'>
            <div>
              <label
                htmlFor='identificador'
                className='block text-sm font-medium text-slate-700'
              >
                Usuario o correo
              </label>
              <input
                id='identificador'
                name='identificador'
                type='text'
                autoComplete='username'
                value={identificador}
                onChange={(e) => setIdentificador(e.target.value)}
                disabled={cargando}
                aria-invalid={errorCampo !== null}
                aria-describedby={errorCampo !== null ? "error-campo" : undefined}
                className='mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
              />
            </div>

            <div>
              <label
                htmlFor='contrasena'
                className='block text-sm font-medium text-slate-700'
              >
                Contraseña
              </label>
              <input
                id='contrasena'
                name='contrasena'
                type='password'
                autoComplete='current-password'
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                disabled={cargando}
                aria-invalid={errorCampo !== null}
                aria-describedby={errorCampo !== null ? "error-campo" : undefined}
                className='mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
              />
            </div>

            {errorCampo !== null && (
              <p id='error-campo' role='alert' className='text-sm text-red-700'>
                {errorCampo}
              </p>
            )}

            {cargando ? (
              <EstadoCarga mensaje='Verificando tus credenciales…' />
            ) : (
              <button
                type='submit'
                className='w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2'
              >
                Iniciar sesión
              </button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
