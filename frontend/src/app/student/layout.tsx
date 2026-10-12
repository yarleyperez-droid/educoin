/**
 * Layout del panel estudiante (`/student`).
 *
 * Shell base del panel del estudiante: estructura vacía con el título del
 * rol y espacio para las páginas hijas. Todavía **no está protegido** — la
 * protección con middleware de sesión y rol llega con T5.3.2 (PRO-372).
 *
 * Contrato con el backend (para no cazar bugs cuando llegue H2.1):
 * - Este layout NO llama a la API. Actividades, billetera y ranking llegan
 *   en historias posteriores (H5.6+).
 * - Cuando T5.3.3 añada auth simulada, el middleware leerá una sesión que
 *   aún nadie escribe; eso es esperado hasta que H2.1 entregue la sesión real.
 * - El rol validado en el frontend NO es barrera de seguridad (CA 4 de H5.3):
 *   el backend también valida cada petición. Un docente que intente acceder
 *   a `/student` será redirigido por el middleware (T5.3.2) y, si lo salta,
 *   rechazado por el backend.
 *
 * @param children Páginas hijas del panel (`/student/page.tsx`, etc.).
 */
export default function StudentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">
          EduCoins — Panel Estudiante
        </h1>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center p-8">
        {children}
      </section>
    </main>
  );
}
