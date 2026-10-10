/**
 * Middleware de Next.js: validación de sesión y rol en servidor (T5.3.2).
 *
 * Protege los paneles por rol (`/admin`, `/teacher`, `/student`) y `/login`:
 * - ruta protegida sin sesión → redirige a `/login` (CA 2 de H5.3);
 * - rol equivocado en un panel → redirige al panel del propio rol (CA 1);
 * - rol correcto → deja pasar.
 *
 * ## Esto NO es barrera de seguridad (CA 4 de H5.3)
 *
 * El rol validado aquí **nunca** sustituye la validación del backend. Un
 * usuario que salte el frontend (p. ej. llamando a la API directamente) será
 * rechazado por el servidor. Esta capa es UX (evitar mostrar paneles ajenos),
 * no seguridad.
 *
 * ## Sesión simulada hasta H2.1 (CA 3 de H5.3)
 *
 * La sesión se lee vía `leerSesion` de `@/lib/auth`, que hoy consume la cookie
 * simulada `educoins_sesion`. Cuando H2.1 entregue la sesión real (cookie
 * `httpOnly` + JWT), **solo cambia el interior de `leerSesion`** — este
 * middleware no se toca.
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
 * Solo los paneles por rol están aquí; `/login` se maneja aparte en
 * {@link destinoDeRedireccion}.
 */
const ROL_DE_RUTA: Record<string, Rol> = {
  admin: "admin",
  teacher: "teacher",
  student: "student",
};

/**
 * Decide si una petición debe redirigirse y a dónde.
 *
 * Es la función pura que concentra toda la lógica del middleware; se exporta
 * para que las pruebas (T5.3.5) la verifiquen sin ejecutar Next.
 *
 * Reglas:
 * - `/login` con sesión → al panel del propio rol (ya está autenticado).
 * - `/login` sin sesión → pasar (muestra el placeholder de login).
 * - Panel sin sesión → `/login` (CA 2 de H5.3).
 * - Panel con rol distinto al requerido → al panel del rol de la sesión (CA 1).
 * - Panel con el rol correcto → pasar.
 * - Cualquier otra ruta → pasar (el `matcher` ya la excluye; red de seguridad).
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

  if (segmento === "login") {
    return sesion ? PANEL_POR_ROL[sesion.rol] : null;
  }

  const rolRequerido = ROL_DE_RUTA[segmento];

  if (!rolRequerido) {
    return null;
  }

  if (!sesion) {
    return "/login";
  }

  if (sesion.rol !== rolRequerido) {
    return PANEL_POR_ROL[sesion.rol];
  }

  return null;
}

/**
 * Middleware de Next: lee la sesión y redirige si hace falta.
 *
 * Delgado a propósito: la lógica de decisión vive en
 * {@link destinoDeRedireccion}. Ver el docstring del archivo para el contrato
 * con el backend (no es seguridad; la sesión es simulada hasta H2.1).
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
 * El middleware solo corre en los paneles por rol y en `/login`. Si se añade
 * una ruta de panel nueva, hay que incluirla aquí.
 */
export const config = {
  matcher: ["/admin/:path*", "/teacher/:path*", "/student/:path*", "/login"],
};
