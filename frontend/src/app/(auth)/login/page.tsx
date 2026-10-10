/**
 * Página placeholder de inicio de sesión (`/login`).
 *
 * Es el destino al que el middleware de Next redirige cuando no hay sesión
 * activa en una ruta protegida (T5.3.2, PRO-372). Todavía **no valida
 * credenciales** ni llama a la API de autenticación.
 *
 * Contrato con el backend (para no cazar bugs cuando llegue H2.1):
 * - Este placeholder NO envía credenciales ni llama a `auth/login`.
 *   El formulario real y la llamada al endpoint llegan con H5.4 / H2.1.
 * - Cuando H2.1 defina el endpoint real de login, se rellena este archivo
 *   sin tocar los layouts de los paneles (que solo renderizan `{children}`).
 * - La sesión de Next aún no existe: nadie escribe cookies todavía. Cuando
 *   T5.3.3 añada auth simulada en el middleware, será coherente con el
 *   contrato de Swagger (AGENTS.md §8).
 *
 * @returns Contenido placeholder de la página de login.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 p-8">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-neutral-900">
          EduCoins
        </h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          Aprende, resuelve y gana recompensas
        </p>
        <p className="mt-6 text-center text-sm text-neutral-400">
          Inicio de sesión — en construcción (H5.4)
        </p>
      </div>
    </main>
  );
}
