/**
 * Gráfica de monedas ganadas por mes (T5.x "Mi Progreso").
 *
 * Reemplaza las barras de ejemplo que estaban fijas en el código: ahora los
 * valores salen de los movimientos reales de la billetera (`earning`), que el
 * backend ya devuelve con su fecha. La lógica de agregación vive aquí, fuera
 * del componente, para poder probarla sin DOM.
 */

import type { MovimientoBilletera } from "../contrato/billetera";

/** Una barra mensual ya lista para pintar. */
export interface BarraProgreso {
  /** Etiqueta corta del mes ("Ene", "Feb"…). */
  mes: string;
  /** Monedas ganadas ese mes. */
  valor: number;
  /** El mes más reciente se resalta. */
  activa: boolean;
}

const MESES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

/**
 * Agrupa las monedas ganadas (`earning`) en los últimos `meses` meses
 * naturales, del más antiguo al actual.
 *
 * @param movimientos Movimientos del historial (cualquier orden).
 * @param meses Cantidad de meses a mostrar (por defecto 5).
 * @param ahora Fecha de referencia (inyectable en pruebas).
 * @returns Una barra por mes, con ceros en los meses sin ganancias.
 */
export function resumenMensualGanancias(
  movimientos: MovimientoBilletera[],
  meses = 5,
  ahora = new Date(),
): BarraProgreso[] {
  const barras: BarraProgreso[] = [];

  for (let i = meses - 1; i >= 0; i -= 1) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    barras.push({
      mes: MESES[fecha.getMonth()] ?? "",
      valor: 0,
      activa: i === 0,
    });
  }

  const indicePorClave = new Map<string, number>();
  for (let i = 0; i < meses; i += 1) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1 - i), 1);
    indicePorClave.set(`${fecha.getFullYear()}-${fecha.getMonth()}`, i);
  }

  for (const movimiento of movimientos) {
    if (movimiento.tipo !== "earning") continue;
    const fecha = new Date(movimiento.creadoEn);
    if (Number.isNaN(fecha.getTime())) continue;
    const indice = indicePorClave.get(`${fecha.getFullYear()}-${fecha.getMonth()}`);
    if (indice === undefined) continue;
    const barra = barras[indice];
    if (barra !== undefined) barra.valor += movimiento.cantidad;
  }

  return barras;
}

/**
 * Variación porcentual del último mes frente al anterior.
 *
 * @param barras Resultado de `resumenMensualGanancias`.
 * @returns El porcentaje redondeado, o `null` si no hay base de comparación.
 */
export function tendenciaMensual(barras: BarraProgreso[]): number | null {
  if (barras.length < 2) return null;
  const anterior = barras[barras.length - 2]?.valor ?? 0;
  const actual = barras[barras.length - 1]?.valor ?? 0;
  if (anterior === 0) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

interface GraficaProgresoProps {
  barras: BarraProgreso[];
  /** Versión compacta para el dashboard (sin etiquetas de valor). */
  compacta?: boolean;
}

/**
 * Barras de monedas por mes. La altura de cada barra se calcula contra el
 * máximo del período (no contra un valor fijo), y el área de la barra tiene
 * altura definida para que el `%` se resuelva.
 */
export function GraficaProgreso({ barras, compacta = false }: GraficaProgresoProps) {
  const maximo = Math.max(...barras.map((barra) => barra.valor), 1);

  return (
    <div
      className={`flex items-end justify-between gap-2 ${
        compacta ? "h-40" : "mt-6 h-56 rounded-xl bg-slate-50 p-4"
      }`}
    >
      {barras.map((barra) => (
        <div
          key={barra.mes}
          className='flex h-full flex-1 flex-col items-center gap-2'
        >
          {!compacta && (
            <div className='text-xs font-semibold text-slate-700'>{barra.valor}</div>
          )}
          <div className='flex w-full flex-1 items-end'>
            <div
              className={`w-full rounded-t-lg ${
                compacta ? "max-w-[2rem]" : "max-w-[3rem]"
              } ${barra.activa ? "bg-indigo-600" : "bg-indigo-200"}`}
              style={{
                height: barra.valor === 0 ? "2px" : `${(barra.valor / maximo) * 100}%`,
                marginInline: "auto",
              }}
              title={`${barra.mes}: ${barra.valor} EduCoins`}
            />
          </div>
          <span className='text-xs font-medium text-slate-500'>{barra.mes}</span>
        </div>
      ))}
    </div>
  );
}
