/**
 * Página del panel docente (`/teacher`) — H5.6 (PRO-287).
 *
 * Punto de entrada del panel: hoy ofrece la acción de **crear clase**
 * (T5.6.1 / PRO-385); el resto del contenido (listados, actividades) llega
 * con T5.6.2–T5.6.3. No llama a la API: solo navega.
 *
 * @returns Contenido placeholder del panel docente con la acción de crear clase.
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
          href="/teacher/clases/nueva"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
        >
          Crear clase
        </Link>
      </div>
    </div>
  );
}
