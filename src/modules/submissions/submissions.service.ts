import {
  BadRequestException,
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
import type { ListarEntregasQueryDto } from './dto/listar-entregas.dto';
import type { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import { exigirCompletitud, validarRespuestas } from './dto/respuestas.schema';
import {
  evaluarRespuestas,
  type RespuestaCalificada,
} from './auto-calificacion';
import type {
  BorradorGuardadoRespuestaDto,
  CalificacionRespuestaDto,
  EntregaBorradorRespuestaDto,
  EntregaCreadaRespuestaDto,
  EntregaColaDto,
  EntregaDetalleProfesorDto,
  EntregaRespuestaDto,
  ListadoEntregasDto,
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

/** Éxito del profesor al calificar (decision='graded'). */
export const MENSAJE_ENTREGA_CALIFICADA_PROFESOR =
  'Entrega calificada: el estudiante ya puede ver el puntaje y tu retroalimentación.';

/** Éxito del profesor al rechazar (decision='rejected'). */
export const MENSAJE_ENTREGA_RECHAZADA =
  'Entrega rechazada: el estudiante verá tu retroalimentación y deberá reenviarla cuando ese flujo esté disponible.';

/** 400 al calificar como graded sin puntaje. */
export const MENSAJE_PUNTAJE_REQUERIDO =
  'Para calificar la entrega (decision=graded) debes enviar el puntaje total de la actividad.';

/** 400 al rechazar con puntaje: el rechazo no lleva nota. */
export const MENSAJE_PUNTAJE_NO_EN_RECHAZO =
  'No se envía puntaje al rechazar una entrega: la nota queda en null y el estudiante deberá reenviarla.';

/** 422 cuando el puntaje queda fuera del total de la actividad. */
export const MENSAJE_PUNTAJE_FUERA_DE_RANGO =
  'El puntaje debe estar entre 0 y el total de la actividad.';

/**
 * 409 al calificar una entrega que ya no está 'submitted' — incluye la
 * RE-calificación de una 'graded': el UPDATE atómico filtra por
 * status='submitted', así el trigger fn_award_coins no puede otorgar
 * dos veces las monedas de la misma entrega.
 */
export const MENSAJE_ENTREGA_NO_PENDIENTE =
  'La entrega ya no está pendiente de calificación: solo las enviadas (submitted) pueden calificarse y el estado no se recalifica.';

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
  feedback: string | null;
  answers: Prisma.JsonValue;
}

/**
 * Fila de la cola del profesor: el resumen de la entrega MÁS los datos
 * del estudiante (join enrollments → users) — para calificar hace falta
 * saber quién entregó. Sin answers: el listado es un resumen.
 */
interface EntregaColaEnBD {
  id: bigint;
  status: submission_status;
  submitted_at: Date | null;
  score: Prisma.Decimal | null;
  coins_awarded: number;
  enrollments: {
    users: {
      id: bigint;
      username: string;
      first_name: string;
      last_name: string;
    };
  };
}

/**
 * Fila de la VISTA DE REVISIÓN: todo lo de la fila de la cola MÁS el
 * answers JSONB (con veredicto por respuesta), el feedback y graded_at
 * — lo que el profesor necesita para decidir la calificación.
 */
interface EntregaDetalleEnBD {
  id: bigint;
  status: submission_status;
  submitted_at: Date | null;
  graded_at: Date | null;
  score: Prisma.Decimal | null;
  coins_awarded: number;
  feedback: string | null;
  answers: Prisma.JsonValue;
  enrollments: {
    users: {
      id: bigint;
      username: string;
      first_name: string;
      last_name: string;
    };
  };
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

/** Solo las preguntas: la calificación valida el puntaje contra su total. */
const CAMPOS_ACTIVIDAD_PREGUNTAS = {
  questions: true,
} as const;

const CAMPOS_ENTREGA = {
  id: true,
  activity_id: true,
  status: true,
  submitted_at: true,
  score: true,
  coins_awarded: true,
  feedback: true,
  answers: true,
} as const;

/**
 * Select de la fila de la cola del profesor: resumen de la entrega +
 * estudiante dueño (enrollments → users). Sin answers ni activity_id:
 * ambos son conocidos por el contexto de la propia cola.
 */
const CAMPOS_ENTREGA_COLA = {
  id: true,
  status: true,
  submitted_at: true,
  score: true,
  coins_awarded: true,
  enrollments: {
    select: {
      users: {
        select: { id: true, username: true, first_name: true, last_name: true },
      },
    },
  },
} as const;

/**
 * Select de la VISTA DE REVISIÓN: la fila de la cola MÁS answers (con
 * veredicto por respuesta), feedback y graded_at. El activity_id no
 * viaja: ya viene en la ruta (y el where lo exige).
 */
const CAMPOS_ENTREGA_DETALLE = {
  id: true,
  status: true,
  submitted_at: true,
  graded_at: true,
  score: true,
  coins_awarded: true,
  feedback: true,
  answers: true,
  enrollments: {
    select: {
      users: {
        select: { id: true, username: true, first_name: true, last_name: true },
      },
    },
  },
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
   * GET /activities/:id/submissions/queue — cola de calificación del
   * profesor: TODAS las entregas de SU actividad con la paginación
   * estándar { data, meta } y filtro opcional por estado (?estado del
   * enum submission_status). El caso principal es ?estado=submitted:
   * las que esperan su revisión (docs/flujo_entregas.md §10 — la
   * calificación misma viene después).
   *
   * Orden FIFO por submitted_at ASCENDENTE (PostgreSQL manda los NULL
   * al final: los borradores in_progress quedan últimos): una cola de
   * calificación atiende primero lo más antiguo.
   *
   * Pertenencia: regla 'actividad' — la clase de la actividad es suya.
   * El estudiante no pasa RolesGuard (403) y un profesor ajeno recibe
   * el 404 estándar anti-enumeración antes de llegar aquí.
   */
  async cola(
    actividadId: string,
    query: ListarEntregasQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoEntregasDto> {
    // Segunda capa de pertenencia (AGENTS.md §8): el guard HTTP ya
    // verificó :id de ruta; el service también es seguro en flujos
    // internos.
    await this.autorizacion.verificarPertenencia(
      'actividad',
      actividadId,
      usuario,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      activity_id: this.aBigInt(actividadId),
      ...(query.estado !== undefined ? { status: query.estado } : {}),
    };

    const filas = await this.prisma.submissions.findMany({
      where,
      select: CAMPOS_ENTREGA_COLA,
      orderBy: { submitted_at: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const total = await this.prisma.submissions.count({ where });

    return {
      data: filas.map((fila) => this.aEntregaCola(fila)),
      meta: { total, page, limit },
    };
  }

  /**
   * GET /activities/:id/submissions/:entregaId — VISTA DE REVISIÓN del
   * profesor: la entrega con sus respuestas (veredicto por respuesta),
   * el estudiante dueño y, si ya fue calificada, el resultado y el
   * feedback. Es el paso entre la cola (que lista las 'submitted') y
   * calificar: sin answers no hay nada que revisar. Es también la
   * única vista que expone answers a alguien distinto del estudiante
   * dueño (AGENTS.md §9.5) — el dueño de la actividad es quien califica.
   */
  async detalle(
    actividadId: string,
    entregaId: string,
    usuario: UsuarioAutenticado,
  ): Promise<EntregaDetalleProfesorDto> {
    // Segunda capa de pertenencia (AGENTS.md §8): el guard ya verificó
    // :id de ruta con la regla 'actividad'.
    await this.autorizacion.verificarPertenencia(
      'actividad',
      actividadId,
      usuario,
    );

    // El where exige la relación entrega↔actividad en la MISMA
    // consulta: una entrega de otra actividad es 404, igual que una
    // inexistente (anti-enumeración).
    const entrega = await this.prisma.submissions.findFirst({
      where: {
        id: this.aBigInt(entregaId),
        activity_id: this.aBigInt(actividadId),
      },
      select: CAMPOS_ENTREGA_DETALLE,
    });
    if (entrega === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    return this.aEntregaDetalleProfesor(entrega);
  }

  /**
   * POST /activities/:id/submissions/:entregaId/calificar — transición
   * definitiva del profesor: 'submitted' → graded (con puntaje) o
   * rejected (sin puntaje; el estudiante reenviará cuando exista ese
   * flujo, docs/flujo_entregas.md §10).
   *
   * Monedas y graded_at los escribe el TRIGGER fn_award_coins en la
   * transición a 'graded' (AGENTS.md §6: el backend jamás los toca):
   * el UPDATE de este método solo lleva status/score/feedback/graded_by
   * y se re-lee la fila para devolver lo que la BD acreditó.
   *
   * Anti-recalificación (regla del equipo): el UPDATE es atómico y
   * filtra por status='submitted' — una entrega 'graded' (o 'rejected',
   * o un borrador) NUNCA se vuelve a tocar, así el trigger no puede
   * otorgar dos veces las monedas de la misma entrega ni pisar un
   * veredicto ya dado.
   */
  async calificar(
    actividadId: string,
    entregaId: string,
    dto: CalificarEntregaDto,
    usuario: UsuarioAutenticado,
  ): Promise<CalificacionRespuestaDto> {
    // Segunda capa de pertenencia (AGENTS.md §8): SOLO el dueño de la
    // clase de la actividad califica; un profesor ajeno ya recibió el
    // 404 estándar en el guard.
    await this.autorizacion.verificarPertenencia(
      'actividad',
      actividadId,
      usuario,
    );

    const idActividad = this.aBigInt(actividadId);
    const idEntrega = this.aBigInt(entregaId);

    // Preguntas reales: el puntaje se valida contra el TOTAL de la
    // actividad (validación doble, AGENTS.md §6 — el DTO valida forma).
    const actividad = await this.prisma.activities.findFirst({
      where: { id: idActividad },
      select: CAMPOS_ACTIVIDAD_PREGUNTAS,
    });
    if (actividad === null) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }

    const preguntas = actividad.questions as Pregunta[];
    if (dto.decision === 'graded') {
      if (dto.puntaje === undefined) {
        throw new BadRequestException(MENSAJE_PUNTAJE_REQUERIDO);
      }
      this.rechazarSiPuntajeFueraDeRango(dto.puntaje, preguntas);
    } else if (dto.puntaje !== undefined) {
      // 'rejected' no lleva nota: el score queda null y el estudiante
      // deberá reenviar cuando ese flujo exista (§10).
      throw new BadRequestException(MENSAJE_PUNTAJE_NO_EN_RECHAZO);
    }

    // UPDATE atómico SOLO sobre 'submitted': recalificar una 'graded'
    // queda sin efecto aquí (count 0 → 409 en el paso siguiente) — el
    // status no se reescribe y el trigger no vuelve a disparar.
    const actualizada = await this.prisma.submissions.updateMany({
      where: {
        id: idEntrega,
        activity_id: idActividad,
        status: 'submitted',
      },
      data: {
        status: dto.decision,
        ...(dto.decision === 'graded' ? { score: dto.puntaje } : {}),
        ...(dto.feedback !== undefined ? { feedback: dto.feedback } : {}),
        graded_by: BigInt(usuario.id),
      },
    });
    if (actualizada.count === 0) {
      // No actualizó: o no existe (o es de otra actividad) → 404, o ya
      // no está 'submitted' → 409. Distinguir con una lectura.
      const existente = await this.prisma.submissions.findFirst({
        where: { id: idEntrega, activity_id: idActividad },
        select: { status: true },
      });
      if (existente === null) {
        throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
      }
      throw new ConflictException(MENSAJE_ENTREGA_NO_PENDIENTE);
    }

    // Re-lectura: el trigger escribió graded_at/coins_awarded al pasar
    // a 'graded' — la respuesta devuelve la fila tal como quedó.
    const entrega = await this.prisma.submissions.findFirst({
      where: { id: idEntrega, activity_id: idActividad },
      select: CAMPOS_ENTREGA_DETALLE,
    });
    if (entrega === null) {
      // Defensivo: la fila acaba de existir en el updateMany.
      throw new Error('La entrega calificada desapareció de la BD.');
    }

    return {
      mensaje:
        dto.decision === 'graded'
          ? MENSAJE_ENTREGA_CALIFICADA_PROFESOR
          : MENSAJE_ENTREGA_RECHAZADA,
      entrega: this.aEntregaDetalleProfesor(entrega),
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
   * El puntaje del profesor no puede salirse de la actividad: 0..
   * total (la suma de los score de sus preguntas). Misma forma que
   * rechazarSiCerrada: validación semántica contra el recurso → 422.
   */
  private rechazarSiPuntajeFueraDeRango(
    puntaje: number,
    preguntas: Pregunta[],
  ): void {
    const total = preguntas.reduce(
      (suma, pregunta) => suma + pregunta.score,
      0,
    );
    if (puntaje < 0 || puntaje > total) {
      throw new UnprocessableEntityException(MENSAJE_PUNTAJE_FUERA_DE_RANGO);
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
      // La retroalimentación del profesor viaja al estudiante: null
      // hasta que la entrega sea calificada/rechazada.
      feedback: entrega.feedback,
      // Evaluadas por el backend antes de guardar (evaluarRespuestas):
      // question_position + option/text + is_correct/score.
      respuestas: entrega.answers as RespuestaCalificada[],
    };
  }

  /**
   * Mapper de la VISTA DE REVISIÓN del profesor: la fila de la cola
   * (estudiante incluido) MÁS answers con veredicto, feedback y
   * graded_at (calificadoEn). Mismas conversiones que siempre:
   * BigInt→string y Decimal→number (AGENTS.md §7).
   */
  private aEntregaDetalleProfesor(
    entrega: EntregaDetalleEnBD,
  ): EntregaDetalleProfesorDto {
    return {
      id: entrega.id.toString(),
      estudiante: {
        id: entrega.enrollments.users.id.toString(),
        usuario: entrega.enrollments.users.username,
        nombre: entrega.enrollments.users.first_name,
        apellido: entrega.enrollments.users.last_name,
      },
      estado: entrega.status,
      entregadoEn:
        entrega.submitted_at === null
          ? null
          : entrega.submitted_at.toISOString(),
      // graded_at lo setea el trigger SOLO en → graded: en 'rejected'
      // queda null (la BD no lo marca como calificada).
      calificadoEn:
        entrega.graded_at === null ? null : entrega.graded_at.toISOString(),
      puntaje: entrega.score === null ? null : Number(entrega.score.toString()),
      monedasOtorgadas: entrega.coins_awarded,
      feedback: entrega.feedback,
      respuestas: entrega.answers as RespuestaCalificada[],
    };
  }

  /**
   * Mapper de la fila de la cola del profesor: BigInt → string y el
   * puntaje NUMERIC(6,2) → number (Prisma.Decimal) — mismo tratamiento
   * que aEntregaRespuesta (AGENTS.md §7). El estudiante sale del join
   * enrollments → users: la fila ES la entrega de ese estudiante.
   */
  private aEntregaCola(entrega: EntregaColaEnBD): EntregaColaDto {
    return {
      id: entrega.id.toString(),
      estudiante: {
        id: entrega.enrollments.users.id.toString(),
        usuario: entrega.enrollments.users.username,
        nombre: entrega.enrollments.users.first_name,
        apellido: entrega.enrollments.users.last_name,
      },
      estado: entrega.status,
      entregadoEn:
        entrega.submitted_at === null
          ? null
          : entrega.submitted_at.toISOString(),
      puntaje: entrega.score === null ? null : Number(entrega.score.toString()),
      monedasOtorgadas: entrega.coins_awarded,
    };
  }
}
