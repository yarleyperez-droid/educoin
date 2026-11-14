/**
 * `/student/canje` — redirección (H10.3).
 *
 * La tienda del estudiante se reorganizó: la lista plana de ítems de
 * todas las clases se reemplazó por la ventana agrupada por materia en
 * `/student/canjes` (materias → artículos → canje, con el historial en
 * una pestaña). Esta ruta solo conserva los enlaces viejos mandando al
 * nuevo flujo.
 */

import { redirect } from "next/navigation";

/** Redirige permanentemente la tienda plana a la tienda por materia. */
export default function CanjePage(): never {
  redirect("/student/canjes");
}
