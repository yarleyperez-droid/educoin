/**
 * Página de inicio de sesión (`/login`) — T5.4.1 (PRO-377), integrada con la
 * API real en T5.4.3 (PRO-381).
 *
 * Formulario real de login (usuario **o** correo + contraseña) que delega la
 * validación de credenciales en la capa `@/features/auth/api/auth` (que desde
 * T5.4.3 habla con `POST auth/login` real de H2.1).
 *
 * Responsabilidades de esta vista:
 * - Capturar identificador y contraseña con `label` accesible (`htmlFor`).
 * - Validar en cliente que ambos campos vengan rellenos (sin llamar a la
 *   capa de auth si falta alguno) y mostrar el mensaje de validación.
 * - Mostrar el estado de carga: botón deshabilitado con el texto
 *   "Verificando…" mientras hay una petición en curso.
 * - Anunciar los errores de envío con el **toast accesible** del kit UI
 *   (H5.2 / PRO-283): variante `error`, región `aria-live`, con **solo** el
 *   mensaje legible de `ApiError` (`mensajeDeErrorApi`) — nunca se ramifica
 *   por código HTTP ni se muestran `error.detalles`. Con H2.1 el mensaje real
 *   es "El usuario o la contraseña son erróneos.".
 * - Redirigir al panel del rol tras el login (`rutaPorRol`).
 *
 * Contrato con el backend:
 * - La vista **no** conoce usuarios, cookies ni tokens: todo eso vive en la
 *   capa de auth; los cambios de H2.x se absorben allí.
 * - El frontend no es barrera de seguridad (AGENTS.md §9): el rol validado
 *   aquí es UX; el backend revalida cada petición.
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
 * Formulario de inicio de sesión.
 *
 * Componente cliente (App Router): solo él lleva estado, efectos y eventos
 * (AGENTS.md §8); el resto del shell sigue siendo de servidor. El estado es
 * React controlado a mano (spec §Supuestos 4): `react-hook-form` no está
 * instalado en `frontend/` y esta tarea no suma dependencias.
 *
 * Estados cubiertos (AGENTS.md §8: carga, vacío y error):
 * - **Vacío / validación:** `errorCampo` si identificador o contraseña
 *   vienen vacíos (con `trim`); no se llama a la capa de auth.
 * - **Carga:** `cargando` sustituye el botón por `<EstadoCarga />`
 *   (kit UI, `role="status"` + `aria-live`); los campos quedan deshabilitados.
 * - **Error de envío:** toast `error` con `mensajeDeErrorApi(error)` —
 *   validaciones de campo siguen en el área `role="alert"` en línea.
 *
 * @returns Formulario de login centrado sobre el fondo neutro del layout.
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 p-4 sm:p-8">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-center text-2xl font-bold text-neutral-900">
          EduCoins
        </h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          Aprende, resuelve y gana recompensas
        </p>

        <form onSubmit={manejarEnvio} noValidate className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="identificador"
              className="block text-sm font-medium text-neutral-700"
            >
              Usuario o correo
            </label>
            <input
              id="identificador"
              name="identificador"
              type="text"
              autoComplete="username"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              disabled={cargando}
              aria-invalid={errorCampo !== null}
              aria-describedby={errorCampo !== null ? "error-campo" : undefined}
              className="mt-1 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="contrasena"
              className="block text-sm font-medium text-neutral-700"
            >
              Contraseña
            </label>
            <input
              id="contrasena"
              name="contrasena"
              type="password"
              autoComplete="current-password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              disabled={cargando}
              aria-invalid={errorCampo !== null}
              aria-describedby={errorCampo !== null ? "error-campo" : undefined}
              className="mt-1 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {errorCampo !== null && (
            <p id="error-campo" role="alert" className="text-sm text-red-700">
              {errorCampo}
            </p>
          )}

          {cargando ? (
            <EstadoCarga mensaje="Verificando tus credenciales…" />
          ) : (
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700 focus-visible:ring-offset-2"
            >
              Iniciar sesión
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
