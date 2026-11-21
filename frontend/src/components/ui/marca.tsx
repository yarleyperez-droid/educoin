/**
 * Identidad visual de EduCoin («La Ficha de Ascenso»).
 *
 * Los vectores provienen de los maestros de la identidad de marca
 * (`brand-identity/educoin/brand/masters/educoin-horizontal-color.svg`):
 * disco Índigo Mérito `#4F46E5` con la E en espacio negativo, punto de nota
 * en Oro Educoin `#F59E0B` y wordmark EDUCOIN en Pizarra Nocturna `#0F172A`.
 *
 * Reglas de la guía respetadas aquí (brand-guidelines.md §3):
 * - No invertir los colores del símbolo ni recolorear el punto dorado.
 * - Tamaño mínimo del lockup: 110 px de ancho (≈ 30 px de alto).
 * - Sobre fondos oscuros usar la variante `*-on-dark` (no incluida: hoy la
 *   marca solo se muestra sobre superficies claras).
 *
 * @packageDocumentation
 */

/** Props del lockup horizontal de marca. */
export type PropsLockupEducoin = {
  /** Clases de tamaño/utilidad (p. ej. `h-8 w-auto`). */
  className?: string;
};

/**
 * Lockup horizontal de EduCoin (símbolo + wordmark) a color.
 *
 * Marca principal para cabeceras, sidebars y pantallas de acceso. El SVG es
 * decorativo para lectores de pantalla cuando ya existe un texto "EduCoins"
 * adyacente; si es el único rótulo visible, pásale `rotulo`.
 *
 * @param props Ver {@link PropsLockupEducoin}.
 * @returns SVG inline del lockup (sin dependencias ni fetch).
 */
export function LockupEducoin({ className }: PropsLockupEducoin) {
  return (
    <svg
      viewBox='0 0 920 256'
      className={className}
      role='img'
      aria-label='EduCoins'
      focusable='false'
    >
      {/* Símbolo: disco Índigo Mérito con la E en espacio negativo. */}
      <path
        fill='#4F46E5'
        fillRule='evenodd'
        d='M 128 16 A 112 112 0 1 1 127.9 16 Z M 68 68 H 132 A 16 16 0 0 1 132 100 H 68 A 16 16 0 0 1 68 68 Z M 68 112 H 156 A 16 16 0 0 1 156 144 H 68 A 16 16 0 0 1 68 112 Z M 68 156 H 184 A 16 16 0 0 1 184 188 H 68 A 16 16 0 0 1 68 156 Z'
      />
      {/* Punto de nota extra ganado (Oro Educoin). */}
      <circle cx='180' cy='84' r='20' fill='#F59E0B' />
      {/* Wordmark EDUCOIN (paths propios, no tipografía de sistema). */}
      <g fill='#0F172A'>
        <path d='M276 76 H340 V100 H302 V116 H334 V140 H302 V156 H340 V180 H276 Z' />
        <path
          fillRule='evenodd'
          d='M356 76 H388 A52 52 0 0 1 388 180 H356 Z M382 100 V156 H388 A28 28 0 0 0 388 100 Z'
        />
        <path d='M454 76 H480 V140 A14 14 0 0 0 508 140 V76 H534 V140 A40 40 0 0 1 454 140 Z' />
        <path d='M626 108 A30 30 0 1 0 626 148 L646 164 A54 54 0 1 1 646 92 Z' />
        <path
          fillRule='evenodd'
          d='M712 74 A54 54 0 1 1 711.9 74 Z M712 100 A28 28 0 1 0 712.1 100 Z'
        />
        <rect x='784' y='104' width='26' height='76' rx='4' />
        <circle cx='797' cy='80' r='14' fill='#F59E0B' />
        <path d='M828 76 H852 L884 131.4 V76 H908 V180 H884 L852 124.6 V180 H828 Z' />
      </g>
    </svg>
  );
}
