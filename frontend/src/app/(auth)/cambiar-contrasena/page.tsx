/**
 * Página de cambio obligatorio de contraseña (`/cambiar-contrasena`) —
 * T5.4.2 (PRO-379).
 *
 * Vista de bloqueo del MVP: cuando la sesión trae `mustChangePassword: true`
 * (columna real `users.must_change_password`), el middleware (T5.3.2 ampliado
 * en T5.4.2) no deja navegar a ningún otro sitio hasta completar el cambio
 * aquí. La vista consume la capa `@/features/auth/api/auth` (hoy mock; T5.4.3
 * la conecta a H2.2 sin tocar esta vista).
 *
 * Responsabilidades de esta vista:
 * - Renderizar **el mismo DOM en servidor y cliente** (formulario siempre
 *   visible): el middleware (T5.3.2 ampliado en T5.4.2) ya protege la ruta y
 *   redirige a `/login` sin sesión antes de llegar aquí; el chequeo
 *   client-side es solo cinturón y tiradores y vive únicamente en un efecto
 *   (ver más abajo). La vista **no** conoce usuarios, cookies ni tokens: todo
 *   eso vive en la capa de auth (mismo criterio que la vista de login).
 * - Capturar tres campos con `label` accesible (`htmlFor`): contraseña
 *   actual (`current-password`), nueva contraseña y confirmación
 *   (`new-password`).
 * - Validar en cliente (sin llamar a la capa si falla): campos no vacíos,
 *   nueva contraseña de al menos 8 caracteres, nueva distinta de la actual y
 *   confirmación coincidente.
 * - Estado de carga: botón deshabilitado con el texto "Guardando…" mientras
 *   hay una petición en curso.
 * - Errores de envío en un área `role="alert"` con **solo** `error.message`
 *   de `ApiError`, **conservando lo escrito** en los tres campos.
 * - Éxito → navegación **completa** con
 *   `window.location.assign(rutaPorRol(...))` (con la sesión actualizada, el
 *   middleware ya no lo bloquea porque la cookie quedó con el flag en
 *   `false`). Es una recarga a propósito y no `router.push`: el router
 *   client-side de Next cachea el redirect 307 que el middleware emitió para
 *   `/student` cuando la sesión aún traía `mustChangePassword: true`, y un
 *   `push` posterior reutiliza ese redirect sin revalidar con el servidor,
 *   dejando al usuario atrapado en `/cambiar-contrasena` aunque la cookie ya
 *   quedó actualizada (bug real detectado con los E2E de T5.4.4). La recarga
 *   completa garantiza que el servidor revalide contra la cookie vigente.
 *
 * Contrato con el backend (para no cazar bugs cuando llegue H2.2):
 * - La vista no valida la contraseña actual ni las reglas de seguridad
 *   reales: las de aquí son de UX (spec §Supuestos 1). H2.2 manda; si sus
 *   reglas difieren, se ajusta solo esta validación de cliente.
 * - El frontend no es barrera de seguridad (AGENTS.md §9): el bloqueo real
 *   lo impone el backend (H2.1/H2.2); este guard de Next es UX.
 *
 * **Límite del mock (plan §7):** hasta T5.4.3 el cambio vive solo en la
 * memoria del dev server: un reload del navegador puede "olvidar" la
 * contraseña cambiada y volver a exigir el cambio si el usuario mock sigue
 * con `mustChangePassword: true`.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  cambiarContrasena,
  leerSesionActual,
  rutaPorRol,
} from "@/features/auth/api/auth";
import { ApiError } from "@/lib/api-client";

/** Mensaje de validación cuando falta algún campo del formulario. */
const MENSAJE_CAMPOS_INCOMPLETOS =
  "Completa los tres campos para continuar.";

/** Mensaje cuando la nueva contraseña no llega a 8 caracteres (regla UX). */
const MENSAJE_NUEVA_MUY_CORTA =
  "La nueva contraseña debe tener al menos 8 caracteres.";

/** Mensaje cuando la nueva contraseña coincide con la actual (regla UX). */
const MENSAJE_NUEVA_IGUAL_A_ACTUAL =
  "La nueva contraseña debe ser distinta de la actual.";

