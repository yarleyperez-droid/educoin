/**
 * Página de inicio de sesión (`/login`) — T5.4.1 (PRO-377).
 *
 * Formulario real de login (usuario **o** correo + contraseña) que delega la
 * validación de credenciales en la capa `@/features/auth/api/auth` (hoy mock;
 * T5.4.3 la reemplaza por la API real de H2.1 sin tocar esta vista).
 *
 * Responsabilidades de esta vista:
 * - Capturar identificador y contraseña con `label` accesible (`htmlFor`).
 * - Validar en cliente que ambos campos vengan rellenos (sin llamar a la
 *   capa de auth si falta alguno) y mostrar el mensaje de validación.
 * - Mostrar el estado de carga: botón deshabilitado con el texto
 *   "Verificando…" mientras hay una petición en curso.
 * - Mostrar errores de credenciales en un área `role="alert"` con **solo**
 *   `error.message` de `ApiError` — nunca se ramifica por código HTTP ni se
 *   muestran `error.detalles` (spec §Contrato con el backend, punto 3).
 * - Redirigir al panel del rol tras el login (`rutaPorRol`).
 *
 * Contrato con el backend (para no cazar bugs cuando llegue H2.1):
 * - La vista **no** conoce usuarios, cookies ni tokens: todo eso vive en la
 *   capa de auth. Cuando H2.1 llegue, solo cambia el interior de esa capa
 *   (T5.4.3) y esta vista queda igual.
 * - El frontend no es barrera de seguridad (AGENTS.md §9): el rol validado
 *   aquí es UX; el backend revalida cada petición.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { iniciarSesion, rutaPorRol } from "@/features/auth/api/auth";
import { ApiError } from "@/lib/api-client";

/** Mensaje de validación cuando falta algún campo del formulario. */
const MENSAJE_CAMPOS_INCOMPLETOS =
  "Ingresa tu usuario o correo y tu contraseña para continuar.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

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
 * - **Carga:** `cargando` deshabilita el botón y muestra "Verificando…".
 * - **Error de envío:** `errorEnvio` en un área `role="alert"` con solo el
 *   mensaje de `ApiError` (o uno genérico si el error no es de la API).
 *
 * @returns Formulario de login centrado sobre el fondo neutro del layout.
 */
export default function LoginPage() {
  const router = useRouter();

  const [identificador, setIdentificador] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  /**
   * Procesa el envío del formulario.
   *
   * Flujo: valida campos vacíos (sin llamar a la capa) → llama a
   * `iniciarSesion` → redirige al panel del rol con `rutaPorRol`. Cualquier
   * `ApiError` se muestra tal cual (`error.message`); los errores ajenos a
   * la API se traducen a un mensaje genérico (sin filtrar detalles internos).
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(null);

    const identificadorNormalizado = identificador.trim();

    if (identificadorNormalizado === "" || contrasena.trim() === "") {
      setErrorCampo(MENSAJE_CAMPOS_INCOMPLETOS);
      return;
    }

    setErrorCampo(null);
    setCargando(true);

    try {
      const sesion = await iniciarSesion({
        identificador: identificadorNormalizado,
        contrasena,
      });

      router.push(rutaPorRol(sesion.rol));
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorEnvio(error.message);
      } else {
        setErrorEnvio(MENSAJE_ERROR_GENERICO);
      }
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
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {errorCampo !== null && (
            <p id="error-campo" role="alert" className="text-sm text-red-700">
              {errorCampo}
            </p>
          )}

          {errorEnvio !== null && (
            <p id="error-envio" role="alert" className="text-sm text-red-700">
              {errorEnvio}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando}
            aria-busy={cargando}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando ? "Verificando…" : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </main>
  );
}
