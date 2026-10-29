/**
 * Vista de revisión y calificación de una entrega del profesor
 * (`/teacher/clases/[id]/actividades/[actividadId]/entregas/[entregaId]`)
 * — T5.9.2 (PRO-400).
 *
 * Detalle de la entrega con las respuestas del estudiante y su veredicto
 * (única vista que expone `answers` a alguien distinto del estudiante
 * dueño — H3.5 solo la da al dueño de la actividad), más el formulario de
 * puntuación + feedback para dejarla `graded` o `rejected` (CA 2 de H5.9).
 *
 * Decisión de diseño aprobada (CA 3): el formulario existe **solo** cuando
 * `estado === "submitted"`; en `graded`/`rejected` la vista es de solo
 * lectura, sin botones de edición — el backend prohíbe recalificar (409,
 * `docs/flujo_entregas.md` §10) y la UI jamás recalcula monedas (el
 * trigger `fn_award_coins` las escribe, AGENTS.md §6). Si aun así llega un
 * `409` (reenvío o carrera), se muestra `ApiError.message` del backend y la
 * vista se recarga con la entrega intacta.
 *
 * Contrato con el backend (H3.5, vía `features/teacher/api/`):
 * - `obtenerEntrega` → `GET /activities/:id/submissions/:entregaId`
 *   (`EntregaDetalleProfesorDto` plano); `404` → `null`.
 * - `obtenerActividad` → `GET /activities/:id` para el **total** de la
 *   actividad (suma de `preguntas[].score`): no hay endpoint de total y el
 *   rango del puntaje se muestra como "0 a {total}" (spec §Alcance).
 * - `calificarEntrega` → `POST …/submissions/:entregaId/calificar`
 *   (`200`) con `{ decision, puntaje?, feedback? }`. Errores →
 *   `ApiError.message` en español (`role="alert"`).
 *
 * Estados cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **error** con reintento (`EstadoError`), `404` → "No se encontró la
 * entrega solicitada." y **vacío** en la lista de respuestas.
 */

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
  mensajeDeErrorApi,
  useToast,
} from "@/components/ui";
import { PanelLateral } from "@/components/features/panel-lateral";
import { obtenerActividad } from "@/features/teacher/api/actividades";
import {
  calificarEntrega,
  obtenerEntrega,
} from "@/features/teacher/api/entregas";
import { BadgeEstadoEntrega } from "@/features/teacher/componentes/badge-estado-entrega";
import type {
  DatosCalificacion,
  DecisionCalificacion,
  EntregaDetalle,
  RespuestaCalificada,
} from "@/features/teacher/contrato/entregas";
import { ApiError } from "@/lib/api-client";

/** Mensaje cuando la entrega no existe (o no es visible para el docente). */
const MENSAJE_NO_ENCONTRADA = "No se encontró la entrega solicitada.";

/** Mensaje cuando la actividad dueña no se puede cargar (sin total). */
const MENSAJE_ACTIVIDAD_NO_ENCONTRADA =
  "No se encontró la actividad solicitada.";

/** Límite real de `submissions.feedback` (TEXT con MaxLength 2000 en H3.5). */
const MAX_FEEDBACK = 2000;

/** Toast de éxito al aprobar (`graded`). */
const MENSAJE_EXITO_CALIFICADA =
  "Entrega calificada: el estudiante ya puede ver el puntaje y tu retroalimentación.";

/** Toast de éxito al rechazar (`rejected`). */
const MENSAJE_EXITO_RECHAZADA =
  "Entrega rechazada: el estudiante verá tu retroalimentación.";

/** Título del estado vacío de respuestas. */
const TITULO_VACIO_RESPUESTAS = "Esta entrega no tiene respuestas registradas";

/** Descripción del estado vacío de respuestas. */
const DESCRIPCION_VACIO_RESPUESTAS =
  "Cuando el estudiante responda las preguntas de la actividad, aparecerán aquí con su veredicto.";

/**
 * Formatea una fecha ISO en formato local legible (mismo criterio que la
 * cola de entregas).
 *
 * @param iso Fecha ISO del backend; `null` cuando el evento no ocurrió.
 * @returns Fecha local, p. ej. "18/10/2026, 12:30", o "—" si no hay fecha.
 */