/** Mensaje cuando la confirmación no coincide con la nueva contraseña. */
const MENSAJE_CONFIRMACION_DIFIERE =
  "La confirmación no coincide con la nueva contraseña.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO =
  "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Formulario de cambio obligatorio de contraseña.
 *
 * Componente cliente (App Router): solo él lleva estado, efectos y eventos
 * (AGENTS.md §8); el resto del shell sigue siendo de servidor. El estado es
 * React controlado a mano (spec §Supuestos 4): `react-hook-form` no está
 * instalado en `frontend/` y esta tarea no suma dependencias (mismo criterio
 * que T5.4.1).
 *
 * Estados cubiertos (AGENTS.md §8: carga, vacío y error):
 * - **Vacío / validación:** `errorCampo` con el primer problema detectado
 *   (vacío, < 8, igual a actual, confirmación distinta); no se llama a la
 *   capa de auth.
 * - **Carga de envío:** `cargando` deshabilita el botón y muestra
 *   "Guardando…".
 * - **Error de envío:** `errorEnvio` en un área `role="alert"` con solo el
 *   mensaje de `ApiError` (o uno genérico), conservando lo escrito.
 *
 * El renderizado **no depende de la sesión** (formulario siempre visible) para
 * evitar el hydration mismatch: el servidor prerenderiza sin `document`, pero
 * el middleware ya redirige a `/login` cuando no hay sesión.
 *
 * @returns Formulario de cambio centrado sobre el fondo neutro del layout.
 */
export default function CambiarContrasenaPage() {
  const router = useRouter();

  /**
   * Sesión vigente, leída una sola vez al crear el estado.
   *
   * Solo se usa para la redirección de seguridad en el efecto y para la
   * navegación completa tras el cambio exitoso. La cookie no cambia mientras
   * la vista está montada (el envío exitoso navega fuera de ella). En el
   * prerender del servidor `document` no existe y `leerSesionActual` devuelve
   * `null`.
   */
  const [sesion] = useState(() => leerSesionActual());

  const [contrasenaActual, setContrasenaActual] = useState("");
  const [contrasenaNueva, setContrasenaNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  /**
   * Redirige a `/login` cuando no hay una sesión válida.
   *
   * El middleware ya protege la ruta, pero este guard client-side evita
   * mostrar el formulario si alguien llega aquí sin sesión. Solo redirige,
   * sin setState dentro del efecto (regla react-hooks/set-state-in-effect).
   */
  useEffect(() => {
    if (sesion === null) {
      router.replace("/login");
    }
  }, [sesion, router]);

  /**
   * Procesa el envío del formulario.
   *
   * Flujo: valida en cliente (sin llamar a la capa) → llama a
   * `cambiarContrasena` → redirige al panel del rol con `rutaPorRol`.
   * Cualquier `ApiError` se muestra tal cual (`error.message`); los errores
   * ajenos a la API se traducen a un mensaje genérico (sin filtrar detalles
   * internos). Los campos no se limpian: se conserva lo escrito para corregir.
   *
   * La redirección de éxito usa `window.location.assign` (navegación completa)
   * en vez de `router.push` para evitar que Next reutilice un redirect 307
   * cacheado del middleware (ver docstring del archivo).
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(
    evento: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(null);

    if (
      contrasenaActual.trim() === "" ||
      contrasenaNueva.trim() === "" ||
      confirmacion.trim() === ""
    ) {
      setErrorCampo(MENSAJE_CAMPOS_INCOMPLETOS);
      return;
    }

    if (contrasenaNueva.length < 8) {
      setErrorCampo(MENSAJE_NUEVA_MUY_CORTA);
      return;
    }

    if (contrasenaNueva === contrasenaActual) {
      setErrorCampo(MENSAJE_NUEVA_IGUAL_A_ACTUAL);
      return;
    }

    if (confirmacion !== contrasenaNueva) {
      setErrorCampo(MENSAJE_CONFIRMACION_DIFIERE);
      return;
    }

    setErrorCampo(null);
    setCargando(true);

    try {
      const sesionActualizada = await cambiarContrasena({
        actual: contrasenaActual,
        nueva: contrasenaNueva,
      });

      window.location.assign(rutaPorRol(sesionActualizada.rol));
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
          Cambia tu contraseña para continuar.
        </p>

        <form onSubmit={manejarEnvio} noValidate className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="contrasena-actual"
              className="block text-sm font-medium text-neutral-700"
            >
              Contraseña actual
            </label>
            <input
              id="contrasena-actual"
              name="contrasena-actual"
              type="password"
              autoComplete="current-password"
              value={contrasenaActual}
              onChange={(e) => setContrasenaActual(e.target.value)}
              disabled={cargando}
              aria-invalid={errorCampo !== null}
              aria-describedby={errorCampo !== null ? "error-campo" : undefined}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="contrasena-nueva"
              className="block text-sm font-medium text-neutral-700"
            >
              Nueva contraseña
            </label>
            <input
              id="contrasena-nueva"
              name="contrasena-nueva"
              type="password"
              autoComplete="new-password"
              value={contrasenaNueva}
              onChange={(e) => setContrasenaNueva(e.target.value)}
              disabled={cargando}
              aria-invalid={errorCampo !== null}
              aria-describedby={errorCampo !== null ? "error-campo" : undefined}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="confirmacion"
              className="block text-sm font-medium text-neutral-700"
            >
              Confirmar la nueva contraseña
            </label>
            <input
              id="confirmacion"
              name="confirmacion"
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
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
            {cargando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      </div>
    </main>
  );
}
