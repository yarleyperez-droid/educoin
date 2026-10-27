/**
 * Mockup decorativo de navegador para el hero de la landing.
 *
 * Ventana de navegador dibujada solo con CSS (sin imágenes externas ni
 * dependencias) que evoca el aula de EduCoins: código de unión de la clase,
 * ledger con acreditaciones y tienda de aula. Es decorativa: va marcada con
 * `aria-hidden="true"` para que los lectores de pantalla no la anuncien.
 */

/** Fila de metadatos del mockup: título grande + nota pequeña. */
interface FilaLedger {
  concepto: string;
  monedas: string;
}

/** Movimientos ficticios del ledger que se muestran en el mockup. */
const FILAS_LEDGER: FilaLedger[] = [
  { concepto: "Derivada de f(x) = 3x²", monedas: "+80" },
  { concepto: "El cogito de Descartes", monedas: "+60" },
];

/**
 * Ventana de navegador decorativa con el aula de EduCoins.
 *
 * @returns Bloque visual `aria-hidden` con el mockup del producto.
 */
export function MockupNavegador() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-md lg:max-w-none"
    >
      {/* Resplandor de fondo (gradiente sutil del mockup) */}
      <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-br from-gold-bg via-accent-bg to-success-bg opacity-70 blur-2xl" />

      {/* Ventana */}
      <div className="relative overflow-hidden rounded-panel border border-edge bg-surface shadow-suave">
        {/* Barra del navegador */}
        <div className="flex items-center gap-2 border-b border-edge bg-page/70 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <div className="ml-2 flex-1 truncate rounded-card border border-edge bg-surface px-3 py-1 text-xs text-muted">
            app.educoins/aula
          </div>
        </div>

        {/* Contenido del aula */}
        <div className="space-y-3 p-4">
          {/* Código de unión */}
          <div className="flex items-center justify-between rounded-card border border-edge bg-page/70 px-3 py-2.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Código de la clase
              </p>
              <p className="font-mono text-sm font-semibold text-ink">MAT101</p>
            </div>
            <span className="rounded-full border border-gold-border bg-gold-bg px-2.5 py-1 text-[10px] font-semibold text-gold-ink">
              Activo
            </span>
          </div>

          {/* Ledger del aula */}
          <div className="rounded-card border border-edge bg-surface p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Ledger del aula
            </p>
            <ul className="mt-2 space-y-1.5">
              {FILAS_LEDGER.map((fila) => (
                <li
                  key={fila.concepto}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-ink2">{fila.concepto}</span>
                  <span className="shrink-0 font-semibold text-success">
                    {fila.monedas}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tienda de aula */}
          <div className="flex items-center justify-between rounded-card border border-gold-border bg-gold-bg px-3 py-2.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gold-ink">
                Tienda de aula
              </p>
              <p className="text-xs text-ink2">200 monedas para canjear</p>
            </div>
            <span className="rounded-card bg-gold px-3 py-1.5 text-xs font-semibold text-white">
              Canjear
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
