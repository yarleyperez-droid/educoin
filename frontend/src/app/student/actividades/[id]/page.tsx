/**
 * Cuestionario del estudiante (`/student/actividades/[id]`)
 * — T5.8.1 (PRO-394), T5.8.2 (PRO-395), T5.8.3 (PRO-396) y T5.8.4
 * (PRO-397).
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
 * - **Estados y resultado (T5.8.3):** badge de estado en todo momento;
 *   tras enviar, la auto-calificación de H3.4 es **inmediata** y la vista
 *   muestra puntaje por pregunta, monedas y el **feedback del profesor** —
 *   siempre desde `entrega.resultado`, nunca desde los secretos del JSONB.
 *
 * Contrato con el backend: datos por `features/estudiante/api/*` (API real
 * de H3.3/H3.4 desde T5.8.4). La vista solo lee `error.message` de
 * `ApiError`.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import "katex/dist/katex.min.css";

import { PanelLateral } from "@/components/features/panel-lateral";
import { EstadoCarga, EstadoError } from "@/components/ui";
import { obtenerParaEstudiante } from "@/features/estudiante/api/actividades-estudiante";
import {
  consultarAutoCalificacion,
  enviarRespuestas,
  obtenerEntrega,
  type Entrega,
} from "@/features/estudiante/api/entregas";
import { PreguntaCuestionario } from "@/features/estudiante/componentes/pregunta-cuestionario";
import type {
  ActividadEstudiante,
  PreguntaEstudiante,
} from "@/features/estudiante/contrato/cuestionario";
import {
  etiquetaEstadoEntrega,
  type Respuesta,
} from "@/features/estudiante/contrato/entregas";
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

/** Estado vacío del feedback (cuando el profesor aún no comenta). */
const MENSAJE_SIN_FEEDBACK = "Aún sin retroalimentación.";

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

  // Relectura del resultado (T5.8.4): la auto-calificación de H3.4 es
  // inmediata en el POST, pero una entrega puede llegar "submitted"
  // (pendiente del profesor). La consulta es idempotente; si el estado
  // sigue igual, adoptar el objeto re-dispararía este efecto sin fin, así
  // que solo se actualiza cuando de verdad cambió.
  useEffect(() => {
    if (!entrega || entrega.estado !== "submitted") {
      return;
    }

    let vigente = true;

    const temporizador = setTimeout(() => {
      consultarAutoCalificacion(actividadId)
        .then((actualizada) => {
          if (vigente && actualizada.estado !== "submitted") {
            setEntrega(actualizada);
          }
        })
        .catch(() => {
          // Sin conexión al servidor: se mantiene el estado enviado; la
          // vista vuelve a consultar al montar.
        });
    }, 1500);

    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [entrega, actividadId]);

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

  /** Puntos totales posibles de la actividad (para el marcador). */
  const totalPuntos =
    actividad?.preguntas.reduce((total, pregunta) => total + pregunta.score, 0) ?? 0;

  if (cargando) {
    return <EstadoCarga mensaje="Cargando la actividad…" />;
  }

  if (actividad === null) {
    return (
      <div className="space-y-4">
        <EstadoError mensaje={error ?? MENSAJE_ERROR_GENERICO} />
        <Link
          href="/student/actividades"
          className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Volver a mis actividades
        </Link>
      </div>
    );
  }

  const numeroPreguntas = actividad.preguntas.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Panel de Actividades
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
            {actividad.titulo}
          </h1>
          {entrega !== null && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {etiquetaEstadoEntrega(entrega.estado)}
            </span>
          )}
        </div>
        {actividad.descripcion !== null && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {actividad.descripcion}
          </p>
        )}
        <Link
          href="/student/actividades"
          className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Mis actividades
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {entrega !== null ? (
              <section aria-live="polite" className="space-y-4">
                <div className="rounded-lg border border-green-200 bg-green-100 p-4">
                  <p className="text-sm font-semibold text-green-700">
                    {MENSAJE_ENVIADO}
                  </p>
                  <p className="mt-1 text-xs text-green-700">
                    {MENSAJE_SIN_REINTENTO}
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  Enviado el{" "}
                  {entrega.enviadaEn !== null
                    ? new Date(entrega.enviadaEn).toLocaleString("es-CO")
                    : "—"}
                </p>

                {entrega.estado === "submitted" && (
                  <p
                    role="status"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                  >
                    Esperando el resultado de la auto-calificación…
                  </p>
                )}

                {entrega.estado === "graded" && (
                  <>
                    <section
                      aria-labelledby="titulo-resultado"
                      className="rounded-lg border border-slate-200 p-4"
                    >
                      <h3
                        id="titulo-resultado"
                        className="text-sm font-semibold text-slate-900"
                      >
                        Resultado
                      </h3>
                      <p className="mt-1 text-sm text-slate-700">
                        {entrega.puntaje} / {totalPuntos} puntos ·{" "}
                        {entrega.monedasOtorgadas} monedas
                      </p>

                      <ul className="mt-3 space-y-1">
                        {(entrega.resultado ?? []).map((item) => {
                          const pregunta = actividad.preguntas.find(
                            (p) => p.position === item.question_position,
                          );

                          return (
                            <li
                              key={item.question_position}
                              className="flex items-start gap-2 text-sm text-slate-700"
                            >
                              <span
                                aria-hidden="true"
                                className={
                                  item.correcta
                                    ? "font-semibold text-green-700"
                                    : "font-semibold text-red-700"
                                }
                              >
                                {item.correcta ? "✓" : "✗"}
                              </span>
                              <span>
                                Pregunta {item.question_position}:{" "}
                                {pregunta?.prompt ?? ""} — {item.puntos} puntos
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      <p className="mt-2 text-xs text-slate-500">
                        {MENSAJE_SIN_REINTENTO}
                      </p>
                    </section>

                    <section
                      aria-labelledby="titulo-feedback"
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                    >
                      <h3
                        id="titulo-feedback"
                        className="text-sm font-semibold text-slate-900"
                      >
                        Feedback del profesor
                      </h3>
                      <p className="mt-1 text-sm text-slate-700">
                        {entrega.retroalimentacion ?? MENSAJE_SIN_FEEDBACK}
                      </p>
                    </section>
                  </>
                )}

                {entrega.estado === "rejected" && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                  >
                    Tu entrega fue rechazada por tu profesor. Revisa el feedback
                    y consulta con él.
                  </p>
                )}

                <div>
                  <Link
                    href="/student/actividades"
                    className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    Volver a mis actividades
                  </Link>
                </div>
              </section>
            ) : (
              <form onSubmit={manejarEnvio} noValidate className="space-y-4">
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
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                  >
                    {errorEnvio}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={enviando}
                    aria-busy={enviando}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {enviando ? "Enviando…" : "Enviar respuestas"}
                  </button>
                  <span className="text-xs text-slate-500">
                    Solo puedes enviar una vez.
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>

        <PanelLateral titulo="Sobre esta actividad">
          <p>{actividad.recompensaMonedas} monedas al completar</p>
          <p>
            {numeroPreguntas} pregunta{numeroPreguntas === 1 ? "" : "s"}
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Un único intento por actividad.</li>
            <li>Debes responder todas las preguntas antes de enviar.</li>
          </ul>
        </PanelLateral>
      </div>
    </div>
  );
}
