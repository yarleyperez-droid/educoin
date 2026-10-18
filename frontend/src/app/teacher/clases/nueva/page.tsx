/**
 * Página de creación de clase (`/teacher/clases/nueva`) — T5.6.1 (PRO-385).
 *
 * Vista cliente del alta de clase del panel docente (CA 1 de H5.6): el
 * formulario envía el nombre y, al crear, muestra el **código de unión
 * visible y copiable con un clic**.
 *
 * Responsabilidades de esta vista:
 * - Capturar `nombre` con `label` accesible y validarlo en cliente
 *   (8–150 tras `trim`) **sin** llamar a la capa de datos si no cumple.
 * - Mostrar estado de carga (botón deshabilitado + "Creando…").
 * - Mostrar errores de la capa en un área `role="alert"` con **solo**
 *   `error.message` de `ApiError` (nunca `detalles` ni códigos HTTP) y
 *   **sin limpiar lo escrito** en el formulario (CA 3 del padre H5.6).
 * - En éxito: tarjeta con el código de 8 caracteres en un campo de solo
 *   lectura (seleccionable como fallback) + botón "Copiar código" con
 *   feedback "¡Copiado!".
 *
 * Contrato con el backend:
 * - La vista **no** conoce endpoints, cookies ni tokens: todo pasa por
 *   `features/teacher/api/clases.ts` (hoy mock del contrato de H3.1;
 *   T5.6.4 reemplazará el interior sin tocar esta vista).
 * - El frontend no es barrera de seguridad (AGENTS.md §9): el rol teacher
 *   lo validan el `middleware` (UX) y, sobre todo, el backend en cada
 *   petición (`@Roles('teacher')` de H3.1).
 */

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  crearClase,
  LONGITUD_MAXIMA_NOMBRE,
  LONGITUD_MINIMA_NOMBRE,
} from "@/features/teacher/api/clases";
import type { Clase } from "@/features/teacher/tipos";
import { copiarAlPortapapeles } from "@/features/teacher/util/portapapeles";
import { ApiError } from "@/lib/api-client";

/** Mensaje de validación cuando el nombre viene vacío. */
const MENSAJE_NOMBRE_VACIO = "Ingresa un nombre para la clase.";

/** Mensaje de validación cuando el nombre no llega al mínimo. */
const MENSAJE_NOMBRE_CORTO =
  "El nombre de la clase debe tener al menos 8 caracteres.";

/** Mensaje de validación cuando el nombre supera el máximo. */
const MENSAJE_NOMBRE_LARGO =
  "El nombre de la clase no puede superar los 150 caracteres.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/** Texto del fallback cuando el navegador no permite copiar al portapapeles. */
const MENSAJE_COPIADO_FALLBACK =
  "No se pudo copiar automáticamente. Selecciona el código y cópialo a mano.";

/** Duración del feedback "¡Copiado!" (ms). */
const DURACION_COPIADO_MS = 2000;

/**
 * Vista de crear clase con código de unión copiable.
 *
 * Componente cliente (App Router): solo él lleva estado y eventos
 * (AGENTS.md §8). El estado es React controlado a mano — `react-hook-form`
 * no está instalado en `frontend/` (misma decisión que T5.4.1) y esta
 * tarea no suma dependencias.
 *
 * Estados cubiertos (AGENTS.md §8: carga, vacío y error):
 * - **Vacío / validación:** `errorCampo` si el nombre no cumple 8–150; no
 *   se llama a la capa de datos.
 * - **Carga:** `cargando` deshabilita el botón y muestra "Creando…".
 * - **Error de envío:** `errorEnvio` con `ApiError.message`; el formulario
 *   conserva lo escrito.
 * - **Éxito:** `claseCreada` cambia la tarjeta por el resumen con el
 *   código; `copiado` gestiona el feedback del portapapeles.
 *
 * @returns Formulario de alta de clase dentro del shell del panel docente.
 */
