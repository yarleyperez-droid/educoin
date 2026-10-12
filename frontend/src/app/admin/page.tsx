/**
 * Página placeholder del panel de administración (`/admin`).
 *
 * Muestra un mensaje de construcción mientras H5.5+ implementa el contenido
 * real del panel (gestión de usuarios, clases, configuración). No hay datos
 * ni llamadas a la API todavía.
 *
 * @returns Contenido placeholder del panel admin.
 */
export default function AdminPage() {
  return (
    <div className="text-center">
      <h2 className="text-xl font-medium text-neutral-700">
        Panel de administración
      </h2>
      <p className="mt-2 text-sm text-neutral-500">
        En construcción — llegará en H5.5+
      </p>
    </div>
  );
}