function formatearFecha(iso: string | null): string {
  if (iso === null) {
    return "—";
  }

  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Extrae el nombre visible de una referencia de archivo del JSONB.
 *
 * `path` es la ruta interna del servidor (`7/1/uuid.pdf`), no el nombre
 * original: se muestra su último segmento. La descarga está fuera de
 * alcance de esta tarea (spec §No incluye).
 *
 * @param ruta Ruta interna del archivo.
 * @returns Último segmento de la ruta.
 */
function nombreDeRuta(ruta: string): string {
  return ruta.split("/").pop() ?? ruta;
}

/**
 * Etiqueta y color del veredicto de una respuesta según `is_correct`.
 *
 * `null`/ausente = pregunta pendiente de calificación manual
 * (`minigame`/`file`, o JSONB aún sin evaluar) — misma semántica que la
 * vista del estudiante (T5.8.3).
 *
 * @param respuesta Respuesta calificada del JSONB `answers`.
 * @returns Texto visible en español y clases Tailwind del texto.
 */
function veredictoDe(respuesta: RespuestaCalificada): {
  texto: string;
  clases: string;
} {
  if (respuesta.is_correct === true) {
    return { texto: "Correcta", clases: "text-green-700" };
  }

  if (respuesta.is_correct === false) {
    return { texto: "Incorrecta", clases: "text-red-700" };
  }

  return {
    texto: "Pendiente de calificación",
    clases: "text-amber-700",
  };
}

/**
 * Valida el puntaje del formulario **antes** de invocar la fachada (plan
 * §3: el error de validación se ve sin llegar al backend).
 *
 * El tope superior es el total real de la actividad (`preguntas[].score`
 * sumados): `CalificacionSchema` no lo conoce y solo replica el rango
 * físico del `NUMERIC(6,2)` (0..9999.99); el backend re-valida el total
 * como red final (422).
 *
 * @param valor Texto crudo del campo de puntaje.
 * @param total Total de puntos de la actividad.
 * @returns Mensaje de error en español, o `null` si el puntaje es válido.
 */
function validarPuntaje(valor: string, total: number): string | null {
  const texto = valor.trim();

  if (texto === "") {
    return "Ingresa el puntaje para aprobar la entrega.";
  }

  const numero = Number(texto);

  if (!Number.isFinite(numero)) {
    return "El puntaje debe ser un número.";
  }

  if (numero < 0 || numero > total) {
    return `El puntaje debe estar entre 0 y ${total}.`;
  }

  if (Math.round(numero * 100) / 100 !== numero) {
    return "El puntaje admite hasta 2 decimales.";
  }

  return null;
}

/**
 * Vista de revisión de una entrega: cabecera, respuestas con veredicto y
 * formulario de calificación (solo en `submitted`).
 *
 * Componente cliente con carga inicial por `useEffect` (ids de la ruta) y
 * estado controlado a mano; en `graded`/`rejected` renderiza solo lectura.
 *
 * @returns Detalle de la entrega con su formulario o resumen de solo lectura.
 */
export default function DetalleEntregaPage() {
  const parametros = useParams<{
    id: string;
    actividadId: string;
    entregaId: string;
  }>();
  const claseId = parametros.id;
  const actividadId = parametros.actividadId;
  const entregaId = parametros.entregaId;

  const { mostrar } = useToast();

  const [entrega, setEntrega] = useState<EntregaDetalle | null>(null);
  /** Total de puntos de la actividad (suma de `preguntas[].score`). */
  const [total, setTotal] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  /** Mensaje de "no encontrada" (traducción del `404` a `null`). */
  const [noEncontrada, setNoEncontrada] = useState<string | null>(null);
  /** Mensaje de error de la carga (con reintento, H5.2). */
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  /** Contador para forzar una recarga desde un evento (reintento/409/éxito). */
  const [recarga, setRecarga] = useState(0);

  const [puntaje, setPuntaje] = useState("");
  const [feedback, setFeedback] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function cargar(): Promise<void> {
      try {
        const [encontrada, actividad] = await Promise.all([
          obtenerEntrega(actividadId, entregaId),
          obtenerActividad(actividadId),
        ]);

        if (!vigente) {
          return;
        }

        if (encontrada === null) {
          setEntrega(null);
          setTotal(null);
          setNoEncontrada(MENSAJE_NO_ENCONTRADA);
          return;
        }

        if (actividad === null) {
          setEntrega(null);
          setTotal(null);
          setNoEncontrada(MENSAJE_ACTIVIDAD_NO_ENCONTRADA);
          return;
        }

        setEntrega(encontrada);
        setTotal(
          actividad.preguntas.reduce((suma, pregunta) => suma + pregunta.score, 0),
        );
        setNoEncontrada(null);
        setErrorCarga(null);
      } catch (e) {
        if (vigente) {
          setEntrega(null);
          setTotal(null);
          setErrorCarga(mensajeDeErrorApi(e));
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
  }, [actividadId, entregaId, recarga]);

  /** Recarga la entrega (reintento, éxito de calificación o `409`). */
  const recargar = (): void => {
    setCargando(true);
    setRecarga((anterior) => anterior + 1);
  };

  /**
   * Envía la calificación al backend (compartido por Aprobar/Rechazar).
   *
   * - `graded` valida el puntaje contra 0..total antes de llamar a la
   *   fachada (el error se muestra sin llegar al backend);
   * - `rejected` **no** envía puntaje (el backend lo prohíbe);
   * - éxito → toast + recarga (la entrega queda `graded`/`rejected` y la
   *   vista pasa a solo lectura);
   * - error → `ApiError.message` en `role="alert"`; un `409` además lanza
   *   toast y recarga la entrega intacta (decisión aprobada de CA 3).
   *
   * @param decision Transición a aplicar (`graded` o `rejected`).
   */
  async function manejarCalificar(
    decision: DecisionCalificacion,
  ): Promise<void> {
    setErrorEnvio(null);

    let puntajeNumerico: number | undefined;

    if (decision === "graded") {
      if (total === null) {
        setErrorEnvio(MENSAJE_ACTIVIDAD_NO_ENCONTRADA);
        return;
      }

      const problema = validarPuntaje(puntaje, total);

      if (problema !== null) {
        setErrorEnvio(problema);
        return;
      }

      puntajeNumerico = Number(puntaje);
    }

    const datos: DatosCalificacion = { decision };

    if (puntajeNumerico !== undefined) {
      datos.puntaje = puntajeNumerico;
    }

    const textoFeedback = feedback.trim();

    if (textoFeedback !== "") {
      datos.feedback = textoFeedback;
    }

    setEnviando(true);

    try {
      await calificarEntrega(actividadId, entregaId, datos);

      mostrar(
        decision === "graded"
          ? MENSAJE_EXITO_CALIFICADA
          : MENSAJE_EXITO_RECHAZADA,
        "exito",
      );
      setPuntaje("");
      setFeedback("");
      recargar();
    } catch (e) {
      const mensaje = mensajeDeErrorApi(e);
      setErrorEnvio(mensaje);

      if (e instanceof ApiError && e.status === 409) {
        mostrar(mensaje, "error");
        recargar();
      }
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Aprueba la entrega (`graded`) desde el envío del formulario.
   *
   * @param evento Evento de envío del formulario.
   */
  async function manejarAprobar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    await manejarCalificar("graded");
  }

  const urlCola = `/teacher/clases/${claseId}/actividades/${actividadId}/entregas`;

  if (cargando) {
    return <EstadoCarga mensaje="Cargando entrega…" />;
  }

  if (entrega === null) {
    return (
      <div className="space-y-4">
        {errorCarga !== null ? (
          <EstadoError mensaje={errorCarga} alReintentar={recargar} />
        ) : (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {noEncontrada ?? MENSAJE_ERROR_GENERICO}
          </p>
        )}
        <Link
          href={urlCola}
          className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Volver a la cola
        </Link>
      </div>
    );
  }

  const formularioActivo = entrega.estado === "submitted" && total !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">
              Revisión de la entrega
            </h1>
            <BadgeEstadoEntrega estado={entrega.estado} />
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Respuestas del estudiante y calificación de la entrega.
          </p>
        </div>
        <Link
          href={urlCola}
          className="self-start rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volver a la cola
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {errorEnvio !== null && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {errorEnvio}
            </p>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-base font-semibold text-slate-900">
              Respuestas del estudiante
            </h2>

            {entrega.respuestas.length === 0 ? (
              <div className="mt-3">
                <EstadoVacio
                  titulo={TITULO_VACIO_RESPUESTAS}
                  descripcion={DESCRIPCION_VACIO_RESPUESTAS}
                />
              </div>
            ) : (
              <ol className="mt-3 space-y-3">
                {entrega.respuestas.map((respuesta, indice) => {
                  const veredicto = veredictoDe(respuesta);
                  const puntos =
                    respuesta.score === null || respuesta.score === undefined
                      ? null
                      : respuesta.score;

                  return (
                    <li
                      key={`${respuesta.question_position}-${indice}`}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        Pregunta {respuesta.question_position}
                      </p>

                      {respuesta.option !== undefined && (
                        <p className="mt-1 text-sm text-slate-700">
                          Opción elegida: {respuesta.option}
                        </p>
                      )}

                      {respuesta.text !== undefined && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                          Respuesta: {respuesta.text}
                        </p>
                      )}

                      {respuesta.files !== undefined &&
                        respuesta.files.length > 0 && (
                          <div className="mt-1">
                            <p className="text-sm text-slate-700">
                              Archivos adjuntos ({respuesta.files.length}):
                            </p>
                            <ul className="ml-4 list-disc text-sm text-slate-600">
                              {respuesta.files.map((archivo) => (
                                <li key={archivo.path}>
                                  {nombreDeRuta(archivo.path)} ({archivo.mime},{" "}
                                  {archivo.bytes} bytes)
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      <p className="mt-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Veredicto:
                        </span>{" "}
                        <span className={veredicto.clases}>
                          {veredicto.texto}
                        </span>
                        {puntos !== null && (
                          <span className="text-slate-600">
                            {" "}
                            · {puntos} puntos
                          </span>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {formularioActivo ? (
            <form
              onSubmit={manejarAprobar}
              noValidate
              className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
            >
              <h2 className="text-base font-semibold text-slate-900">
                Calificar entrega
              </h2>

              <div className="max-w-[14rem]">
                <label
                  htmlFor="puntaje-entrega"
                  className="block text-sm font-medium text-slate-700"
                >
                  Puntaje
                </label>
                <input
                  id="puntaje-entrega"
                  type="number"
                  min={0}
                  max={total}
                  step={0.01}
                  value={puntaje}
                  onChange={(e) => setPuntaje(e.target.value)}
                  disabled={enviando}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <p className="mt-1 text-xs text-slate-500">0 a {total}</p>
              </div>

              <div>
                <label
                  htmlFor="feedback-entrega"
                  className="block text-sm font-medium text-slate-700"
                >
                  Feedback <span className="text-slate-400">(opcional)</span>
                </label>
                <textarea
                  id="feedback-entrega"
                  rows={3}
                  maxLength={MAX_FEEDBACK}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={enviando}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {feedback.length} / {MAX_FEEDBACK}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={enviando}
                  aria-busy={enviando}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {enviando ? "Enviando…" : "Aprobar (graded)"}
                </button>
                <button
                  type="button"
                  onClick={() => void manejarCalificar("rejected")}
                  disabled={enviando}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Rechazar (rejected)
                </button>
              </div>
            </form>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Esta entrega ya no está pendiente de calificación: la vista es de
              solo lectura y no se puede volver a calificar.
            </p>
          )}
        </div>

        <PanelLateral titulo="Resumen de la entrega">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Estudiante
            </p>
            <p className="text-sm font-medium text-slate-900">
              {entrega.estudiante.nombre} {entrega.estudiante.apellido}
            </p>
            <p className="text-xs text-slate-500">
              {entrega.estudiante.usuario}
            </p>
          </div>

          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Fecha de envío
              </dt>
              <dd className="text-sm text-slate-900">
                {formatearFecha(entrega.entregadoEn)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Fecha de calificación
              </dt>
              <dd className="text-sm text-slate-900">
                {formatearFecha(entrega.calificadoEn)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Puntaje
              </dt>
              <dd className="text-sm text-slate-900">
                {entrega.puntaje === null ? "—" : entrega.puntaje}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Monedas otorgadas
              </dt>
              <dd className="text-sm text-slate-900">
                {entrega.monedasOtorgadas}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Retroalimentación
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                {entrega.feedback ?? "—"}
              </dd>
            </div>
          </dl>
        </PanelLateral>
      </div>
    </div>
  );
}
