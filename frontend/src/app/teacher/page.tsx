/**
 * Página del panel docente (`/teacher`) — H5.6 (PRO-287).
 *
 * Punto de entrada del panel: navega al **listado de mis clases**
 * (T5.6.3 / PRO-387) y a la **creación de clase** (T5.6.1 / PRO-385); el
 * resto del contenido llega con las historias siguientes. No llama a la
 * API: solo navega.
 *
 * @returns Contenido del panel docente con los accesos principales.
 */

import Link from "next/link";

export default function TeacherPage() {
  return (
    <div className="text-center">
      <h2 className="text-xl font-medium text-neutral-700">Panel Docente</h2>
      <p className="mt-2 text-sm text-neutral-500">
        Gestiona tus clases y actividades desde aquí.
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <Link
          href="/teacher/clases"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
        >
          Mis clases
        </Link>
        <Link
          href="/teacher/clases/nueva"
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
        >
          Crear clase
        </Link>
      </div>
    </div>
  );
}
