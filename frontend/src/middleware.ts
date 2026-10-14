/**
 * Middleware de Next.js: validación de sesión y rol en servidor (T5.3.2).
 *
 * Protege los paneles por rol (`/admin`, `/teacher`, `/student`), `/login` y
 * la vista de cambio obligatorio de contraseña (`/cambiar-contrasena`,
 * T5.4.2):
 * - ruta protegida sin sesión → redirige a `/login` (CA 2 de H5.3);
 * - rol equivocado en un panel → redirige al panel del propio rol (CA 1);
 * - sesión con `debeCambiarContrasena === true` (T5.4.2; nombre del backend
 *   desde T5.4.3) → cualquier ruta que no sea `/cambiar-contrasena` redirige
 *   allí (bloqueo hasta completar el cambio);
 * - sesión con el flag en `false` en `/cambiar-contrasena` o `/login` →
 *   redirige al panel del propio rol (ya hizo login / ya cambió);
 * - rol correcto y sin cambio pendiente → deja pasar.
 *
 * ## Esto NO es barrera de seguridad (CA 4 de H5.3)
 *
 * El rol y el bloqueo de cambio de contraseña validados aquí **nunca**
 * sustituyen la validación del backend. Un usuario que salte el frontend
 * (p. ej. llamando a la API directamente) será rechazado por el servidor.
 * Esta capa es UX (evitar mostrar paneles ajenos ni parpadear el panel antes
 * del cambio obligatorio), no seguridad: el bloqueo real lo impone el backend
 * con H2.1/H2.2 (`must_change_password` en la BD y en la sesión).
 *
 * ## Sesión legible (CA 3 de H5.3; login real desde T5.4.3)
 *
 * La sesión se lee vía `leerSesion` de `@/lib/auth`, que consume la cookie
 * legible `educoins_sesion` que escribe la capa de auth tras un login real
 * contra H2.1. No es seguridad: la cookie es editable desde DevTools; el
 * backend revalida cada petición (CA 4 de H5.3).
 *
 * ## Anti-loops (T5.4.2)
 *
 * Cada destino de redirección se evalúa en un solo salto: con el flag en
 * `true`, `/cambiar-contrasena` deja pasar; con el flag en `false`/ausente,
 * el panel del rol deja pasar. No hay cadena de redirecciones posibles.
 *
 * Compatible con **Edge runtime**: solo usa `next/server` y `@/lib/auth`
 * (sin APIs de Node).
 *
 * Si se crea una ruta de panel nueva (p. ej. `/coach`), hay que añadirla al
 * `config.matcher` de abajo: el middleware solo corre en las rutas listadas.
 */

import { NextResponse, type NextRequest } from "next/server";

import { leerSesion, type Rol, type Sesion } from "@/lib/auth";

/**
 * Mapa de rol → ruta del panel.
 *
 * Cada panel exige su rol exacto: un `admin` no ve `/teacher`; se le redirige
 * a `/admin`. Si el producto quiere que el admin inspeccione paneles ajenos,
 * este es el único punto a cambiar.
 */
const PANEL_POR_ROL: Record<Rol, string> = {
  admin: "/admin",
  teacher: "/teacher",
  student: "/student",
};

/**
 * Mapa del primer segmento de la ruta → rol requerido.
 *
 * Solo los paneles por rol están aquí; `/login` y `/cambiar-contrasena` se
 * manejan aparte en {@link destinoDeRedireccion}.
 */
const ROL_DE_RUTA: Record<string, Rol> = {
  admin: "admin",
  teacher: "teacher",
  student: "student",
};

/**
 * Ruta de la vista de cambio obligatorio de contraseña (T5.4.2, PRO-379).
 *
 * Única ruta permitida para una sesión con `debeCambiarContrasena === true`.
 */
const RUTA_CAMBIO_CONTRASENA = "/cambiar-contrasena";

