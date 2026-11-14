import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Edición parcial de una cuenta de usuario. Hoy el único campo editable
 * es el estado activo: activa=true reactiva y activa=false desactiva,
 * que es el borrado lógico del recurso (la tabla users no tiene
 * deleted_at: is_active ES su ciclo de vida, misma decisión que
 * organizations). Debe llegar AL MENOS un campo — un cuerpo vacío no
 * cambia nada y el Service responde 400 en lugar de un no-op (patrón
 * de ActualizarOrganizacionDto y ActualizarClaseDto).
 *
 * Todo lo demás NO es editable por decisión del equipo: la identidad
 * (username/correo/rol/organización) y la contraseña se gestionan en
 * otros flujos, must_change_password/is_active tienen dueño BD en el
 * alta (AGENTS.md §7) y updated_at lo mantiene el trigger
 * fn_set_updated_at (AGENTS.md §6). Una edición de nombre/apellido/
 * especialidad requeriría su propio plan y aprobación.
 */
export class ActualizarUsuarioDto {
  /** Activa o desactiva la cuenta (users.is_active). */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
