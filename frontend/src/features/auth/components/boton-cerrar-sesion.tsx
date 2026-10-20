"use client";

/**
 * Botón de cierre de sesión del shell de los paneles.
 *
 * Client component (excepción a la regla "solo los formularios son client":
 * el botón necesita `useRouter` para navegar a `/login` tras cerrar la
 * sesión). No toca cookies ni tokens directamente: delega todo en
 * `cerrarSesion()` de la capa de auth (POST auth/logout + limpieza local).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cerrarSesion } from "@/features/auth/api/auth";

export function BotonCerrarSesion() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);

  const manejarClic = async () => {
    setCargando(true);
    await cerrarSesion();
    router.push("/login");
  };

  return (
    <button
      type="button"
      onClick={manejarClic}
      disabled={cargando}
      aria-busy={cargando}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {cargando ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
