/**
 * Cuestionario del estudiante (`/student/actividades/[id]`)
 * — T5.8.1 (PRO-394) + T5.8.2 (PRO-395).
 *
 * Abre una actividad **publicada**, renderiza sus preguntas con KaTeX
 * saneado y permite **enviar las respuestas una sola vez** (CA 1–3 de
 * H5.8):
 *
 * - El formulario es **controlado** por esta página (fuente única de las
 *   respuestas); sin enviar, nada pierde lo escrito.
 * - **Protección de doble envío en dos capas:** el botón desaparece al
 *   tener entrega (y la vista la re-lee al montar para el caso "recarga"),
 *   y si el servidor aún así devuelve `409`, el mensaje se muestra en un
 *   `role="alert"` sin romper la vista.
 * - Los estados de la entrega (`graded`, feedback…) llegan con T5.8.3.
 *
 * Contrato con el backend: datos por `features/estudiante/api/*` (mock de
 * H3.3/H3.4 hoy; T5.8.4 reemplaza los interiores). La vista solo lee
 * `error.message` de `ApiError`.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import "katex/dist/katex.min.css";

import { obtenerParaEstudiante } from "@/features/estudiante/api/actividades-estudiante";
import {
  enviarRespuestas,
  obtenerEntrega,
  type Entrega,
} from "@/features/estudiante/api/entregas";
import { PreguntaCuestionario } from "@/features/estudiante/componentes/pregunta-cuestionario";
import type {
  ActividadEstudiante,
  PreguntaEstudiante,
} from "@/features/estudiante/contrato/cuestionario";
import type { Respuesta } from "@/features/estudiante/contrato/entregas";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la actividad no existe o no está publicada. */
const MENSAJE_NO_ENCONTRADA =
  "No encontramos esta actividad o todavía no está publicada.";

/** Mensaje cuando el estudiante intenta enviar incompleto. */
const MENSAJE_INCOMPLETO =
  "Responde todas las preguntas antes de enviar.";

/** Mensaje del bloqueo tras el envío. */
const MENSAJE_ENVIADO = "Respuestas enviadas";

/** Texto del bloqueo: ya no hay reintento (UNIQUE de la BD). */
const MENSAJE_SIN_REINTENTO =
  "Tu entrega ya fue registrada. Solo se permite un intento por actividad.";

/** Mensaje genérico para errores inesperados que no son `ApiError`. */
const MENSAJE_ERROR_GENERICO = "Ocurrió un error inesperado. Intenta de nuevo.";

/**
 * Convierte el estado del formulario en el JSONB `answers`.
 *
 * Solo incluye `question_position` + `option`/`text` — nunca secretos ni
 * campos de calificación (spec §Contrato 2).
 *
 * @param actividad Actividad que se está respondiendo.
 * @param respuestas Valor por posición (`position` → texto elegido).
 * @returns `answers` listo para enviar.
 */
function construirAnswers(
  actividad: ActividadEstudiante,
  respuestas: Record<number, string>,
): Respuesta[] {
  return actividad.preguntas.map((pregunta: PreguntaEstudiante) => {
    const valor = respuestas[pregunta.position] ?? "";

    return pregunta.type === "test"
      ? { question_position: pregunta.position, option: valor }
      : { question_position: pregunta.position, text: valor };
  });
}

/**
 * Cuestionario con envío de respuestas (una sola vez).
 *
 * @returns Vista de la actividad con formulario o bloqueo de envío.
 */
