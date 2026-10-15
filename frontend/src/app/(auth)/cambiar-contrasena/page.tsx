/**
 * Página de cambio obligatorio de contraseña (`/cambiar-contrasena`) —
 * T5.4.2 (PRO-379).
 *
 * Vista de bloqueo del MVP: cuando la sesión trae `debeCambiarContrasena:
 * true` (columna real `users.must_change_password`; nombre del backend
 * desde T5.4.3), el middleware (T5.3.2 ampliado en T5.4.2) no deja navegar a
 * ningún otro sitio hasta completar el cambio aquí. La vista consume la capa
 * `@/features/auth/api/auth`, cuyo `cambiarContrasena` sigue siendo **mock
 * documentado** porque H2.2 (endpoint real de cambio) no existe todavía
 * (PRO-381 integró solo login/logout de H2.1).
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
 * - Estado de carga: mientras hay una petición en curso el botón se
 *   sustituye por `<EstadoCarga />` del kit UI (H5.2, `role="status"` +
 *   `aria-live`), con los campos deshabilitados.
 * - Errores de envío en el **toast accesible** del kit UI (H5.2): variante
 *   `error` + `aria-live`, con **solo** el mensaje legible de `ApiError`
 *   (`mensajeDeErrorApi`), **conservando lo escrito** en los tres campos.
 * - Éxito → navegación **completa** con
 *   `window.location.assign(rutaPorRol(...))` (con la sesión actualizada, el
 *   middleware ya no lo bloquea porque la cookie quedó con el flag en
 *   `false`). Es una recarga a propósito y no `router.push`: el router
 *   client-side de Next cachea el redirect 307 que el middleware emitió para
 *   `/student` cuando la sesión aún traía `debeCambiarContrasena: true`, y un
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
 * **Límite del mock (plan §7):** hasta que exista H2.2 el cambio vive solo
 * en la cookie del navegador: al volver a hacer login, el backend (que sigue
 * con `must_change_password = true` en la BD) volverá a exigir el cambio.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  EstadoCarga,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import {
  cambiarContrasena,
  leerSesionActual,
  rutaPorRol,
} from "@/features/auth/api/auth";

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
 * - **Carga de envío:** `cargando` sustituye el botón por
 *   `<EstadoCarga mensaje="Guardando…" />`; los campos quedan deshabilitados.
 * - **Error de envío:** toast `error` con `mensajeDeErrorApi(error)`,
 *   conservando lo escrito. Las validaciones de campo siguen en el área
 *   `role="alert"` en línea.
 *
 * El renderizado **no depende de la sesión** (formulario siempre visible) para
 * evitar el hydration mismatch: el servidor prerenderiza sin `document`, pero
 * el middleware ya redirige a `/login` cuando no hay sesión.
 *
 * @returns Formulario de cambio centrado sobre el fondo neutro del layout.
 */
export default function CambiarContrasenaPage() {
  const router = useRouter();
  const { mostrar } = useToast();

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
   * `cambiarContrasena` → redirige al panel del rol con `rutaPorRol`. Si
   * falla, `mensajeDeErrorApi` extrae el mensaje legible (`ApiError.message`)
   * o devuelve el genérico (sin filtrar detalles internos) y se anuncia con
   * el toast `error` del kit UI (H5.2). Los campos no se limpian: se conserva
   * lo escrito para corregir.
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

      window.location.assign(rutaPorRol(sesionActualizada.role));
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
              className="mt-1 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="mt-1 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="mt-1 w-full rounded-md border border-neutral-500 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {errorCampo !== null && (
            <p id="error-campo" role="alert" className="text-sm text-red-700">
              {errorCampo}
            </p>
          )}

          {cargando ? (
            <EstadoCarga mensaje="Guardando tu contraseña…" />
          ) : (
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-700 focus-visible:ring-offset-2"
            >
              Cambiar contraseña
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
