/**
 * Página de creación de clase (`/teacher/clases/nueva`) — T5.6.1 (PRO-385).
 *
 * Vista cliente del alta de clase del panel docente (CA 1 de H5.6): el
 * formulario envía el nombre y, al crear, abre un **diálogo de
 * confirmación** con el **código de unión visible y copiable con un clic**
 * (rediseño: el resumen ya no sustituye al formulario en línea, sino que
 * se muestra en un `Modal` accesible sobre la página).
 *
 * Responsabilidades de esta vista:
 * - Capturar `nombre` con `label` accesible y validarlo en cliente
 *   (8–150 tras `trim`) **sin** llamar a la capa de datos si no cumple.
 * - Mostrar estado de carga (botón deshabilitado + "Creando…").
 * - Mostrar errores de la capa en un área `role="alert"` con **solo**
 *   `error.message` de `ApiError` (nunca `detalles` ni códigos HTTP) y
 *   **sin limpiar lo escrito** en el formulario (CA 3 del padre H5.6).
 * - En éxito: `Modal` con el código de 8 caracteres vía el componente
 *   compartido `CodigoUnion` (campo de solo lectura seleccionable +
 *   botón "Copiar código" con feedback "¡Copiado!") y atajos a "Añadir
 *   una actividad" / "Crear otra clase" / "Volver al panel". Cerrar el
 *   diálogo (✕, Escape, overlay o acción) vacía el formulario y deja la
 *   página lista para otra creación.
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
import { useCallback, useState, type FormEvent } from "react";

import { PanelLateral } from '@/components/features/panel-lateral';
import { Modal } from "@/components/ui";
import {
  crearClase,
  LONGITUD_MAXIMA_NOMBRE,
  LONGITUD_MINIMA_NOMBRE,
} from "@/features/teacher/api/clases";
import { CodigoUnion } from "@/features/teacher/componentes/codigo-union";
import type { Clase } from "@/features/teacher/tipos";
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

/**
 * Vista de crear clase con confirmación modal y código de unión copiable.
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
 * - **Éxito:** `claseCreada` abre el `Modal` con el resumen y el código
 *   (el bloque copiable vive en `CodigoUnion`).
 *
 * @returns Formulario de alta de clase dentro del shell del panel docente.
 */
export default function NuevaClasePage() {
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [claseCreada, setClaseCreada] = useState<Clase | null>(null);

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
   * datos) → abre el `Modal` de confirmación con el código. Cualquier
   * `ApiError` se muestra tal cual (`error.message`) sin perder lo
   * escrito.
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

  /** Vuelve al formulario vacío para crear otra clase. */
  const crearOtra = useCallback((): void => {
    setClaseCreada(null);
    setNombre("");
    setErrorCampo(null);
    setErrorEnvio(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header (mismo patrón que el listado "Mis Clases"). */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
          Crear clase
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Al crearla recibirás su código de unión para compartirla con tus
          estudiantes.
        </p>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <div className='w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
            <form onSubmit={manejarEnvio} noValidate>
              <div>
                <label
                  htmlFor='nombre-clase'
                  className='block text-sm font-medium text-slate-700'
                >
                  Nombre de la clase
                </label>
                <input
                  id='nombre-clase'
                  name='nombre'
                  type='text'
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={cargando}
                  placeholder='p. ej. Matemáticas 10A'
                  aria-invalid={errorCampo !== null}
                  aria-describedby={
                    errorCampo !== null ? 'error-nombre' : 'ayuda-nombre'
                  }
                  className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60'
                />
                <p id='ayuda-nombre' className='mt-1 text-xs text-slate-500'>
                  Entre {LONGITUD_MINIMA_NOMBRE} y {LONGITUD_MAXIMA_NOMBRE}{' '}
                  caracteres.
                </p>
              </div>

              {errorCampo !== null && (
                <p
                  id='error-nombre'
                  role='alert'
                  className='mt-4 text-sm text-red-700'
                >
                  {errorCampo}
                </p>
              )}

              {errorEnvio !== null && (
                <p
                  id='error-envio'
                  role='alert'
                  className='mt-4 text-sm text-red-700'
                >
                  {errorEnvio}
                </p>
              )}

              <div className='mt-6 flex items-center gap-3'>
                <button
                  type='submit'
                  disabled={cargando}
                  aria-busy={cargando}
                  className='rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {cargando ? 'Creando…' : 'Crear clase'}
                </button>
                <Link
                  href='/teacher'
                  className='text-sm font-medium text-slate-600 hover:text-slate-900'
                >
                  Volver al panel
                </Link>
              </div>
            </form>
          </div>
        </div>

        <PanelLateral titulo='Cómo compartir tu clase'>
          <ol className='list-decimal space-y-2 pl-5'>
            <li>1. Escribe el nombre de la clase.</li>
            <li>2. Al crearla se genera un código de unión de 8 caracteres.</li>
            <li>
              3. Comparte el código: tus estudiantes podrán unirse desde su
              panel.
            </li>
          </ol>
        </PanelLateral>
      </div>

      {/* Confirmación de éxito: el formulario sigue montado detrás y el
          diálogo concentra la atención en el código de unión. */}
      <Modal
        abierto={claseCreada !== null}
        titulo={
          claseCreada !== null ? `Clase creada: ${claseCreada.nombre}` : ""
        }
        alCerrar={crearOtra}
        acciones={
          <>
            {claseCreada !== null && (
              <Link
                href={`/teacher/clases/${claseCreada.id}/actividades/nueva`}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Añadir una actividad
              </Link>
            )}
            <button
              type="button"
              onClick={crearOtra}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Crear otra clase
            </button>
            <Link
              href="/teacher"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Volver al panel
            </Link>
          </>
        }
      >
        {claseCreada !== null && (
          <div>
            <CodigoUnion codigo={claseCreada.codigo} />
            <p className="mt-4 text-sm text-slate-500">
              Comparte este código con tus estudiantes para que se unan a la
              clase.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
