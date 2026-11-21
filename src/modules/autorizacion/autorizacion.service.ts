import { Injectable, NotFoundException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import type { TipoRecurso } from '../../common/decorators/pertenece-a.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 404 idéntico al que traduce PrismaExceptionFilter para P2025: oculta
 * tanto la inexistencia del recurso como su dueño real (anti-enumeración).
 */
export const MENSAJE_RECURSO_NO_ENCONTRADO =
  'El registro solicitado no fue encontrado.';

const TIPOS_RECURSO: readonly TipoRecurso[] = [
  'clase',
  'inscripcion',
  'actividad',
  'actividadVisible',
  'entrega',
  'item',
  'canje',
];

/**
 * Único dueño de las reglas de pertenencia de recursos (AGENTS.md §8).
 * Lo consumen dos capas con la MISMA implementación:
 * 1. PertenenciaGuard (HTTP): de forma automática vía @PerteneceA(...).
 * 2. Cualquier Service: llamando verificarPertenencia(...) en flujos
 *    internos, como verificación de pertenencia en el Service.
 *
 * Reglas por recurso y rol (columnas reales del esquema):
 * - clase:        teacher → su teacher_id.        student → nunca.
 * - inscripcion:  student → su student_id.        teacher → la clase de la
 *                  inscripción es suya (via classes.teacher_id).
 * - actividad:    teacher → la clase de la actividad es suya. student → nunca.
 * - actividadVisible: teacher → la clase de la actividad es suya (dueño,
 *                  cualquier estado). student → inscripción ACTIVA en la
 *                  clase de la actividad PUBLICADA (draft/deleted → 404):
 *                  es la puerta de la vista sanitizada sin respuestas
 *                  correctas (AGENTS.md §9.5).
 * - entrega:      student → su inscripción.        teacher → la clase de la
 *                  inscripción de la entrega es suya.
 * - item:         teacher → la clase del ítem es suya. student → nunca.
 * - canje:        student → su inscripción.        teacher → la clase de la
 *                  inscripción del canje es suya.
 * El rol admin es global y pasa siempre sin consultar la BD.
 */
@Injectable()
export class AutorizacionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica que el recurso pertenezca al usuario según su rol.
   * Lanza 404 (mismo mensaje que P2025) si no existe, si el id no es
   * numérico o si pertenece a otro usuario. Los Services pueden capturarla
   * o dejarla propagar: el filtro global ya la traduce igual.
   */
  async verificarPertenencia(
    tipo: TipoRecurso,
    recursoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<void> {
    if (!TIPOS_RECURSO.includes(tipo)) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    if (usuario.role === 'admin') {
      return;
    }

    const idNumerico = this.aBigInt(recursoId);
    if (idNumerico === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const pertenece = await this.ejecutarRegla(tipo, idNumerico, usuario);
    if (!pertenece) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
  }

  private async ejecutarRegla(
    tipo: TipoRecurso,
    idRecurso: bigint,
    usuario: UsuarioAutenticado,
  ): Promise<boolean> {
    const idUsuario = BigInt(usuario.id);

    switch (tipo) {
      case 'clase':
        return usuario.role === 'teacher'
          ? (await this.prisma.classes.findFirst({
              where: { id: idRecurso, teacher_id: idUsuario },
              select: { id: true },
            })) !== null
          : false;

      case 'inscripcion':
        if (usuario.role === 'student') {
          return (
            (await this.prisma.enrollments.findFirst({
              where: { id: idRecurso, student_id: idUsuario },
              select: { id: true },
            })) !== null
          );
        }
        if (usuario.role === 'teacher') {
          return (
            (await this.prisma.enrollments.findFirst({
              where: { id: idRecurso, classes: { teacher_id: idUsuario } },
              select: { id: true },
            })) !== null
          );
        }
        return false;

      case 'actividad':
        return usuario.role === 'teacher'
          ? (await this.prisma.activities.findFirst({
              where: { id: idRecurso, classes: { teacher_id: idUsuario } },
              select: { id: true },
            })) !== null
          : false;

      case 'actividadVisible':
        if (usuario.role === 'teacher') {
          return (
            (await this.prisma.activities.findFirst({
              where: { id: idRecurso, classes: { teacher_id: idUsuario } },
              select: { id: true },
            })) !== null
          );
        }
        if (usuario.role === 'student') {
          // Existencia + published + inscripción activa en la MISMA
          // consulta: el estudiante solo llega a ver actividades
          // publicadas de clases donde está inscrito (AGENTS.md §9.5).
          return (
            (await this.prisma.activities.findFirst({
              where: {
                id: idRecurso,
                status: 'published',
                classes: {
                  enrollments: {
                    some: { student_id: idUsuario, status: 'active' },
                  },
                },
              },
              select: { id: true },
            })) !== null
          );
        }
        return false;

      case 'entrega':
        if (usuario.role === 'student') {
          return (
            (await this.prisma.submissions.findFirst({
              where: { id: idRecurso, enrollments: { student_id: idUsuario } },
              select: { id: true },
            })) !== null
          );
        }
        if (usuario.role === 'teacher') {
          return (
            (await this.prisma.submissions.findFirst({
              where: {
                id: idRecurso,
                enrollments: { classes: { teacher_id: idUsuario } },
              },
              select: { id: true },
            })) !== null
          );
        }
        return false;

      case 'item':
        return usuario.role === 'teacher'
          ? (await this.prisma.redeemable_items.findFirst({
              where: { id: idRecurso, classes: { teacher_id: idUsuario } },
              select: { id: true },
            })) !== null
          : false;

      case 'canje':
        if (usuario.role === 'student') {
          return (
            (await this.prisma.redemptions.findFirst({
              where: { id: idRecurso, enrollments: { student_id: idUsuario } },
              select: { id: true },
            })) !== null
          );
        }
        if (usuario.role === 'teacher') {
          return (
            (await this.prisma.redemptions.findFirst({
              where: {
                id: idRecurso,
                enrollments: { classes: { teacher_id: idUsuario } },
              },
              select: { id: true },
            })) !== null
          );
        }
        return false;
    }
  }

  private aBigInt(valor: string): bigint | null {
    try {
      return BigInt(valor);
    } catch {
      return null;
    }
  }
}
