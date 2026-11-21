/**
 * Vista de materias del estudiante — H10.3 (T10.3.2).
 *
 * Primer nivel de la tienda: lista las clases donde el estudiante tiene
 * inscripción `active` (`GET /enrollments`, fachada `listarInscripciones`)
 * con el **conteo de artículos disponibles** de cada una. El conteo se
 * calcula en el cliente agrupando el catálogo (`GET /items` con el
 * `className` de T10.3.1) por `claseId`: sin consultas extra y siempre
 * consistente con lo que el estudiante puede ver.
 *
 * Estados de carga, vacío y error los maneja el contenedor
 * `TiendaEstudiante`; aquí solo se renderiza la grilla responsive de
 * materias y se navega al segundo nivel (artículos de la materia).
 */

"use client";

/** Una materia inscrita con el conteo de artículos activos. */
export interface MateriaConArticulos {
  /** Id de la clase (`classes.id`). */
  id: string;
  /** Nombre de la clase. */
  nombre: string;
  /** Cantidad de artículos activos publicados por el profesor. */
  articulos: number;
}

/** Propiedades de la grilla de materias. */
interface PropsMaterias {
  materias: MateriaConArticulos[];
  /** Entra al segundo nivel: artículos de la materia elegida. */
  alElegir: (materia: MateriaConArticulos) => void;
}

/**
 * Texto del conteo en singular/plural ("1 artículo disponible").
 *
 * @param cantidad Número de artículos activos de la materia.
 * @returns Texto listo para la tarjeta.
 */
function textoArticulos(cantidad: number): string {
  return cantidad === 1
    ? "1 artículo disponible"
    : `${cantidad} artículos disponibles`;
}

/**
 * Grilla de materias inscritas (T10.3.2): una tarjeta por clase.
 *
 * @param props Materias con conteo y callback de navegación.
 * @returns Contenido del primer nivel de la tienda del estudiante.
 */
export function MateriasEstudiante({ materias, alElegir }: PropsMaterias) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {materias.map((materia) => (
        <li key={materia.id}>
          <button
            type="button"
            onClick={() => alElegir(materia)}
            data-testid={`tarjeta-materia-${materia.id}`}
            aria-label={`Ver artículos de ${materia.nombre}`}
            className="h-full w-full rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <p className="text-base font-semibold text-slate-900">
              {materia.nombre}
            </p>
            <p
              data-testid={`conteo-materia-${materia.id}`}
              className="mt-2 text-sm text-slate-500"
            >
              {textoArticulos(materia.articulos)}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
