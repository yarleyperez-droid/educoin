import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type {
  item_status,
  item_type,
  redemption_status,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  aCanjeListado,
  aCanjeRespuesta,
  aTextoPuntos,
  evaluarCanje,
  mensajeDeError,
  mensajeDeMotivo,
} from './canje.util';
import type { FilaCanjeListado } from './canje.util';
import type {
  CanjeRespuestaDto,
  ListadoCanjesDto,
  PrevisualizacionCanjeDto,
  ResolucionCanjeDto,
} from './dto/canje-respuesta.dto';
import type { ListarCanjesQueryDto } from './dto/listar-canjes.query.dto';

/** El ítem pedido no existe (o su id no es numérico: mismo 404, anti-enumeración). */
export const MENSAJE_ITEM_NO_EXISTE = 'El ítem solicitado no existe.';

/** El estudiante no tiene inscripción activa en la clase del ítem. */
export const MENSAJE_SIN_INSCRIPCION =
  'No estás inscrito en la clase de ese ítem.';

/** El canje pedido no existe (o no es del solicitante: mismo 404, anti-enumeración). */
export const MENSAJE_CANJE_NO_EXISTE = 'El canje solicitado no existe.';

/** El canje ya salió del estado que admite la operación (contrato H7.2, §3.2). */
export const MENSAJE_CANJE_YA_RESUELTO = 'El canje ya fue resuelto';

/** El profesor autenticado no imparte la clase de la inscripción del canje. */
export const MENSAJE_SIN_PERMISO_RESOLVER =
  'No tienes permiso para resolver este canje';

/** Ids admitidos (BIGINT como string). */
const ID_VALIDO = /^\d+$/;

/** Fila de inscripción usada para el saldo y el bloqueo. */
interface FilaInscripcion {
  id: bigint;
  coins_available: number;
}

/** Fila de ítem canjeable leída con bloqueo (con su clase y su política). */
interface FilaItemBloqueo {
  id: bigint;
  class_id: bigint;
  name: string;
  cost_coins: number;
  stock: number | null;
  status: item_status;
  auto_approve: boolean;
  teacher_id: bigint;
}

/** Fila completa del ítem (la que necesita la previsualización). */
interface FilaItemCompleta {
  id: bigint;
  class_id: bigint;
  name: string;
  cost_coins: number;
  stock: number | null;
  status: item_status;
  type: item_type;
  grade_points: unknown;
}

/** Fila de canje con su clase, para la resolución del profesor. */
interface FilaResolucion {
  id: bigint;
  status: redemption_status;
  resolved_at: Date | null;
  teacher_id: bigint;
}

/**
 * Servicio de canje revisable (H4.4 / PRO-282 + H7.2 / PRO-447).
 *
 * El negocio FUERTE vive en la BD (§12.6–12.8 de `db/001_schema.sql` y la
 * migración `20261110000001_canje_revisable_esquema`):
 * - `fn_execute_redemption` (BEFORE INSERT): congela `cost_coins` y
 *   `grade_points` del ítem vigente y descuenta stock (con `FOR UPDATE`).
 * - `fn_register_redemption` (AFTER INSERT): registra el movimiento
 *   `spending`; si las monedas no alcanzan, `ck_enrollment_no_negative`
 *   falla y **toda** la operación (incluido el stock) se revierte.
 * - `fn_reverse_redemption` (AFTER UPDATE OF status): devuelve monedas
 *   (`reversal`) y stock al anular (`reversed`, legado del MVP) y al
 *   rechazar (`pending → rejected`, nuevo; §2.4 de la propuesta).
 *
 * Este service solo ORQUESTA: lee el saldo/stock para la previsualización,
 * pre-valida dentro de la transacción (mensajes claros en español antes de
 * chocar con un constraint), escribe en `redemptions` y traduce los estados
 * del contrato (`pending → approved → delivered`, `pending → rejected`).
 * No reimplementa ninguna regla de la BD: **nunca** inserta en
 * `coin_movements` ni toca contadores (AGENTS.md §6).
 *
 * Flujo revisable (H7.2, §3 de la propuesta):
 * - La solicitud nace `pending` (reserva: stock −1 y monedas −costo).
 * - Si el ítem tiene `auto_approve`, la misma transacción lo deja
 *   `approved` (resolved_by = profesor de la clase, §2.6).
 * - El profesor aprueba (`pending → approved`) o rechaza
 *   (`pending → rejected`, con reversión íntegra por trigger) y entrega
 *   (`approved → delivered`). La auditoría (`resolved_by`/`resolved_at`)
 *   la escribe la aplicación en un solo UPDATE: el trigger es AFTER
 *   UPDATE, donde escribir en NEW no persiste (hallazgo spec 025).
 */
