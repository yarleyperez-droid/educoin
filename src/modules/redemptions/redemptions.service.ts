import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { item_status, item_type } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  aCanjeRespuesta,
  aTextoPuntos,
  evaluarCanje,
  mensajeDeMotivo,
} from './canje.util';
import type { CanjeRespuestaDto, PrevisualizacionCanjeDto } from './dto/canje-respuesta.dto';

/** El ítem pedido no existe (o su id no es numérico: mismo 404, anti-enumeración). */
export const MENSAJE_ITEM_NO_EXISTE = 'El ítem solicitado no existe.';

/** El estudiante no tiene inscripción activa en la clase del ítem. */
export const MENSAJE_SIN_INSCRIPCION =
  'No estás inscrito en la clase de ese ítem.';

/** El canje pedido no existe o no pertenece al estudiante (mismo 404). */
export const MENSAJE_CANJE_NO_EXISTE = 'El canje solicitado no existe.';

/** Doble anulación. */
export const MENSAJE_CANJE_YA_ANULADO = 'El canje ya fue anulado.';

/** Ids admitidos (BIGINT como string). */
const ID_VALIDO = /^\d+$/;

/** Fila de inscripción usada para el saldo y el bloqueo. */
interface FilaInscripcion {
  id: bigint;
  coins_available: number;
}

/** Fila de ítem canjeable leída con bloqueo. */
interface FilaItem {
  id: bigint;
  name: string;
  cost_coins: number;
  stock: number | null;
  status: item_status;
}

/** Fila completa del ítem (la que necesita la previsualización). */
interface FilaItemCompleta extends FilaItem {
  class_id: bigint;
  type: item_type;
  grade_points: unknown;
}

/**
 * Servicio de canje instantáneo (H4.4 / PRO-282).
 *
 * El negocio FUERTE vive en la BD (§12.6–12.8 de `db/001_schema.sql`):
 * - `fn_execute_redemption` (BEFORE INSERT): congela `cost_coins` y
 *   `grade_points` del ítem vigente y descuenta stock (con `FOR UPDATE`).
 * - `fn_register_redemption` (AFTER INSERT): registra el movimiento
 *   `spending`; si las monedas no alcanzan, `ck_enrollment_no_negative`
 *   falla y **toda** la operación (incluido el stock) se revierte.
 * - `fn_reverse_redemption` (AFTER UPDATE OF status): al pasar a
 *   `reversed` devuelve monedas (`reversal`) y stock.
 *
 * Este service solo ORQUESTA: lee el saldo/stock para la previsualización,
 * pre-valida dentro de la transacción (mensajes claros en español antes de
 * chocar con un constraint) y escribe en `redemptions`. No reimplementa
 * ninguna de esas reglas.
 *
 * Lecturas reutilizables por H4.1 (catálogo) y H4.2 (billetera) cuando
 * esas historias se implementen.
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
   * Confirma el canje de forma atómica (T4.4.2 · CAs 1-3).
   *
   * Todo ocurre dentro de una `prisma.$transaction` (una sola transacción
   * SQL): se bloquean con `FOR UPDATE` la inscripción (saldo) y el ítem,
   * se pre-valida con mensajes claros y se inserta la fila en
   * `redemptions`, cuyo trigger congela el costo y descuenta stock y
   * monedas. Si algo falla después del INSERT (p. ej. el constraint de
   * saldo), la transacción entera revierte: ni saldo ni stock cambian.
   *
   * El `FOR UPDATE` de la inscripción serializa canjes concurrentes del
   * mismo estudiante; el `FOR UPDATE` del ítem (en el trigger) serializa
   * el último unitario entre estudiantes distintos.
   *
   * @param itemId Id del ítem (string numérico).
   * @param usuario Estudiante autenticado.
   * @returns El canje `completed` con el costo congelado por la BD.
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

      const items = await tx.$queryRaw<
        (FilaItem & { class_id: bigint })[]
      >(Prisma.sql`
        SELECT id, class_id, name, cost_coins, stock, status
        FROM redeemable_items
        WHERE id = ${idItem}
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
        throw new UnprocessableEntityException(
          mensajeDeMotivo(evaluacion.motivo, costo, monedasDisponibles),
        );
      }

      // El INSERT dispara los triggers: congelado de costo/puntos, stock
      // -1 y movimiento `spending`. cost_coins se envía solo para cumplir
      // el NOT NULL de la columna; el trigger lo pisa con el valor vigente.
      const canje = await tx.redemptions.create({
        data: {
          enrollment_id: inscripcion.id,
          item_id: item.id,
          cost_coins: costo,
        },
      });

      return aCanjeRespuesta(canje, item.name);
    });
  }

  /**
   * Anula un canje propio `completed` (T4.4.3 · CA 4).
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
   * @throws ConflictException 409 si ya estaba anulado.
   */
  async anular(
    canjeId: string,
    usuario: UsuarioAutenticado,
  ): Promise<CanjeRespuestaDto> {
    if (!ID_VALIDO.test(canjeId)) {
      throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
    }

    const canje = await this.prisma.redemptions.findUnique({
      where: { id: BigInt(canjeId) },
    });
    if (canje === null) {
      throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
    }

    // Segunda capa (AGENTS.md §8): el canje solo es visible/manejable por
    // el estudiante de su inscripción; ajeno ⇒ mismo 404 que inexistente.
    const inscripcion = await this.prisma.enrollments.findUnique({
      where: { id: canje.enrollment_id },
      select: { student_id: true },
    });
    if (inscripcion?.student_id !== BigInt(usuario.id)) {
      throw new NotFoundException(MENSAJE_CANJE_NO_EXISTE);
    }

    if (canje.status === 'reversed') {
      throw new ConflictException(MENSAJE_CANJE_YA_ANULADO);
    }

    const actualizado = await this.prisma.redemptions.update({
      where: { id: canje.id },
      data: { status: 'reversed', reversed_at: new Date() },
    });

    const item = await this.prisma.redeemable_items.findUnique({
      where: { id: canje.item_id },
      select: { name: true },
    });

    return aCanjeRespuesta(actualizado, item?.name ?? '');
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