/**
 * Decide si una petición debe redirigirse y a dónde.
 *
 * Es la función pura que concentra toda la lógica del middleware; se exporta
 * para que las pruebas (T5.3.5 y T5.4.2) la verifiquen sin ejecutar Next.
 *
 * Reglas (incluye el bloqueo de cambio obligatorio de T5.4.2):
 * - Sin sesión: `/login` → pasar; `/cambiar-contrasena` o un panel → `/login`.
 * - Sesión con `debeCambiarContrasena === true`: `/cambiar-contrasena` →
 *   pasar; cualquier otra ruta (`/login`, panel u otra) →
 *   `/cambiar-contrasena`.
 * - Sesión con el flag en `false`: `/login` o `/cambiar-contrasena` → panel
 *   del propio rol; panel con rol distinto → panel del propio rol; panel
 *   correcto → pasar.
 * - Cualquier otra ruta → pasar (el `matcher` ya la excluye; red de seguridad).
 *
 * Anti-loops: cada destino se cumple en un solo salto (ver docstring del
 * archivo).
 *
 * @param pathname Ruta de la petición (p. ej. `"/teacher/actividades"`).
 * @param sesion Sesión leída, o `null` si no hay sesión válida.
 * @returns Ruta de destino de la redirección, o `null` para dejar pasar.
 */
export function destinoDeRedireccion(
  pathname: string,
  sesion: Sesion | null,
): string | null {
  const segmento = pathname.split("/")[1] ?? "";
  const esRutaCambio =
    pathname === RUTA_CAMBIO_CONTRASENA ||
    pathname.startsWith(`${RUTA_CAMBIO_CONTRASENA}/`);

  // Bloqueo (T5.4.2): solo el cambio de contraseña es accesible.
  const exigeCambio = sesion?.debeCambiarContrasena === true;

  if (!sesion) {
    if (segmento === "login") {
      return null;
    }

    if (esRutaCambio || ROL_DE_RUTA[segmento]) {
      return "/login";
    }

    return null;
  }

  // Bloqueo (T5.4.2): solo el cambio de contraseña es accesible.
  if (exigeCambio) {
    return esRutaCambio ? null : RUTA_CAMBIO_CONTRASENA;
  }

  // Ya cambió (o no hacía falta): login y cambio se resuelven al panel.
  if (segmento === "login" || esRutaCambio) {
    return PANEL_POR_ROL[sesion.role];
  }

  const rolRequerido = ROL_DE_RUTA[segmento];

  if (!rolRequerido) {
    return null;
  }

  if (sesion.role !== rolRequerido) {
    return PANEL_POR_ROL[sesion.role];
  }

  return null;
}

/**
 * Middleware de Next: lee la sesión y redirige si hace falta.
 *
 * Delgado a propósito: la lógica de decisión vive en
 * {@link destinoDeRedireccion}. Ver el docstring del archivo para el contrato
 * con el backend (no es seguridad; la validación real la hace el servidor).
 *
 * @param request Petición de Next (Edge).
 * @returns `NextResponse.redirect` si hay que redirigir; `NextResponse.next()` en caso contrario.
 */
export function middleware(request: NextRequest) {
  const sesion = leerSesion(request);
  const destino = destinoDeRedireccion(request.nextUrl.pathname, sesion);

  if (destino) {
    return NextResponse.redirect(new URL(destino, request.url));
  }

  return NextResponse.next();
}

/**
 * Rutas que ejecutan el middleware.
 *
 * El middleware solo corre en los paneles por rol, en `/login` y en
 * `/cambiar-contrasena` (T5.4.2). Si se añade una ruta de panel nueva, hay
 * que incluirla aquí.
 *
 * Cada entrada debe ser un **string literal** (no una constante referenciada):
 * Turbopack/Next 16 exige que `matcher` sea estáticamente analizable. Por eso
 * `"/cambiar-contrasena"` está escrito literalmente en vez de usar
 * {@link RUTA_CAMBIO_CONTRASENA} (que sí se usa en la lógica de
 * `destinoDeRedireccion`); si se renombra la ruta, hay que actualizar ambos.
 */
export const config = {
  matcher: [
    "/admin/:path*",
    "/teacher/:path*",
    "/student/:path*",
    "/login",
    "/cambiar-contrasena",
  ],
};
