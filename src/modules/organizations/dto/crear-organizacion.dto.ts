import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { organization_type } from '../../../generated/prisma/client';

/**
 * Datos para crear una organización. La creación es exclusiva del admin
 * (AGENTS.md §5), resuelta con @Roles('admin') en el controller; el DTO
 * solo valida la forma de los datos. El estado activo NO viaja aquí: lo
 * aporta la BD con su DEFAULT TRUE, igual que el código de unión de las
 * clases (AGENTS.md §7: los valores con dueño "BD" jamás se aceptan del
 * cliente).
 */
export class CrearOrganizacionDto {
  /**
   * Nombre visible, único en la BD (organizations.name UNIQUE → P2002,
   * que el filtro global traduce a 409). VARCHAR(200) NOT NULL.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  nombre!: string;

  /** Tipo de organización (enum organization_type de la BD). */
  @IsIn(Object.values(organization_type))
  tipo!: organization_type;

  /** Ciudad opcional (VARCHAR(100) nullable). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ciudad?: string | null;
}
