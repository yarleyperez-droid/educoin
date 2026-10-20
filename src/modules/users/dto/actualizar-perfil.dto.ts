import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PATRON_NOMBRE, PATRON_USERNAME } from './crear-usuario.dto';

/**
 * 400 con mensaje específico cuando alguien intenta cambiar desde /me
 * un campo que solo gestiona el administrador (docs/endpoint_perfil_me.md):
 * el rol y la organización NUNCA se editan desde este endpoint. El
 * validador falla siempre que el campo llega; @ValidateIf hace que solo
 * se evalúe si el campo está presente (undefined no se valida, null sí
 * se rechaza — un rol null tampoco debe colarse).
 */
export const MENSAJE_ROL_PROHIBIDO =
  'El rol solo puede modificarlo un administrador.';

export const MENSAJE_ORGANIZACION_PROHIBIDA =
  'La organización solo puede modificarla un administrador.';

@ValidatorConstraint({ name: 'campoProhibido', async: false })
class CampoProhibidoConstraint implements ValidatorConstraintInterface {
  /** El campo NO debe llegar: presente (incluso null) → siempre inválido. */
  validate(): boolean {
    return false;
  }

  defaultMessage(): string {
    return 'Ese campo no se puede modificar desde este endpoint.';
  }
}

/** Declara un campo prohibido en el DTO con su mensaje de 400. */
function CampoProhibido(mensaje: string): PropertyDecorator {
  return Validate(CampoProhibidoConstraint, { message: mensaje });
}

/**
 * PATCH /api/v1/users/me — edición del PROPIO perfil. El objetivo nunca
 * viaja en la petición: sale del JWT, así que la pertenencia es
 * estructural (IDOR imposible, AGENTS.md §9.7).
 *
 * Dos grupos de campos con distinta exigencia de identidad:
 * - Genéricos (nombre/apellido/especialidad): basta la `contrasena`
 *   actual, que confirma que quien edita es el dueño de la sesión y no
 *   alguien que la robó.
 * - Credenciales (usuario/correo/contrasenaNueva): exigen además
 *   `correoActual` (identificación completa "como el login") y un
 *   access token RECIENTE (iat ≤ SEGUNDOS_FRESCURA_TOKEN, service).
 *   Tras aplicarlos el service cierra TODAS las sesiones del usuario.
 *
 * Los campos inexistente en la entidad (p. ej. `biografia`) los rechaza
 * el ValidationPipe global (whitelist + forbidNonWhitelisted): el DTO
 * es la allow-list del contrato.
 */
export class ActualizarPerfilDto {
  /**
   * Contraseña ACTUAL del usuario: requerida SIEMPRE, en todos los
   * cambios. Se verifica con argon2 contra users.password_hash en el
   * service; jamás se persiste ni se devuelve (AGENTS.md §9.3).
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  contrasena!: string;

  /** Nombre propio (users.first_name VARCHAR(100) NOT NULL). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_NOMBRE)
  @MaxLength(100)
  nombre?: string;

  /** Apellido (users.last_name VARCHAR(150) NOT NULL). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_NOMBRE)
  @MaxLength(150)
  apellido?: string;

  /**
   * Especialidad (users.specialty, solo profesores): un string la
   * cambia y `null` la LIMPIA; ausente = no se toca. Si llega con rol
   * student/admin el service responde 400 (MENSAJE_ESPECIALIDAD_SOLO_PROFESOR).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  especialidad?: string | null;

  /**
   * Correo ACTUAL: identificación completa para cambiar credenciales.
   * Obligatorio solo si viaja usuario/correo/contrasenaNueva; el
   * service lo exige y compara (insensible a mayúsculas, CITEXT).
   */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  correoActual?: string;

  /** Nuevo username (users.username CITEXT UNIQUE → duplicado = 409). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(PATRON_USERNAME)
  usuario?: string;

  /** Nuevo correo (users.email CITEXT UNIQUE → duplicado = 409). */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  correo?: string;

  /**
   * Nueva contraseña (rango 8–128, el mismo que exige el login): se
   * hashea con argon2 y además baja must_change_password a false — es
   * el cierre del flujo del primer inicio que exige la BD.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  contrasenaNueva?: string;

  /** PROHIBIDO: users.role es exclusivo del admin (PATCH /users/:id). */
  @ValidateIf((_dto, valor) => valor !== undefined)
  @CampoProhibido(MENSAJE_ROL_PROHIBIDO)
  rol?: unknown;

  /** PROHIBIDO: users.organization_id es exclusivo del admin. */
  @ValidateIf((_dto, valor) => valor !== undefined)
  @CampoProhibido(MENSAJE_ORGANIZACION_PROHIBIDA)
  organizacionId?: unknown;
}
