import { SetMetadata } from '@nestjs/common';

export const PERTENECE_A_KEY = 'perteneceA';

/**
 * Tipos de recurso con regla de pertenencia implementada en
 * AutorizacionService (src/modules/autorizacion). Los nombres son de
 * dominio en español; cada uno mapea a la tabla real de la BD:
 * clase→classes, inscripcion→enrollments, actividad→activities,
 * actividadVisible→activities (vista del estudiante inscrito),
 * entrega→submissions, item→redeemable_items, canje→redemptions.
 */
export type TipoRecurso =
  | 'clase'
  | 'inscripcion'
  | 'actividad'
  | 'actividadVisible'
  | 'entrega'
  | 'item'
  | 'canje';

export interface ReglaPertenencia {
  /** Tipo de recurso cuya pertenencia se verifica. */
  tipo: TipoRecurso;
  /** Nombre del parámetro de ruta donde viaja el id del recurso (p. ej. 'id'). */
  parametroId: string;
}

/**
 * Declara en un endpoint que el recurso accedido debe pertenecer al
 * usuario autenticado. Es pura metadata: la verifica PertenenciaGuard
 * (APP_GUARD global) consultando AutorizacionService. Si el recurso no
 * existe o pertenece a otro usuario → 404 "El registro solicitado no
 * fue encontrado." El rol admin pasa siempre. Uso:
 *
 *   @Roles('teacher')
 *   @PerteneceA('clase', 'id')
 *   @Put(':id')
 *   actualizar(@Param('id') id: string) { ... }
 */
export const PerteneceA = (
  tipo: TipoRecurso,
  parametroId: string,
): MethodDecorator & ClassDecorator =>
  SetMetadata(PERTENECE_A_KEY, {
    tipo,
    parametroId,
  } satisfies ReglaPertenencia);
