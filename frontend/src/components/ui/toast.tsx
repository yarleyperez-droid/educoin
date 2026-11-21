/**
 * Toast accesible del kit UI (H5.2 / PRO-283, T5.2.2 / PRO-370).
 *
 * Implementación **propia** (decisión del usuario: sin librerías de runtime)
 * que replica el comportamiento del prototipo
 * (`docs/prototipo-educoins.html:749-755`): un aviso fijo abajo a la
 * derecha, variantes de éxito y error, auto-ocultado a los 3000 ms.
 *
 * Accesibilidad (CA 3): cada aviso vive en una región `aria-live` — `polite`
 * para éxitos y `assertive` + `role="alert"` para errores — de modo que el
 * lector de pantalla lo anuncia sin mover el foco.
 *
 * Uso (plan §2):
 * ```tsx
 * const { mostrar } = useToast();
 * catch (e) { mostrar(mensajeDeErrorApi(e), "error"); }
 * ```
 * El `ProveedorToast` se monta una sola vez en `app/layout.tsx`.
 *
 * @packageDocumentation
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { ApiError } from "@/lib/api-client";

/** Variante visual y semántica del aviso. */
export type VarianteToast = "exito" | "error";

/** Aviso visible en pantalla. */
export interface Toast {
  /** Identificador único del aviso (para reemplazar avisos previos). */
  id: number;
  /** Mensaje anunciado. */
  mensaje: string;
  /** Variante del aviso. */
  variante: VarianteToast;
}

/** API del contexto de toasts. */
export interface ContextoToast {
  /**
   * Muestra un aviso (reemplaza el anterior) y lo oculta a los 3000 ms.
   *
   * @param mensaje Texto a anunciar.
   * @param variante `"error"` por defecto (usa `role="alert"`).
   */
  mostrar: (mensaje: string, variante?: VarianteToast) => void;
}

/** Mensaje genérico cuando el error no proviene de `ApiError` (H5.1). */
export const MENSAJE_ERROR_GENERICO =
  "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Traduce cualquier error a un mensaje legible para la persona usuaria.
 *
 * - `ApiError` (H5.1) → su `message` ya redactado en español por el cliente
 *   HTTP (409/422 traducidos, mensaje del backend si lo trae).
 * - Cualquier otra excepción → mensaje genérico, **sin** filtrar detalles
 *   internos (AGENTS.md §9).
 *
 * @param error Error capturado en el `catch`.
 * @returns Mensaje seguro para mostrar en la UI.
 */
export function mensajeDeErrorApi(error: unknown): string {
  return error instanceof ApiError ? error.message : MENSAJE_ERROR_GENERICO;
}

/** Duración del aviso en milisegundos (prototipo: 3000 ms). */
const DURACION_MS = 3000;

const Contexto = createContext<ContextoToast | null>(null);

/**
 * Proveedor del toast. Debe montarse una sola vez (raíz de la app).
 *
 * El aviso se crea vía portal en `document.body` solo cuando hay un aviso
 * activo (algo que solo ocurre tras un evento del cliente), de modo que el
 * prerender del servidor nunca toca `document` y no hay hydration mismatch
 * (mismo criterio que la vista de `/cambiar-contrasena`).
 *
 * @param props `children` de la app.
 * @returns Árbol con contexto y portal del aviso activo.
 */
export function ProveedorToast({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [toast, setToast] = useState<Toast | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El portal solo se monta cuando hay un aviso activo, y eso solo puede
  // ocurrir tras un evento del cliente: así `document` nunca se toca en el
  // prerender del servidor y no hay hydration mismatch. Sin setState dentro
  // del efecto (regla react-hooks/set-state-in-effect).
  useEffect(() => {
    return () => {
      if (temporizador.current !== null) clearTimeout(temporizador.current);
    };
  }, []);

  const mostrar = useCallback(
    (mensaje: string, variante: VarianteToast = "error") => {
      setToast({ id: Date.now(), mensaje, variante });
      if (temporizador.current !== null) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setToast(null), DURACION_MS);
    },
    [],
  );

  const valor = useMemo(() => ({ mostrar }), [mostrar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {toast !== null &&
        typeof document !== "undefined" &&
        createPortal(<Aviso toast={toast} />, document.body)}
    </Contexto.Provider>
  );
}

/**
 * Hook para mostrar avisos desde cualquier componente cliente.
 *
 * @throws Si no existe un `ProveedorToast` por encima.
 * @returns La función `mostrar` del contexto.
 */
export function useToast(): ContextoToast {
  const contexto = useContext(Contexto);
  if (contexto === null) {
    throw new Error("useToast requiere un <ProveedorToast> por encima.");
  }
  return contexto;
}

/**
 * Aviso renderizado en el portal.
 *
 * @param toast Aviso a pintar.
 * @returns Elemento con `aria-live` (polite/assertive) y variante de color.
 */
function Aviso({ toast }: { toast: Toast }): ReactElement {
  const esError = toast.variante === "error";
  return (
    <div
      key={toast.id}
      role={esError ? "alert" : "status"}
      aria-live={esError ? "assertive" : "polite"}
      className="fixed right-6 bottom-6 z-50 max-w-xs rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg"
      style={{
        backgroundColor: esError ? "var(--danger)" : "var(--success)",
      }}
    >
      {toast.mensaje}
    </div>
  );
}