@Injectable()
export class RedemptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Previsualiza un canje: costo, saldo y stock del ítem para el
   * estudiante autenticado, con la decisión `puedeCanjear` (T4.4.1).
   *
   * @param itemId Id del ítem (string numérico).
   * @param usuario Estudiante autenticado (rol garantizado por @Roles).
   * @returns Datos de la previsualización.
   * @throws NotFoundException 404 si el ítem no existe o no está inscrito en su clase.
   */
  async previsualizarCanje(
    itemId: string,
    usuario: UsuarioAutenticado,
  ): Promise<PrevisualizacionCanjeDto> {
    const item = await this.leerItem(itemId);
    const inscripcion = await this.leerInscripcion(
      BigInt(usuario.id),
      item.class_id,
    );

    const costo = Number(item.cost_coins);
    const stock = item.stock === null ? null : Number(item.stock);
    const monedasDisponibles = Number(inscripcion.coins_available);
    const evaluacion = evaluarCanje({
      costoMonedas: costo,
      monedasDisponibles,
      stock,
      disponible: item.status === 'active',
    });

    return {
      item: {
        id: String(item.id),
        nombre: item.name,
        tipo: item.type,
        costoMonedas: costo,
        stock,
        puntosNota: aTextoPuntos(item.grade_points),
        disponible: item.status === 'active',
      },
      saldo: { monedasDisponibles },
      puedeCanjear: evaluacion.puedeCanjear,
      motivo: evaluacion.puedeCanjear
        ? null
        : mensajeDeMotivo(evaluacion.motivo, costo, monedasDisponibles),
    };
  }

  /**
   * Solicita un canje de forma atómica (T4.4.2 + T7.2.2 · CAs 1-3).
   *
   * Todo ocurre dentro de una `prisma.$transaction` (una sola transacción
   * SQL): se bloquean con `FOR UPDATE` la inscripción (saldo) y el ítem,
   * se pre-valida con mensajes claros y se inserta la fila en
   * `redemptions` **en `pending` explícito** (decisión 4 de la propuesta:
   * el `DEFAULT 'completed'` de la BD no se toca), cuyo trigger congela el
   * costo y descuenta stock y monedas. Si algo falla después del INSERT
   * (p. ej. el constraint de saldo), la transacción entera revierte: ni
   * saldo ni stock cambian y NO queda fila creada.
   *
   * **Auto-aprobación** (§2.6): si el ítem tiene `auto_approve`, la MISMA
   * transacción ejecuta `pending → approved` con `resolved_by` = profesor
   * de la clase (autor de la política) y `resolved_at` = ahora. La
   * respuesta refleja el estado final (`pending` o `approved`).
   *
   * El `FOR UPDATE` de la inscripción serializa canjes concurrentes del
   * mismo estudiante; el `FOR UPDATE` del ítem (en el trigger) serializa
   * el último unitario entre estudiantes distintos.
   *
   * @param itemId Id del ítem (string numérico).
   * @param usuario Estudiante autenticado.
   * @returns El canje `pending` (o `approved` si auto-aprueba) con el costo congelado por la BD.
   * @throws NotFoundException 404 (ítem o inscripción inexistente).
   * @throws UnprocessableEntityException 422 (inactivo, sin stock o saldo insuficiente).
   */
  async canjear(
    itemId: string,
    usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    const idItem = BigInt(itemId);
    const idEstudiante = BigInt(usuario.id);

    return this.prisma.$transaction(async (tx) => {
      const inscripciones = await tx.$queryRaw<FilaInscripcion[]>(Prisma.sql`
        SELECT e.id, e.coins_available
        FROM enrollments e
        WHERE e.student_id = ${idEstudiante}
          AND e.status = 'active'
          AND e.class_id = (SELECT class_id FROM redeemable_items WHERE id = ${idItem})
        FOR UPDATE
      `);
      if (inscripciones.length === 0) {
        throw new NotFoundException(MENSAJE_SIN_INSCRIPCION);
      }

      const items = await tx.$queryRaw<FilaItemBloqueo[]>(Prisma.sql`
        SELECT i.id, i.class_id, i.name, i.cost_coins, i.stock, i.status,
               i.auto_approve, c.teacher_id
        FROM redeemable_items i
        JOIN classes c ON c.id = i.class_id
        WHERE i.id = ${idItem}
        FOR UPDATE
      `);
      if (items.length === 0) {
        throw new NotFoundException(MENSAJE_ITEM_NO_EXISTE);
      }

      const item = items[0];
      const inscripcion = inscripciones[0];
      const costo = Number(item.cost_coins);
      const stock = item.stock === null ? null : Number(item.stock);
      const monedasDisponibles = Number(inscripcion.coins_available);

      const evaluacion = evaluarCanje({
        costoMonedas: costo,
        monedasDisponibles,
        stock,
        disponible: item.status === 'active',
      });
      if (!evaluacion.puedeCanjear) {
        // 422 con los mensajes EXACTOS del contrato de H7.2 (decisión 5).
        throw new UnprocessableEntityException(mensajeDeError(evaluacion.motivo));
      }

      // El INSERT dispara los triggers: congelado de costo/puntos, stock
      // -1 y movimiento `spending`. cost_coins se envía solo para cumplir
      // el NOT NULL de la columna; el trigger lo pisa con el valor vigente.
      const solicitado = await tx.redemptions.create({
        data: {
          enrollment_id: inscripcion.id,
          item_id: item.id,
          cost_coins: costo,
          status: 'pending',
        },
      });

      if (item.auto_approve) {
        // Auto-aprobación (§2.6): pending → approved en la misma
        // transacción. La auditoría la escribe la APP (el trigger es AFTER
        // UPDATE y NEW no persiste); el trigger no toca monedas/stock aquí.
        const aprobado = await tx.redemptions.update({
          where: { id: solicitado.id },
          data: {
            status: 'approved',
            resolved_by: item.teacher_id,
            resolved_at: new Date(),
          },
        });
        return aCanjeRespuesta(aprobado, item.name, true);
      }

      return aCanjeRespuesta(solicitado, item.name, false);
    });
  }

  /**
   * Anula un canje propio **`completed`** (T4.4.3 · CA 4, legado del MVP).
   *
   * **Restricción H7.2 (decisión 5):** el flujo instantáneo se retira — la
   * solicitud ya nace `pending` y la reversión de monedas/stock solo la
   * dispara el rechazo del profesor (`pending → rejected`). Por eso esta
   * anulación estudiantil solo aplica a canjes `completed` heredados del
   * MVP; cualquier otro estado responde 409 `El canje ya fue resuelto`.
   *
   * El UPDATE de `status` dispara `fn_reverse_redemption`, que devuelve
   * las monedas (movimiento `reversal`) y repone el stock (si era
   * limitado). El service solo exige dueño y estado, y **sella
   * `reversed_at` desde la aplicación**: el trigger es AFTER UPDATE, donde
   * escribir en NEW no persiste (hallazgo verificado en los e2e; la regla
   * de negocio —monedas y stock— sigue siendo 100% de la BD).
   *
   * Decisión de negocio (spec 025 §Supuestos 1): **anula el estudiante
   * dueño del canje**; una anulación por profesor/admin sería otra historia.
   *
   * @param canjeId Id del canje (string numérico).
   * @param usuario Estudiante autenticado (dueño).
   * @returns El canje `reversed` con su fecha de reversión.
   * @throws NotFoundException 404 (inexistente o ajeno; mismo mensaje, anti-enumeración).
   * @throws ConflictException 409 si no está en `completed` (ya resuelto).
   */
  async anular(
    canjeId: string,
    usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    if (!ID_VALIDO.test(canjeId)) {
      throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
    }

    return this.prisma.$transaction(async (tx) => {
      const canje = await tx.redemptions.findUnique({
        where: { id: BigInt(canjeId) },
      });
      if (canje === null) {
        throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
      }

      // Segunda capa (AGENTS.md §8): el canje solo es visible/manejable por
      // el estudiante de su inscripción; ajeno ⇒ mismo 404 que inexistente.
      const inscripcion = await tx.enrollments.findUnique({
        where: { id: canje.enrollment_id },
        select: { student_id: true },
      });
      if (inscripcion?.student_id !== BigInt(usuario.id)) {
        throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
      }

      if (canje.status !== 'completed') {
        throw new ConflictException(MENSAJE_CANJE_YA_RESUELTO);
      }

      const actualizado = await tx.redemptions.update({
        where: { id: canje.id },
        data: { status: 'reversed', reversed_at: new Date() },
      });

      const item = await tx.redeemable_items.findUnique({
        where: { id: canje.item_id },
        select: { name: true, auto_approve: true },
      });

      return aCanjeRespuesta(
        actualizado,
        item?.name ?? '',
        item?.auto_approve ?? false,
      );
    });
  }

  /**
   * Aprueba un canje `pending` (T7.2.3 · transición 1 del contrato §3.2).
   *
   * Un solo UPDATE escribe `status` + `resolved_by` + `resolved_at`; no se
   * generan movimientos ni se tocan monedas/stock.
   *
   * @param canjeId Id del canje (string numérico).
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `approved` con su `resueltoEn`.
   * @throws NotFoundException 404 (canje inexistente).
   * @throws ForbiddenException 403 (no imparte la clase del canje).
   * @throws ConflictException 409 (ya resuelto).
   */
  async aprobar(
    canjeId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.resolver(canjeId, usuario, 'aprobar');
  }

  /**
   * Rechaza un canje `pending` (T7.2.3 · transición 3 del contrato §3.2).
   *
   * Un solo UPDATE escribe `status = 'rejected'` + `resolved_by` +
   * `resolved_at`; **la devolución íntegra de monedas y stock la hace el
   * trigger** `fn_reverse_redemption` en esa misma transacción (1 solo
   * `reversal`, garantizado por `uq_movement_reversal`). El backend nunca
   * inserta en `coin_movements` (AGENTS.md §6). Si el trigger falla, la
   * transacción completa se aborta (nunca un `rejected` sin devolución).
   *
   * `reversed_at` NO se llena (decisión 6: conserva la semántica de
   * "anulación del estudiante"; la devolución del rechazo queda atada a
   * `resolved_at`).
   *
   * @param canjeId Id del canje (string numérico).
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `rejected` con su `resueltoEn`.
   * @throws NotFoundException 404 (canje inexistente).
   * @throws ForbiddenException 403 (no imparte la clase del canje).
   * @throws ConflictException 409 (ya resuelto).
   */
  async rechazar(
    canjeId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.resolver(canjeId, usuario, 'rechazar');
  }

  /**
   * Marca un canje `approved` como entregado (T7.2.3 · transición 2 del
   * contrato §3.2): `approved → delivered`, siempre manual (la
   * auto-aprobación NO entrega). Solo cambia `status`; la auditoría ya
   * quedó al aprobar y no hay movimientos (§3.2, fila 2).
   *
   * @param canjeId Id del canje (string numérico).
   * @param usuario Profesor autenticado (debe impartir la clase del canje).
   * @returns El canje `delivered` (con el `resueltoEn` de su aprobación).
   * @throws NotFoundException 404 (canje inexistente).
   * @throws ForbiddenException 403 (no imparte la clase del canje).
   * @throws ConflictException 409 (no venía de `approved`).
   */
  async entregar(
    canjeId: string,
    usuario: UsuarioAutenticado,
  ): Promise<ResolucionCanjeDto> {
    return this.resolver(canjeId, usuario, 'entregar');
  }

  /**
   * Cola de pendientes del profesor (T7.2.4): canjes `pending` de SUS
   * clases, ordenados por `redeemed_at` (FIFO) y paginados con la
   * envoltura estándar `{ data, meta }`. Alimenta `idx_redemptions_pending`.
   *
   * @param dto Paginación opcional (`page`, `limit`).
   * @param usuario Profesor autenticado (rol garantizado por @Roles).
   * @returns Filas de la cola con `{ data, meta }`.
   */
  async colaPendientes(
    dto: ListarCanjesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoCanjesDto> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const idProfesor = BigInt(usuario.id);

    const filas = await this.prisma.$queryRaw<FilaCanjeListado[]>(Prisma.sql`
      SELECT r.id, r.cost_coins, r.status, r.redeemed_at,
             i.name AS item_name,
             u.first_name AS student_first_name,
             u.last_name AS student_last_name
      FROM redemptions r
      JOIN enrollments e ON e.id = r.enrollment_id
      JOIN users u ON u.id = e.student_id
      JOIN redeemable_items i ON i.id = r.item_id
      WHERE r.status = 'pending'
        AND e.class_id IN (SELECT c.id FROM classes c WHERE c.teacher_id = ${idProfesor})
      ORDER BY r.redeemed_at ASC, r.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // El total se cuenta aparte: un count(*) OVER() lo perdería en páginas
    // sin filas (mismo criterio que wallet.historial).
    const conteo = await this.prisma.$queryRaw<
      { total: bigint | number | string }[]
    >(Prisma.sql`
      SELECT count(*) AS total
      FROM redemptions r
      JOIN enrollments e ON e.id = r.enrollment_id
      WHERE r.status = 'pending'
        AND e.class_id IN (SELECT c.id FROM classes c WHERE c.teacher_id = ${idProfesor})
    `);

    return {
      data: filas.map((fila) => aCanjeListado(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }

  /**
   * Historial de canjes del estudiante (T7.2.5): los canjes de SUS
   * inscripciones, ordenados por solicitud descendente (más recientes
   * primero) y paginados con `{ data, meta }`.
   *
   * @param dto Paginación opcional (`page`, `limit`).
   * @param usuario Estudiante autenticado (rol garantizado por @Roles).
   * @returns Sus canjes con `{ data, meta }`.
   */
  async historial(
    dto: ListarCanjesQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ListadoCanjesDto> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const idEstudiante = BigInt(usuario.id);

    const filas = await this.prisma.$queryRaw<FilaCanjeListado[]>(Prisma.sql`
      SELECT r.id, r.cost_coins, r.status, r.redeemed_at,
             i.name AS item_name,
             u.first_name AS student_first_name,
             u.last_name AS student_last_name
      FROM redemptions r
      JOIN enrollments e ON e.id = r.enrollment_id
      JOIN users u ON u.id = e.student_id
      JOIN redeemable_items i ON i.id = r.item_id
      WHERE e.student_id = ${idEstudiante}
      ORDER BY r.redeemed_at DESC, r.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const conteo = await this.prisma.$queryRaw<
      { total: bigint | number | string }[]
    >(Prisma.sql`
      SELECT count(*) AS total
      FROM redemptions r
      JOIN enrollments e ON e.id = r.enrollment_id
      WHERE e.student_id = ${idEstudiante}
    `);

    return {
      data: filas.map((fila) => aCanjeListado(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }

  /**
   * Núcleo de las resoluciones del profesor (aprobar/rechazar/entregar).
   *
   * En una sola `prisma.$transaction`: `SELECT … FOR UPDATE` (serializa
   * resoluciones concurrentes), autorización por recurso, guard de
   * transición y un ÚNICO `UPDATE` de resolución. Si el trigger de
   * reversión falla (rechazo), TODO aborta.
   *
   * @param canjeId Id del canje (string numérico).
   * @param usuario Profesor autenticado.
   * @param accion Resolución pedida.
   * @returns El canje resuelto con su `resueltoEn`.
   * @throws NotFoundException 404 (canje inexistente; mismo mensaje, anti-enumeración).
   * @throws ForbiddenException 403 (no imparte la clase del canje).
   * @throws ConflictException 409 (transición inválida: ya resuelto).
   */
  private async resolver(
    canjeId: string,
    usuario: UsuarioAutenticado,
    accion: 'aprobar' | 'rechazar' | 'entregar',
  ): Promise<ResolucionCanjeDto> {
    if (!ID_VALIDO.test(canjeId)) {
      throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
    }
    const idProfesor = BigInt(usuario.id);

    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<FilaResolucion[]>(Prisma.sql`
        SELECT r.id, r.status, r.resolved_at, c.teacher_id
        FROM redemptions r
        JOIN enrollments e ON e.id = r.enrollment_id
        JOIN classes c ON c.id = e.class_id
        WHERE r.id = ${BigInt(canjeId)}
        FOR UPDATE
      `);
      const fila = filas[0];
      if (fila === undefined) {
        throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
      }

      // Autorización por recurso (AGENTS.md §9.7): el resolvente debe
      // impartir la clase de la inscripción del canje.
      if (fila.teacher_id !== idProfesor) {
        throw new ForbiddenException(MENSAJE_SIN_PERMISO_RESOLVER);
      }

      // Guard de transición (contrato §3.2): solo pending→approved/rejected
      // y approved→delivered; cualquier otra combinación ⇒ 409.
      const estadoOrigen: redemption_status =
        accion === 'entregar' ? 'approved' : 'pending';
      if (fila.status !== estadoOrigen) {
        throw new ConflictException(MENSAJE_CANJE_YA_RESUELTO);
      }

      if (accion === 'entregar') {
        const entregado = await tx.redemptions.update({
          where: { id: fila.id },
          data: { status: 'delivered' },
        });
        return this.aResolucion({
          id: entregado.id,
          status: entregado.status,
          resolved_at: entregado.resolved_at ?? fila.resolved_at,
        });
      }

      // aprobar | rechazar: UN solo UPDATE con status + resolved_by +
      // resolved_at. Al rechazar, el trigger devuelve monedas y stock en
      // esta misma transacción (§2.4); el backend no toca movimientos.
      const resuelto = await tx.redemptions.update({
        where: { id: fila.id },
        data: {
          status: accion === 'aprobar' ? 'approved' : 'rejected',
          resolved_by: idProfesor,
          resolved_at: new Date(),
        },
      });
      return this.aResolucion({
        id: resuelto.id,
        status: resuelto.status,
        resolved_at: resuelto.resolved_at,
      });
    });
  }

  /**
   * Mapea una fila resuelta al DTO de resolución (§3.3 de la propuesta).
   *
   * `ck_redemption_resolved_audit` garantiza `resolved_at` NO nulo en
   * estados resueltos; el fallback a época solo satisface al compilador.
   */
  private aResolucion(fila: {
    id: bigint;
    status: redemption_status;
    resolved_at: Date | null;
  }): ResolucionCanjeDto {
    return {
      id: String(fila.id),
      estado: fila.status,
      resueltoEn: new Date(fila.resolved_at ?? 0).toISOString(),
    };
  }

  /**
   * Lee un ítem canjeable por id.
   *
   * @param itemId Id en formato string.
   * @returns Fila del ítem.
   * @throws NotFoundException 404 si no existe o el id no es numérico.
   */
  private async leerItem(itemId: string): Promise<FilaItemCompleta> {
    if (!ID_VALIDO.test(itemId)) {
      throw new NotFoundException(MENSAJE_ITEM_NO_EXISTE);
    }
    const filas = await this.prisma.$queryRaw<FilaItemCompleta[]>(
      Prisma.sql`
        SELECT id, class_id, name, cost_coins, stock, status, type, grade_points
        FROM redeemable_items
        WHERE id = ${BigInt(itemId)}
      `,
    );
    const fila = filas[0];
    if (fila === undefined) {
      throw new NotFoundException(MENSAJE_ITEM_NO_EXISTE);
    }
    return fila;
  }

  /**
   * Lee la inscripción ACTIVA del estudiante en la clase del ítem.
   *
   * @param idEstudiante Id del estudiante (BigInt).
   * @param idClase Id de la clase del ítem (BigInt).
   * @returns Fila de la inscripción con el saldo generado.
   * @throws NotFoundException 404 si no está inscrito.
   */
  private async leerInscripcion(
    idEstudiante: bigint,
    idClase: bigint,
  ): Promise<FilaInscripcion> {
    const filas = await this.prisma.$queryRaw<FilaInscripcion[]>(Prisma.sql`
      SELECT e.id, e.coins_available
      FROM enrollments e
      WHERE e.student_id = ${idEstudiante}
        AND e.class_id = ${idClase}
        AND e.status = 'active'
    `);
    const fila = filas[0];
    if (fila === undefined) {
      throw new NotFoundException(MENSAJE_SIN_INSCRIPCION);
    }
    return fila;
  }
}
