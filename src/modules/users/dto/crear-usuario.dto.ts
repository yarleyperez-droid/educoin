import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { user_role } from '../../../generated/prisma/client';

/**
 * Roles que el admin puede crear con este endpoint: profesores y
 * estudiantes (AGENTS.md §5). 'admin' queda fuera a propósito: la
 * creación de otros admins no es parte del flujo del MVP.
 */
export const ROLES_CREABLES = ['teacher', 'student'] as const;

/** Rol creado por el admin: user_role sin 'admin'. */
export type RolCreable = Exclude<user_role, 'admin'>;

/**
 * Username de 3 a 50 caracteres que empieza y termina en alfanumérico
 * y admite puntos, guiones y guiones bajos en medio (mismo estilo que
 * las cuentas del seed: 'prof.lopez', 'est.perez', 'admin').
 */
const PATRON_USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}[a-zA-Z0-9]$/;

/**
 * Nombres propios: letras (incluidas acentuadas), espacios, apóstrofes
 * y guiones — cubre 'María', 'Ana María', 'Jean-Pierre'. Sin dígitos ni
 * símbolos: el requisito del MVP es que todos los campos lleguen con
 * datos válidos.
 */
const PATRON_NOMBRE = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

/**
 * Datos para crear una cuenta teacher/student. La creación es exclusiva
 * del admin (AGENTS.md §5), resuelta con @Roles('admin') en el
 * controller; el DTO solo valida la forma de los datos.
 *
 * No viajan aquí (los aporta la BD, AGENTS.md §7): must_change_password
 * (DEFAULT TRUE — el usuario nace obligado a cambiarla en su primer
 * inicio), is_active (DEFAULT TRUE), last_login, created_at/updated_at.
 * Tampoco la contraseña: la genera el servidor y se devuelve UNA sola
 * vez en la respuesta de creación (decisión del equipo).
 */
export class CrearUsuarioDto {
  /** Rol de la cuenta nueva: 'teacher' | 'student' (nunca 'admin'). */
  @IsIn([...ROLES_CREABLES])
  rol!: RolCreable;

  /**
   * Nombre de usuario único (users.username CITEXT UNIQUE → el
   * duplicado insensible a mayúsculas responde 409).
   */
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_USERNAME)
  usuario!: string;

  /**
   * Correo único (users.email CITEXT UNIQUE): duplicado → 409 con
   * mensaje claro; el dominio de la BD (CITEXT) no distingue
   * mayúsculas.
   */
  @IsEmail()
  @MaxLength(254)
  correo!: string;

  /** Nombre propio (VARCHAR(100) NOT NULL). */
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_NOMBRE)
  @MaxLength(100)
  nombre!: string;

  /** Apellido (VARCHAR(150) NOT NULL). */
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_NOMBRE)
  @MaxLength(150)
  apellido!: string;

  /**
   * Organización de la cuenta (obligatoria): el CHECK ck_users_org exige
   * que todo teacher/student pertenezca a una organización. Viaja como
   * string porque los IDs BigInt no se serializan a JSON (AGENTS.md §7).
   */
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(20)
  organizacionId!: string;

  /**
   * Especialidad del profesor (VARCHAR(150), nullable). Solo tiene
   * sentido para teachers: si llega con rol 'student' el service
   * responde 400 (MENSAJE_ESPECIALIDAD_SOLO_PROFESOR).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  especialidad?: string | null;
}