export default function NuevaClasePage() {
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [claseCreada, setClaseCreada] = useState<Clase | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [errorCopia, setErrorCopia] = useState<string | null>(null);

  /**
   * Valida el nombre en cliente sin llamar a la capa de datos.
   *
   * @param valor Nombre escrito en el formulario.
   * @returns Mensaje de error, o `null` si el nombre cumple 8–150.
   */
  function validarNombre(valor: string): string | null {
    const normalizado = valor.trim();

    if (normalizado === "") {
      return MENSAJE_NOMBRE_VACIO;
    }

    if (normalizado.length < LONGITUD_MINIMA_NOMBRE) {
      return MENSAJE_NOMBRE_CORTO;
    }

    if (normalizado.length > LONGITUD_MAXIMA_NOMBRE) {
      return MENSAJE_NOMBRE_LARGO;
    }

    return null;
  }

  /**
   * Procesa el envío del formulario.
   *
   * Flujo: valida en cliente (sin llamada si falla) → `crearClase` (capa de
   * datos) → muestra la tarjeta de éxito con el código. Cualquier `ApiError`
   * se muestra tal cual (`error.message`) sin perder lo escrito.
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErrorEnvio(null);

    const error = validarNombre(nombre);

    if (error !== null) {
      setErrorCampo(error);
      return;
    }

    setErrorCampo(null);
    setCargando(true);

    try {
      const clase = await crearClase({ nombre });
      setClaseCreada(clase);
      setCopiado(false);
      setErrorCopia(null);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrorEnvio(e.message);
      } else {
        setErrorEnvio(MENSAJE_ERROR_GENERICO);
      }
    } finally {
      setCargando(false);
    }
  }

  /**
   * Copia el código de unión al portapapeles y muestra el feedback.
   *
   * Si el navegador bloquea la API de portapapeles, se muestra el fallback
   * (el código queda seleccionable en el campo de solo lectura) sin romper
   * el flujo.
   */
  async function manejarCopia(): Promise<void> {
    if (!claseCreada) {
      return;
    }

    const exito = await copiarAlPortapapeles(claseCreada.codigo);

    if (exito) {
      setCopiado(true);
      setErrorCopia(null);
      setTimeout(() => setCopiado(false), DURACION_COPIADO_MS);
    } else {
      setCopiado(false);
      setErrorCopia(MENSAJE_COPIADO_FALLBACK);
    }
  }

  /** Vuelve al formulario vacío para crear otra clase. */
  function crearOtra(): void {
    setClaseCreada(null);
    setNombre("");
    setErrorCampo(null);
    setErrorEnvio(null);
    setCopiado(false);
    setErrorCopia(null);
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-xl font-semibold text-neutral-900">Crear clase</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Al crearla recibirás su código de unión para compartirla con tus
        estudiantes.
      </p>

      {claseCreada === null ? (
        <form onSubmit={manejarEnvio} noValidate className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="nombre-clase"
              className="block text-sm font-medium text-neutral-700"
            >
              Nombre de la clase
            </label>
            <input
              id="nombre-clase"
              name="nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={cargando}
              placeholder="p. ej. Matemáticas 10A"
              aria-invalid={errorCampo !== null}
              aria-describedby={
                errorCampo !== null ? "error-nombre" : "ayuda-nombre"
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p id="ayuda-nombre" className="mt-1 text-xs text-neutral-500">
              Entre {LONGITUD_MINIMA_NOMBRE} y {LONGITUD_MAXIMA_NOMBRE}{" "}
              caracteres.
            </p>
          </div>

          {errorCampo !== null && (
            <p id="error-nombre" role="alert" className="text-sm text-red-700">
              {errorCampo}
            </p>
          )}

          {errorEnvio !== null && (
            <p id="error-envio" role="alert" className="text-sm text-red-700">
              {errorEnvio}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={cargando}
              aria-busy={cargando}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cargando ? "Creando…" : "Crear clase"}
            </button>
            <Link
              href="/teacher"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Volver al panel
            </Link>
          </div>
        </form>
      ) : (
        <section aria-live="polite" className="mt-6 space-y-4">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-medium text-neutral-700">
              Clase creada: {claseCreada.nombre}
            </p>

            <label
              htmlFor="codigo-union"
              className="mt-3 block text-xs font-medium uppercase tracking-wide text-neutral-500"
            >
              Código de unión
            </label>
            <input
              id="codigo-union"
              type="text"
              readOnly
              value={claseCreada.codigo}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />

            <button
              type="button"
              onClick={manejarCopia}
              className="mt-3 w-full rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
            >
              {copiado ? "¡Copiado!" : "Copiar código"}
            </button>

            {errorCopia !== null && (
              <p role="alert" className="mt-2 text-xs text-amber-700">
                {errorCopia}
              </p>
            )}
          </div>

          <p className="text-sm text-neutral-500">
            Comparte este código con tus estudiantes para que se unan a la
            clase.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={crearOtra}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
            >
              Crear otra clase
            </button>
            <Link
              href={`/teacher/clases/${claseCreada.id}/actividades/nueva`}
              className="text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
            >
              Añadir una actividad
            </Link>
            <Link
              href="/teacher"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Volver al panel
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
