import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { organization_type } from '../../../generated/prisma/client';

/**
 * Datos de la organización que SALEN hacia el cliente (AGENTS.md §8:
 * nunca se devuelven entidades Prisma crudas). El id viaja como string
 * porque BigInt no se serializa a JSON (AGENTS.md §7). La tabla no
 * tiene campos sensibles: el mapeo explícito igualmente fija el
 * contrato y evita que columnas futuras se filtren solas.
 */
export class OrganizacionRespuestaDto {
  id!: string;
  nombre!: string;

  /** El plugin CLI no infiere los enums-objeto de Prisma: explícito. */
  @ApiProperty({
    enum: organization_type,
    description: 'Tipo de organización: school, university u other.',
  })
  tipo!: organization_type;

  ciudad!: string | null;
  activa!: boolean;
  creadoEn!: string;
  actualizadoEn!: string;
}

/**
 * Respuesta de POST /api/v1/organizations: confirma la creación con un
 * mensaje de éxito y la organización creada (patrón de
 * ClaseCreadaRespuestaDto). No hay código de unión que compartir: el
 * mensaje es fijo.
 */
export class OrganizacionCreadaRespuestaDto {
  mensaje!: string;
  organizacion!: OrganizacionRespuestaDto;
}

/**
 * Meta de la paginación estándar de listados (AGENTS.md §8). Misma
 * forma que la de clases: { total, page, limit }.
 *
 * @ApiSchema lo renombra en el spec: classes tiene su propia clase
 * ListadoMetaDto y Swagger nombra los esquemas por clase.
 */
@ApiSchema({ name: 'ListadoOrganizacionesMetaDto' })
export class ListadoMetaDto {
  total!: number;
  page!: number;
  limit!: number;
}

/** Sobre estándar de listados: { data, meta } (AGENTS.md §8). */
export class ListadoOrganizacionesDto {
  data!: OrganizacionRespuestaDto[];
  meta!: ListadoMetaDto;
}
