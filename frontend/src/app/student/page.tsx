/**
 * Página del panel estudiante (`/student`) — H5.8 (PRO-289).
 *
 * Punto de entrada del panel: navega al **listado de actividades
 * publicadas** (T5.8.1 / PRO-394), donde se abre el cuestionario. El resto
 * del contenido (billetera, rankings) llega con las historias siguientes.
 * No llama a la API: solo navega.
 *
 * @returns Contenido del panel estudiante con el acceso a actividades.
 */

import Link from "next/link";

export default function StudentPage() {
  return (
    <div className="text-center">
      <h2 className="text-xl font-medium text-neutral-700">
        Panel Estudiante
      </h2>
      <p className="mt-2 text-sm text-neutral-500">
        Resuelve actividades y gana recompensas.
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <Link
          href="/student/actividades"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
        >
          Mis actividades
        </Link>
      </div>
    </div>
  );
}
