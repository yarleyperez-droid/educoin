/**
 * Hub del panel de administración (`/admin`) — T5.5.1 / PRO-380 (H5.5).
 *
 * Punto de entrada del panel: tarjetas con links a las secciones del
 * admin (Organizaciones y Usuarios). Reemplaza al placeholder de
 * construcción. **No llama a la API** (el middleware H5.3 ya garantiza
 * que solo un admin llegue aquí).
 *
 * @returns Contenido del hub admin dentro del shell de `/admin`.
 */
import Link from "next/link";

/** Secciones del panel del admin. */
const SECCIONES = [
  {
    href: "/admin/organizaciones",
    titulo: "Organizaciones",
    descripcion: "Alta y listado de las instituciones de la plataforma.",
    testid: "link-admin-organizaciones",
  },
  {
    href: "/admin/usuarios",
    titulo: "Usuarios",
    descripcion:
      "Alta de profesores y estudiantes con su contraseña inicial, y listado con filtro por organización.",
    testid: "link-admin-usuarios",
  },
] as const;

/**
 * Hub del panel de administración.
 *
 * @returns Tarjetas de navegación del admin.
 */
export default function AdminPage() {
  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-medium text-neutral-700">
          Panel de administración
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Gestiona las organizaciones y los usuarios de EduCoins.
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {SECCIONES.map((seccion) => (
          <li key={seccion.href}>
            <Link
              href={seccion.href}
              data-testid={seccion.testid}
              className="block h-full rounded-lg border border-neutral-200 bg-white p-6 shadow-sm hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2"
            >
              <span className="text-base font-semibold text-neutral-900">
                {seccion.titulo}
              </span>
              <span className="mt-2 block text-sm text-neutral-500">
                {seccion.descripcion}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
