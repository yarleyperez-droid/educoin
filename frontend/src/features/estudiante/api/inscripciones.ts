/**
 * Fachada de inscripciones para el estudiante.
 *
 * Consume `GET /api/v1/enrollments` para descubrir las clases en las que
 * el estudiante está inscrito y activo. Con esos ids se puede pedir
 * `GET /enrollments/:inscripcionId/activities` (ver
 * `features/estudiante/api/actividades-estudiante.ts`).
 */

import { api } from '@/lib/api-client';
import type { ApiMeta } from '@/lib/api-client';

/**
 * Inscripción tal como sale del backend (`InscripcionListadoDto`).
 */
interface InscripcionBackend {
  id: string;
  clase: { id: string; nombre: string };
  estado: string;
  inscritoEn: string;
}

/** Clase en la que está inscrito el estudiante. */
export interface ClaseInscrita {
  id: string;
  nombre: string;
}

/** Inscripción activa del estudiante. */
export interface Inscripcion {
  id: string;
  clase: ClaseInscrita;
  estado: string;
  inscritoEn: string;
}

function aInscripcion(backend: InscripcionBackend): Inscripcion {
  return {
    id: String(backend.id),
    clase: {
      id: String(backend.clase.id),
      nombre: backend.clase.nombre,
    },
    estado: backend.estado,
    inscritoEn: backend.inscritoEn,
  };
}

/**
 * Lista las inscripciones activas del estudiante autenticado.
 *
 * @returns Inscripciones con paginación (por defecto hasta 50 filas).
 */
export async function listarInscripciones(): Promise<{
  data: Inscripcion[];
  meta: ApiMeta;
}> {
  const respuesta = await api.get<InscripcionBackend[]>('enrollments?limit=50');

  return {
    data: respuesta.data.map(aInscripcion),
    meta: respuesta.meta ?? {
      total: respuesta.data.length,
      page: 1,
      limit: 50,
    },
  };
}
