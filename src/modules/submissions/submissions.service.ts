import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { submission_status } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import type { Pregunta } from '../activities/dto/preguntas.schema';
import type { CrearEntregaDto } from './dto/crear-entrega.dto';
import type { GuardarBorradorDto } from './dto/guardar-borrador.dto';
import { exigirCompletitud, validarRespuestas } from './dto/respuestas.schema';
import {
  evaluarRespuestas,
  type RespuestaCalificada,
} from './auto-calificacion';
import type {
  BorradorGuardadoRespuestaDto,
  EntregaBorradorRespuestaDto,
  EntregaCreadaRespuestaDto,
  EntregaRespuestaDto,
} from './dto/entrega-respuesta.dto';
import type { RespuestaEntrega } from './dto/respuestas.schema';

/**
 * Mensajes de resultado (exportados para que las pruebas compartan
 * exactamente el mismo texto). El Service decide cuál va según la
 * evaluación (evaluarRespuestas):
 * - calificada: auto-calificable Y con el umbral de correctas → el
 *   trigger ya acreditó las monedas.
 * - umbral: auto-calificable pero sin el 80% de correctas → queda
 *   'submitted' y la decisión final es del profesor.
 * - pendiente: la actividad tiene preguntas de calificación manual.
 */
export const MENSAJE_ENTREGA_CALIFICADA =
  'Entrega registrada y calificada automáticamente: alcanzaste el umbral de respuestas correctas y las monedas de la actividad ya fueron acreditadas.';

export const MENSAJE_ENTREGA_UMBRAL =
  'Tu entrega no alcanzó el umbral del 80% de respuestas correctas: queda pendiente de revisión del profesor, quien decidirá si la califica.';

export const MENSAJE_ENTREGA_PENDIENTE =
  'Entrega registrada con la evaluación de las preguntas auto-calificables: la calificación final la hará el profesor (la actividad tiene preguntas de calificación manual).';

/** 409 al enviar dos veces la misma actividad. */
export const MENSAJE_ENTREGA_DUPLICADA =
  'Ya registraste una entrega para esta actividad: solo se permite una entrega por estudiante en cada actividad.';

/** 409 al intentar editar/guardar borrador de una entrega ya enviada. */
export const MENSAJE_ENTREGA_YA_ENVIADA =
  'La actividad ya fue enviada: no puede volver al estado de borrador ni editarse.';

/** Éxito del autosave del borrador. */
export const MENSAJE_BORRADOR_GUARDADO =
  'Borrador guardado: puedes salir y volver cuando quieras; la entrega se registra al enviarla.';

/** 422 cuando la actividad ya pasó su fecha de cierre. */
export const MENSAJE_ACTIVIDAD_CERRADA =
  'La actividad ya no acepta entregas: su fecha de cierre ya pasó.';

/**
 * Fila de activities tal como la necesitan los flujos de entrega
 * (AGENTS.md §5: nombres reales de la BD): la clase (para ubicar la
 * inscripción), el cierre (vigencia) y las preguntas (validar, exigir
 * completitud y evaluar respuestas).
 */
interface ActividadParaEntrega {
  class_id: bigint;
  closes_at: Date | null;
  questions: Prisma.JsonValue;
}

/** Fila de submissions tal como sale en los DTOs. */
interface EntregaEnBD {
  id: bigint;
  activity_id: bigint;
  status: submission_status;
  submitted_at: Date | null;
  score: Prisma.Decimal | null;
  coins_awarded: number;
  answers: Prisma.JsonValue;
}

/** Contexto compartido por los tres endpoints de entrega. */
interface ContextoEntrega {
  idActividad: bigint;
  inscripcionId: bigint;
  preguntas: Pregunta[];
  /** Fecha de cierre de la actividad (null = sin cierre). */
  cierraEn: Date | null;
}

