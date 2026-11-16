/**
 * Línea de tiempo de trazabilidad de un canje (H10.4 / T10.4.2).
 *
 * Componente presentacional (sin estado) que muestra el recorrido
 * **solicitado → resuelto → entregado** de un canje, con la fecha de cada
 * paso en formato local y el nombre visible del resolvente. Vive junto al
 * badge compartido (`badge-estado-canje`) porque lo usan las DOS vistas
 * del canje revisable: "Mis canjes" del estudiante (H7.3/H10.3) y la cola
 * del profesor (H7.4/H10.2) — una sola fuente del mapeo (AGENTS.md §8).
 *
 * La lógica de etapas está exportada como función **pura**
 * (`etapasDeCanje`) para probarla sin DOM, mismo criterio que las
 * funciones de `badge-estado-canje`.
 *
 * Nota de contrato (§3.2 fila 2 de `docs/propuesta_canje_revisable.md`):
 * la transición `approved → delivered` NO escribe fecha (la auditoría
 * `resolved_at` quedó al aprobar), así que el paso "Entregado" se muestra
 * completado **sin fecha registrada** para un canje `delivered`; lo mismo
 * para los legados `completed`/`reversed` del MVP, que no tienen fechas
 * de resolución propias.
 */

import type { CanjeListado } from "../contrato/canje";

/** Estado visual de una etapa del recorrido. */
export type EstadoEtapa = "completada" | "pendiente" | "no-aplica";

/** Etapa de la línea de tiempo de un canje. */
export interface EtapaLinea {
  /** Etiqueta del paso en español. */
  etiqueta: string;
  /** Si el paso ya ocurrió, aún no ocurre o no aplica al canje. */
  estado: EstadoEtapa;
  /** Fecha ISO del paso; `null` si no ocurrió o la BD no la registra. */
  fecha: string | null;
  /** Texto complementario (resolvente, motivo de "no aplica", legado). */
  detalle: string | null;
}

/**
 * Construye las etapas del recorrido de un canje (capa pura).
 *
 * @param canje Fila del listado (cola del profesor o "Mis canjes").
 * @returns Las tres etapas: Solicitado → Resuelto → Entregado.
 */
export function etapasDeCanje(canje: CanjeListado): EtapaLinea[] {
  const { estado } = canje;

  const solicitado: EtapaLinea = {
    etiqueta: "Solicitado",
    estado: "completada",
    fecha: canje.solicitadoEn,
    detalle: null,
  };

  const resuelto: EtapaLinea = (() => {
    switch (estado) {
      case "pending":
        return {
          etiqueta: "Resuelto",
          estado: "pendiente",
          fecha: null,
          detalle: null,
        };
      case "completed":
        return {
          etiqueta: "Resuelto",
          estado: "completada",
          fecha: null,
          detalle: "Flujo instantáneo (legado)",
        };
      case "reversed":
        return {
          etiqueta: "Resuelto",
          estado: "completada",
          fecha: null,
          detalle: "Anulado por el estudiante (legado)",
        };
      default:
        // approved | delivered | rejected: la BD guardó resolved_*.
        return {
          etiqueta: "Resuelto",
          estado: "completada",
          fecha: canje.resueltoEn,
          detalle:
            canje.resueltoPor === null ? "Resuelto por el sistema" : canje.resueltoPor,
        };
    }
  })();

  const entregado: EtapaLinea = (() => {
    switch (estado) {
      case "delivered":
        // §3.2 fila 2: la entrega no escribe fecha; la auditoría quedó al aprobar.
        return {
          etiqueta: "Entregado",
          estado: "completada",
          fecha: null,
          detalle: "Confirmado por el profesor",
        };
      case "completed":
        // Legado del MVP: la entrega fue inmediata a la solicitud.
        return {
          etiqueta: "Entregado",
          estado: "completada",
          fecha: canje.solicitadoEn,
          detalle: "Entrega inmediata (legado)",
        };
      case "rejected":
        return {
          etiqueta: "Entregado",
          estado: "no-aplica",
          fecha: null,
          detalle: "Rechazado, monedas devueltas",
        };
      case "reversed":
        return {
          etiqueta: "Entregado",
          estado: "no-aplica",
          fecha: null,
          detalle: "Anulado, monedas devueltas",
        };
      default:
        // pending | approved: la entrega aún no ocurre.
        return {
          etiqueta: "Entregado",
          estado: "pendiente",
          fecha: null,
          detalle: null,
        };
    }
  })();

  return [solicitado, resuelto, entregado];
}

/**
 * Texto de una etapa: fecha local si la hay, o el estado vacío legible
 * ("Pendiente", "No aplica", "Sin fecha registrada").
 *
 * @param etapa Etapa a describir.
 * @returns Texto visible de la fecha/estado vacío.
 */
export function textoDeEtapa(etapa: EtapaLinea): string {
  switch (etapa.estado) {
    case "pendiente":
      return "Pendiente";
    case "no-aplica":
      return "No aplica";
    case "completada":
      return etapa.fecha === null
        ? "Sin fecha registrada"
        : formatearFecha(etapa.fecha);
  }
}

/**
 * Formatea una fecha ISO en formato local legible (misma convención que
 * "Mis canjes" y la cola del profesor).
 *
 * @param iso Fecha ISO del backend.
 * @returns Fecha local, p. ej. "18/10/2026, 12:30".
 */
function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Presentación visual (color del punto) por estado de etapa. */
const PUNTO: Readonly<Record<EstadoEtapa, string>> = {
  completada: "border-emerald-500 bg-emerald-500",
  pendiente: "border-slate-300 bg-white",
  "no-aplica": "border-slate-300 bg-slate-200",
};

/** Props de la línea de tiempo. */
export interface LineaTiempoCanjeProps {
  /** Canje (fila del listado) cuyo recorrido se muestra. */
  canje: CanjeListado;
}

/**
 * Línea de tiempo compacta del canje, para vivir dentro de una celda de
 * tabla ("Trazabilidad") en ambas vistas.
 *
 * @param props El canje a trazar.
 * @returns Lista ordenada accesible con los tres pasos del recorrido.
 */
export function LineaTiempoCanje({ canje }: LineaTiempoCanjeProps) {
  const etapas = etapasDeCanje(canje);

  return (
    <ol
      aria-label={`Recorrido del canje ${canje.nombreItem}`}
      className="min-w-[9rem] space-y-2"
    >
      {etapas.map((etapa) => {
        const descripcion =
          etapa.detalle === null ? null : (
            <span className="block text-[0.7rem] leading-tight text-slate-500">
              {etapa.detalle}
            </span>
          );

        return (
          <li key={etapa.etiqueta} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={`mt-1 block h-2.5 w-2.5 shrink-0 rounded-full border-2 ${PUNTO[etapa.estado]}`}
            />
            <span className="leading-tight">
              <span className="block text-xs font-medium text-slate-700">
                {etapa.etiqueta}
              </span>
              <span
                className={`block text-[0.7rem] leading-tight ${
                  etapa.estado === "completada" ? "text-slate-600" : "text-slate-400"
                }`}
              >
                {textoDeEtapa(etapa)}
              </span>
              {descripcion}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
