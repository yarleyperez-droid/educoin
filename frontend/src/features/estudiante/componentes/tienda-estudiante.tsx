/**
 * Contenedor de la tienda del estudiante — H10.3 (T10.3.2/T10.3.3).
 *
 * Dos niveles en una sola ventana: **materias** (clases con inscripción
 * `active` + conteo de artículos) → **artículos** (de la materia elegida,
 * con canje del flujo revisable H7.3). Los datos se cargan en paralelo
 * (`GET /enrollments` + `GET /items` + `GET /billetera/saldo`) y el
 * conteo por materia se calcula agrupando el catálogo por `claseId`
 * (con el `className` de T10.3.1 no hacen falta consultas extra).
 *
 * Estados de UI cubiertos con el kit H5.2 (`@/components/ui`): **carga**,
 * **vacío** (sin inscripciones) y **error** con reintento; el layout es
 * responsive por construcción (grilla de tarjetas y listados fluidos,
 * CA 5). Tras cualquier canje se recarga catálogo y saldo contra la API.
 */

"use client";

import { useEffect, useState } from "react";

import {
  EstadoCarga,
  EstadoError,
  EstadoVacio,
  MENSAJE_ERROR_GENERICO,
} from "@/components/ui";
import { listarItems } from "@/features/billetera/api/canje";
import { obtenerSaldo } from "@/features/billetera/api/billetera";
import type { ItemCanje } from "@/features/billetera/contrato/canje";
import {
  listarInscripciones,
  type Inscripcion,
} from "@/features/estudiante/api/inscripciones";
import { ArticulosMateria } from "./articulos-materia";
import {
  MateriasEstudiante,
  type MateriaConArticulos,
} from "./materias-estudiante";
import { ApiError } from "@/lib/api-client";

/** Propiedades del contenedor: la pestaña "Mis canjes" navega entre vistas. */
interface PropsTienda {
  /** Cambia a la pestaña "Mis canjes" (desde el panel de resultado). */
  alVerMisCanjes: () => void;
}

/**
 * Tienda del estudiante: materias inscritas → artículos → canje.
 *
 * @param props `alVerMisCanjes` para saltar a la pestaña del historial.
 * @returns Contenido de la pestaña "Materias" de la ventana Canjes.
 */
export function TiendaEstudiante({ alVerMisCanjes }: PropsTienda) {
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [items, setItems] = useState<ItemCanje[]>([]);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Contador para forzar una recarga desde un evento (reintento/canje). */
  const [recarga, setRecarga] = useState(0);
  /** Materia abierta (`null` = primer nivel: listado de materias). */
  const [materiaId, setMateriaId] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;

    async function recargar(): Promise<void> {
      try {
        const [resultado, lista, saldoNuevo] = await Promise.all([
          listarInscripciones(),
          listarItems(),
          obtenerSaldo(),
        ]);
        if (vigente) {
          setInscripciones(resultado.data);
          setItems(lista);
          setSaldo(saldoNuevo.monedasDisponibles);
          setError(null);
        }
      } catch (e) {
        if (vigente) {
          setError(e instanceof ApiError ? e.message : MENSAJE_ERROR_GENERICO);
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    }

    void recargar();

    return () => {
      vigente = false;
    };
  }, [recarga]);

  /**
   * Recarga catálogo + saldo contra la API (evento de usuario).
   *
   * @param silencioso `true` tras un canje: mantiene la vista actual
   *   (con el panel de resultado) mientras llegan los datos frescos;
   *   `false` en reintentos, donde el spinner reemplaza el contenido.
   */
  function recargarDesdeEvento(silencioso = false): void {
    if (!silencioso) {
      setCargando(true);
    }
    setRecarga((anterior) => anterior + 1);
  }

  /** Reintenta la carga tras un error (CA 5). */
  const reintentar = (): void => {
    recargarDesdeEvento();
  };

  /**
   * Materias inscritas con el conteo de artículos activos: se agrupa el
   * catálogo por `claseId` (una materia sin artículos muestra 0).
   */
  const materias: MateriaConArticulos[] = inscripciones.map((inscripcion) => ({
    id: inscripcion.clase.id,
    nombre: inscripcion.clase.nombre,
    articulos: items.filter((item) => item.claseId === inscripcion.clase.id)
      .length,
  }));

  const materiaAbierta =
    materias.find((materia) => materia.id === materiaId) ?? null;
  const itemsDeMateria = items.filter((item) => item.claseId === materiaId);

  return (
    <div className="space-y-6">
      {cargando && <EstadoCarga mensaje="Cargando tus materias…" />}

      {error !== null && !cargando && (
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <EstadoError mensaje={error} alReintentar={reintentar} />
        </div>
      )}

      {error === null && !cargando && materias.length === 0 && (
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <EstadoVacio
            titulo="Aún no estás inscrito en ninguna clase"
            descripcion="Únete a una clase con el código de tu profesor para ver aquí sus artículos canjeables."
          />
        </div>
      )}

      {error === null && !cargando && materias.length > 0 && (
        <>
          {materiaAbierta === null ? (
            <MateriasEstudiante
              materias={materias}
              alElegir={(materia) => setMateriaId(materia.id)}
            />
          ) : (
            <ArticulosMateria
              key={materiaAbierta.id}
              materia={materiaAbierta}
              items={itemsDeMateria}
              saldo={saldo}
              alRecargar={() => recargarDesdeEvento(true)}
              alVolver={() => setMateriaId(null)}
              alVerMisCanjes={alVerMisCanjes}
            />
          )}
        </>
      )}
    </div>
  );
}