export default function CuestionarioPage() {
  const parametros = useParams<{ id: string }>();
  const actividadId = parametros.id;

  const [cargando, setCargando] = useState(true);
  const [actividad, setActividad] = useState<ActividadEstudiante | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [respuestas, setRespuestas] = useState<Record<number, string>>({});
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        // Actividad y entrega en paralelo: si ya se envió, la vista debe
        // arrancar bloqueada aunque la página se recargue.
        const [actividadLeida, entregaLeida] = await Promise.all([
          obtenerParaEstudiante(actividadId),
          obtenerEntrega(actividadId),
        ]);

        if (!vigente) {
          return;
        }

        if (actividadLeida) {
          setActividad(actividadLeida);
          setEntrega(entregaLeida);
          setError(null);
        } else {
          setActividad(null);
          setError(MENSAJE_NO_ENCONTRADA);
        }
      } catch (e) {
        if (vigente) {
          setActividad(null);
          setError(
            e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
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
  }, [actividadId]);

  /**
   * Registra la respuesta de una pregunta (estado controlado).
   *
   * @param position Posición de la pregunta.
   * @param valor Texto de la opción o respuesta literal.
   */
  function responder(position: number, valor: string): void {
    setRespuestas((previas) => ({ ...previas, [position]: valor }));
    setErrorEnvio(null);
  }

  /**
   * Envía el formulario de respuestas.
   *
   * Validación en cliente (todas respondidas) → `enviarRespuestas` →
   * bloqueo con la entrega. Ante un error **no se limpia** nada.
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarEnvio(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();

    if (!actividad) {
      return;
    }

    const sinResponder = actividad.preguntas.some(
      (pregunta) => (respuestas[pregunta.position] ?? "").trim() === "",
    );

    if (sinResponder) {
      setErrorEnvio(MENSAJE_INCOMPLETO);
      return;
    }

    setErrorEnvio(null);
    setEnviando(true);

    try {
      const creada = await enviarRespuestas(
        actividadId,
        construirAnswers(actividad, respuestas),
      );

      setEntrega(creada);
    } catch (e) {
      // El 409 (doble envío) y el 422 llegan con su mensaje en español;
      // las respuestas escritas se conservan siempre.
      setErrorEnvio(
        e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO,
      );
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Cargando…
      </p>
    );
  }

  if (actividad === null) {
    return (
      <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <Link
          href="/student/actividades"
          className="mt-4 inline-block text-sm font-medium text-neutral-700 underline hover:text-neutral-900"
        >
          Volver a mis actividades
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {actividad.titulo}
          </h2>
          {actividad.descripcion !== null && (
            <p className="mt-1 text-sm text-neutral-600">
              {actividad.descripcion}
            </p>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            {actividad.recompensaMonedas} monedas al completar ·{" "}
            {actividad.preguntas.length} pregunta
            {actividad.preguntas.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/student/actividades"
          className="text-sm text-neutral-600 hover:text-neutral-900"
        >
          Mis actividades
        </Link>
      </div>

      {entrega !== null ? (
        <section aria-live="polite" className="mt-6">
          <div className="rounded-md border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-800">
              {MENSAJE_ENVIADO}
            </p>
            <p className="mt-1 text-xs text-green-700">{MENSAJE_SIN_REINTENTO}</p>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            Enviado el{" "}
            {entrega.enviadaEn !== null
              ? new Date(entrega.enviadaEn).toLocaleString("es-CO")
              : "—"}
            . El resultado se mostrará cuando esté calificada.
          </p>

          <div className="mt-4">
            <Link
              href="/student/actividades"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
            >
              Volver a mis actividades
            </Link>
          </div>
        </section>
      ) : (
        <form onSubmit={manejarEnvio} noValidate className="mt-6 space-y-4">
          <div className="space-y-4">
            {actividad.preguntas.map((pregunta) => (
              <PreguntaCuestionario
                key={pregunta.position}
                pregunta={pregunta}
                valor={respuestas[pregunta.position]}
                onChange={(valor) => responder(pregunta.position, valor)}
                deshabilitado={enviando}
              />
            ))}
          </div>

          {errorEnvio !== null && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {errorEnvio}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={enviando}
              aria-busy={enviando}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enviando ? "Enviando…" : "Enviar respuestas"}
            </button>
            <span className="text-xs text-neutral-500">
              Solo puedes enviar una vez.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
