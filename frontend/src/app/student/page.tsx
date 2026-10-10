/**
 * Página placeholder del panel estudiante (`/student`).
 *
 * Muestra un mensaje de construcción mientras H5.6+ implementa el contenido
 * real (actividades, billetera, ranking). No hay datos ni llamadas a la API
 * todavía.
 *
 * @returns Contenido placeholder del panel estudiante.
 */
export default function StudentPage() {
  return (
    <div className="text-center">
      <h2 className="text-xl font-medium text-neutral-700">
        Panel Estudiante
      </h2>
      <p className="mt-2 text-sm text-neutral-500">
        En construcción — llegará en H5.6+
      </p>
    </div>
  );
}