const CAMPOS_ACTIVIDAD_ENTREGA = {
  class_id: true,
  closes_at: true,
  questions: true,
} as const;

const CAMPOS_ENTREGA = {
  id: true,
  activity_id: true,
  status: true,
  submitted_at: true,
  score: true,
  coins_awarded: true,
  answers: true,
} as const;

/**
 * Flujo del ESTUDIANTE sobre las entregas (AGENTS.md §11.1–§11.4 y
 * docs/flujo_entregas.md):
 *
 * Máquina de estados (valores reales del enum submission_status — el
 * "draft" del equipo de negocio es in_progress, el único estado de
 * borrador que existe en la BD):
 *
 *   in_progress  ← PUT (autosave del borrador, por cada cambio)
 *        │
 *        └─ POST enviar ─→ submitted ─→ graded (umbral, monedas 1 vez)
 *                                       └─ pendiente del profesor
 *   submitted/graded/rejected ──✗ 409: jamás regresan a in_progress.
 *
 * - El borrador guarda respuestas PARCIALES (incluso vacías) SIN
 *   veredicto: mientras el estudiante resuelve, la API no filtra nada
 *   de lo correcto (AGENTS.md §9.5). GET reexpone el borrador tal cual
 *   para retomarlo; tras el envío devuelve el resultado.
 * - Al ENVIAR, zod valida la estructura y exigirCompletitud garantiza
 *   que no falte ninguna respuesta (excepto preguntas file, que hoy
 *   no se pueden responder). Después corre la auto-calificación:
 *   veredicto por respuesta en el propio JSONB answers y, con el
 *   umbral del 80% de correctas, la transacción pasa la entrega a
 *   'graded' — fn_award_coins (BEFORE UPDATE OF status) acredita las
 *   monedas UNA vez (AGENTS.md §6: el backend jamás toca monedas).
 * - La inscripción no viaja en la petición: se deriva del token (la
 *   inscripción ACTIVA del estudiante en la clase de la actividad),
 *   así que un estudiante de otra clase ni siquiera pasa la regla
 *   'actividadVisible' (404 estándar, anti-enumeración).
 * - Una sola entrega por actividad e inscripción (uq_submission); la
 *   BD es la red de seguridad final ante carreras (P2002 → 409).
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autorizacion: AutorizacionService,
  ) {}

  /**
   * PUT /activities/:id/submissions — guarda o actualiza el BORRADOR
   * (autosave). Crea la entrega como 'in_progress' si no existe ninguna
   * o reemplaza las answers de la existente; en cualquier otro estado
   * responde 409 (regla del equipo: nunca se baja de submitted a
   * borrador).
   */
  async guardarBorrador(
    actividadId: string,
    dto: GuardarBorradorDto,
    usuario: UsuarioAutenticado,
  ): Promise<BorradorGuardadoRespuestaDto> {
    const contexto = await this.cargarContexto(actividadId, usuario);
    this.rechazarSiCerrada(contexto.cierraEn);

    // Estructura contra las preguntas reales, SIN veredicto: el
    // borrador jamás se evalúa (is_correct/score no existen aún).
    const respuestas = validarRespuestas(dto.respuestas, contexto.preguntas);

    // Actualizar SOLO si la entrega sigue en borrador: el filtro por
    // status hace el UPDATE atómico — un envío concurrente la deja sin
    // efecto y el paso siguiente lo detecta (imposible pisar una
    // entrega enviada).
    const actualizada = await this.prisma.submissions.updateMany({
      where: {
        activity_id: contexto.idActividad,
        enrollment_id: contexto.inscripcionId,
        status: 'in_progress',
      },
      data: { answers: respuestas },
    });

    if (actualizada.count === 0) {
      // No actualizó nada: o no existe la entrega, o ya no es borrador.
      const existente = await this.prisma.submissions.findUnique({
        where: {
          activity_id_enrollment_id: {
            activity_id: contexto.idActividad,
            enrollment_id: contexto.inscripcionId,
          },
        },
        select: { status: true },
      });
      if (existente !== null) {
        // Existe pero ya fue enviada/calificada: nunca baja de estado.
        throw new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA);
      }

      // No existe: crear el borrador (started_at por default de la BD,
      // submitted_at NULL: aún no se envía). Carrera con otra autosave
      // (P2002 de uq_submission): el borrador ya quedó creado por la
      // otra petición — reintentar la actualización condicional.
      try {
        await this.prisma.submissions.create({
          data: {
            activity_id: contexto.idActividad,
            enrollment_id: contexto.inscripcionId,
            status: 'in_progress',
            answers: respuestas,
          },
          select: { id: true },
        });
      } catch (error) {
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )) {
          throw error;
        }
        const reintentada = await this.prisma.submissions.updateMany({
          where: {
            activity_id: contexto.idActividad,
            enrollment_id: contexto.inscripcionId,
            status: 'in_progress',
          },
          data: { answers: respuestas },
        });
        if (reintentada.count === 0) {
          // La fila que apareció ya no es borrador: fue enviada al
          // instante entre ambas consultas.
          throw new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA);
        }
      }
    }

    const borrador = await this.prisma.submissions.findUniqueOrThrow({
      where: {
        activity_id_enrollment_id: {
          activity_id: contexto.idActividad,
          enrollment_id: contexto.inscripcionId,
        },
      },
      select: CAMPOS_ENTREGA,
    });
    if (borrador.status !== 'in_progress') {
      // Un envío concurrente cerró el borrador entre el guardado y la
      // lectura: no devolver un borrador que ya no lo es.
      throw new ConflictException(MENSAJE_ENTREGA_YA_ENVIADA);
    }

    return {
      mensaje: MENSAJE_BORRADOR_GUARDADO,
      entrega: this.aBorradorRespuesta(borrador),
    };
  }

  /**
   * GET /activities/:id/submissions — la entrega del estudiante para
   * esta actividad (la retomada del borrador):
   * - 'in_progress' → el borrador tal cual, SIN veredictos, para
   *   continuar donde se quedó.
   * - enviada/calificada → el resultado (veredictos, puntaje, monedas).
   * - 404 si todavía no existe ninguna.
   *
   * A diferencia de guardar/enviar, NO bloquea la actividad cerrada:
   * ver la propia entrega (o su resultado) no es entregar.
   */
  async miEntrega(
    actividadId: string,
    usuario: UsuarioAutenticado,
  ): Promise<EntregaBorradorRespuestaDto | EntregaRespuestaDto> {
    const contexto = await this.cargarContexto(actividadId, usuario);

    const entrega = await this.prisma.submissions.findUnique({
      where: {
        activity_id_enrollment_id: {
          activity_id: contexto.idActividad,
          enrollment_id: contexto.inscripcionId,
        },
      },
      select: CAMPOS_ENTREGA,
    });
    if (entrega === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    if (entrega.status === 'in_progress') {
      return this.aBorradorRespuesta(entrega);
    }
    if (entrega.submitted_at === null) {
      // Invariante: toda entrega enviada lleva submitted_at (lo setea
      // entregar() siempre).
      throw new Error('Entrega enviada sin fecha de envío (submitted_at).');
    }
    return this.aEntregaRespuesta(entrega, entrega.submitted_at);
  }

  /**
   * POST /activities/:id/submissions — ENVÍA la entrega definitiva.
   * Orden de rechazos (misma precedencia que la BD: el trigger
   * fn_validate_submission corre antes que uq_submission):
   * 404 no visible → 422 cerrada → 400 respuestas (estructura o
   * completitud) → 409 duplicada.
   *
   * Si hay borrador lo cierra (in_progress → submitted con las
   * respuestas finales del body); si no, crea la entrega enviada
   * directamente (responder y enviar en una sola sesión). Después,
   * con el umbral alcanzado, la MISMA transacción pasa a 'graded' —
   * fn_award_coins no dispara en el INSERT, solo en el UPDATE de status.
   */
  async entregar(
    actividadId: string,
    dto: CrearEntregaDto,
    usuario: UsuarioAutenticado,
  ): Promise<EntregaCreadaRespuestaDto> {
    const contexto = await this.cargarContexto(actividadId, usuario);
    this.rechazarSiCerrada(contexto.cierraEn);

    // Estructura (zod) + COMPLETITUD: al enviar no puede faltar ninguna
    // respuesta de la actividad (excepto preguntas file).
    const respuestas = validarRespuestas(dto.respuestas, contexto.preguntas);
    exigirCompletitud(respuestas, contexto.preguntas);

    // Auto-calificación (AGENTS.md §11.2): veredicto por respuesta en
    // el propio JSONB answers; con él se decide si la entrega pasa a
    // 'graded' (umbral del 80% de correctas, regla del equipo).
    const evaluacion = evaluarRespuestas(respuestas, contexto.preguntas);

    const entregadoEn = new Date();

    const entrega = await this.prisma.$transaction(async (tx) => {
      // ¿Ya existe una entrega de este estudiante para la actividad?
      const existente = await tx.submissions.findUnique({
        where: {
          activity_id_enrollment_id: {
            activity_id: contexto.idActividad,
            enrollment_id: contexto.inscripcionId,
          },
        },
        select: { id: true, status: true },
      });
      if (existente !== null && existente.status !== 'in_progress') {
        // Ya fue enviada (o calificada): una sola entrega por actividad.
        throw new ConflictException(MENSAJE_ENTREGA_DUPLICADA);
      }

      let enviada: EntregaEnBD;
      if (existente !== null) {
        // Cierra el borrador: las respuestas del body son las finales y
        // el veredicto de la evaluación viaja en el propio JSONB.
        enviada = await tx.submissions.update({
          where: { id: existente.id },
          data: {
            status: 'submitted',
            submitted_at: entregadoEn,
            answers: evaluacion.respuestas,
          },
          select: CAMPOS_ENTREGA,
        });
      } else {
        // Sin borrador: entrega directa (una sola sesión).
        enviada = await tx.submissions.create({
          data: {
            activity_id: contexto.idActividad,
            enrollment_id: contexto.inscripcionId,
            status: 'submitted',
            submitted_at: entregadoEn,
            answers: evaluacion.respuestas,
          },
          select: CAMPOS_ENTREGA,
        });
      }

      if (!evaluacion.alcanzaUmbral) {
        return enviada;
      }

      // §11.3: a 'graded' SOLO con el umbral. El UPDATE dispara
      // fn_award_coins: acredita las monedas, graded_at y coins_awarded
      // los setea la BD (AGENTS.md §6: el backend jamás los escribe).
      return tx.submissions.update({
        where: { id: enviada.id },
        data: {
          status: 'graded',
          score: evaluacion.puntaje,
        },
        select: CAMPOS_ENTREGA,
      });
    });

    const mensaje = evaluacion.alcanzaUmbral
      ? MENSAJE_ENTREGA_CALIFICADA
      : evaluacion.autoCalificable
        ? MENSAJE_ENTREGA_UMBRAL
        : MENSAJE_ENTREGA_PENDIENTE;

    return {
      mensaje,
      entrega: this.aEntregaRespuesta(entrega, entregadoEn),
    };
  }

  /**
   * Contexto común de los tres endpoints: pertenencia 'actividadVisible'
   * (segunda capa, AGENTS.md §8), id de ruta a BigInt, actividad
   * publicada con inscripción ACTIVA del estudiante (la misma regla
   * como consulta de datos) y la inscripción dueña de la entrega.
   */
  private async cargarContexto(
    actividadId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ContextoEntrega> {
    await this.autorizacion.verificarPertenencia(
      'actividadVisible',
      actividadId,
      usuario,
    );

    const idActividad = this.aBigInt(actividadId);
    const idEstudiante = BigInt(usuario.id);

    const actividad: ActividadParaEntrega | null =
      await this.prisma.activities.findFirst({
        where: {
          id: idActividad,
          status: 'published',
          classes: {
            enrollments: {
              some: { student_id: idEstudiante, status: 'active' },
            },
          },
        },
        select: CAMPOS_ACTIVIDAD_ENTREGA,
      });
    if (actividad === null) {
      // No inscritos (o draft/deleted/inexistente): el mismo 404 que
      // P2025 — no revela si la actividad existe (anti-enumeración).
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const inscripcion = await this.prisma.enrollments.findFirst({
      where: {
        class_id: actividad.class_id,
        student_id: idEstudiante,
        status: 'active',
      },
      select: { id: true },
    });
    if (inscripcion === null) {
      // Defensivo: la consulta anterior ya exigió la inscripción activa;
      // solo cambia si se retira exactamente entre ambas consultas.
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    return {
      idActividad,
      inscripcionId: inscripcion.id,
      preguntas: actividad.questions as Pregunta[],
      cierraEn: actividad.closes_at,
    };
  }

  /**
   * Guardar o enviar exige que la actividad siga vigente
   * (fn_validate_submission aplica lo mismo en el INSERT); VER la
   * propia entrega (GET) no — mirar el resultado no es entregar.
   */
  private rechazarSiCerrada(cierraEn: Date | null): void {
    if (cierraEn !== null && cierraEn.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(MENSAJE_ACTIVIDAD_CERRADA);
    }
  }

  /**
   * Convierte el id de ruta a BigInt con el 404 estándar si no es
   * numérico: mismo tratamiento que AutorizacionService.aBigInt, para
   * que ni siquiera el admin (que pasa la pertenencia sin consultar la
   * BD) provoque un 500 con un id malformado.
   */
  private aBigInt(valor: string): bigint {
    try {
      return BigInt(valor);
    } catch {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
  }

  /**
   * Mapper del borrador: respuestas tal cual se guardaron, SIN
   * is_correct/score (§9.5) y sin fecha de envío ni calificación.
   */
  private aBorradorRespuesta(
    entrega: EntregaEnBD,
  ): EntregaBorradorRespuestaDto {
    return {
      id: entrega.id.toString(),
      actividadId: entrega.activity_id.toString(),
      estado: 'in_progress',
      entregadoEn: null,
      puntaje: null,
      monedasOtorgadas: entrega.coins_awarded,
      // Validadas con zod antes de guardar: la estructura es la saneada
      // (question_position + option/text, sin is_correct/score).
      respuestas: entrega.answers as RespuestaEntrega[],
    };
  }

  /**
   * Mapper de la entrega enviada. `entregadoEn` sale del Date que el
   * Service envió al UPDATE/INSERT en el envío o del submitted_at de la
   * fila al leerla (GET). El puntaje es NUMERIC(6,2) → Prisma.Decimal:
   * se convierte explícitamente (AGENTS.md §7) y viaja null mientras la
   * entrega espera la calificación del profesor.
   */
  private aEntregaRespuesta(
    entrega: EntregaEnBD,
    entregadoEn: Date,
  ): EntregaRespuestaDto {
    return {
      id: entrega.id.toString(),
      actividadId: entrega.activity_id.toString(),
      estado: entrega.status,
      entregadoEn: entregadoEn.toISOString(),
      puntaje: entrega.score === null ? null : Number(entrega.score.toString()),
      monedasOtorgadas: entrega.coins_awarded,
      // Evaluadas por el backend antes de guardar (evaluarRespuestas):
      // question_position + option/text + is_correct/score.
      respuestas: entrega.answers as RespuestaCalificada[],
    };
  }
}
