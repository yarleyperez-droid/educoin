import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import { AutorizacionService } from '../autorizacion/autorizacion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { aItemRespuesta, evaluarItemPorTipo } from './catalogo.util';
import type { DatosItem } from './catalogo.util';
import type {
  ActualizarItemDto,
  CrearItemDto,
  ItemDto,
  ListarItemsQueryDto,
} from './dto/item.dto';

/**
 * Mensaje ÚNICO para todo fallo de pertenencia de la colección (CA 3):
 * clase o ítem inexistente y clase o ítem ajeno responden idéntico, así
 * la respuesta 403 no filtra existencia.
 */
export const MENSAJE_ITEMS_AJENOS = 'No puedes administrar ítems de esta clase.';

/**
 * Catálogo de ítems canjeables (H4.1 / PRO-279): CRUD del profesor sobre
 * los `redeemable_items` de SU clase, sin cambios de BD.
 *
 * - Propiedad → **403** (CA 3 / T4.1.3): se reutiliza
 *   `AutorizacionService` (único dueño de las reglas, AGENTS §8) y su
 *   `NotFoundException` se traduce a `ForbiddenException` uniforme.
 *   Divergencia deliberada del 404 anti-enumeración de `@PerteneceA`:
 *   el CA exige literalmente 403 y la uniformidad tampoco filtra
 *   existencia.
 * - Reglas de tipo → **422** (CA 1/2/4): `evaluarItemPorTipo` decide
 *   ANTES de tocar la BD (un CHECK violado sería P2004 → 500, nunca
 *   debe alcanzarse).
 * - DELETE = borrado lógico: `redemptions.item_id` es FK sin
 *   `ON DELETE`; el histórico de canjes no puede romperse.
 * - Listado extendido al **estudiante** en T5.7.2 / PRO-391: ve los
 *   ítems `active` de sus clases con inscripción `active` (ver
 *   {@link ItemsService.listar}).
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autorizacionService: AutorizacionService,
  ) {}

  /**
   * Crea un ítem en la clase (T4.1.1 · CA 1, 2 y 4).
   *
   * @param dto Datos del ítem (la propiedad de la clase se verifica primero).
   * @param usuario Profesor autenticado.
   * @returns El ítem creado (201 en el controller).
   */
  async crear(dto: CrearItemDto, usuario: UsuarioAutenticado): Promise<ItemDto> {
    await this.asegurarPertenencia('clase', String(dto.classId), usuario);
    this.validar({
      type: dto.type,
      costCoins: dto.costCoins,
      gradePoints: dto.gradePoints ?? null,
      stock: dto.stock ?? null,
    });

    const item = await this.prisma.redeemable_items.create({
      data: {
        class_id: BigInt(dto.classId),
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        cost_coins: dto.costCoins,
        grade_points: dto.gradePoints ?? null,
        stock: dto.stock ?? null,
      },
    });
    return aItemRespuesta(item);
  }

  /**
   * Lista los ítems de una clase (H4.1 / T4.1.1), con doble camino
   * (T5.7.2 / PRO-391):
   *
   * - **Profesor:** `classId` obligatorio; pertenencia → 403 uniforme;
   *   devuelve `active` e `inactive` (los que gestiona).
   * - **Estudiante:** `classId` opcional; solo ítems `active` de sus
   *   clases con inscripción `active`. Con `classId`, exige inscripción
   *   en esa clase (mismo 403 uniforme si no); sin él, lista las de
   *   todas sus inscripciones activas (vacío si no tiene).
   *
   * @param dto Query con `classId` (opcional solo para el estudiante).
   * @param usuario Profesor dueño de la clase o estudiante inscrito.
   * @returns Ítems en orden de alta (`id ASC`).
   */
  async listar(
    dto: ListarItemsQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<ItemDto[]> {
    if (usuario.role === 'student') {
      return this.listarParaEstudiante(dto.classId, usuario);
    }

    await this.asegurarPertenencia('clase', String(dto.classId), usuario);

    const items = await this.prisma.redeemable_items.findMany({
      where: {
        class_id: BigInt(dto.classId as number),
        status: { not: 'deleted' },
      },
      orderBy: { id: 'asc' },
    });
    return items.map((fila) => aItemRespuesta(fila));
  }

  /**
   * Camino estudiante del listado (T5.7.2): los `redeemable_items`
   * `active` de las clases donde el estudiante tiene inscripción
   * `active`. El desglose por inscripción lo decide la BD (tabla
   * `enrollments`); aquí no se recalcula nada.
   *
   * @param classId Clase opcional a acotar (debe estar inscrita).
   * @param usuario Estudiante autenticado.
   * @returns Ítems activos de sus clases (posiblemente vacío).
   */
  private async listarParaEstudiante(
    classId: number | undefined,
    usuario: UsuarioAutenticado,
  ): Promise<ItemDto[]> {
    const inscripciones = await this.prisma.enrollments.findMany({
      where: { student_id: BigInt(usuario.id), status: 'active' },
      select: { class_id: true },
    });
    const idsClases = inscripciones.map((inscripcion) => inscripcion.class_id);

    if (classId !== undefined) {
      const idSolicitado = BigInt(classId);
      if (!idsClases.some((id) => id === idSolicitado)) {
        throw new ForbiddenException(MENSAJE_ITEMS_AJENOS);
      }
    }

    if (idsClases.length === 0) {
      return [];
    }

    const items = await this.prisma.redeemable_items.findMany({
      where: {
        status: 'active',
        ...(classId !== undefined
          ? { class_id: BigInt(classId) }
          : { class_id: { in: idsClases } }),
      },
      orderBy: { id: 'asc' },
    });
    return items.map((fila) => aItemRespuesta(fila));
  }

  /**
   * Edita un ítem (T4.1.1): el merge resultante se revalida por tipo
   * (T4.1.2 → 422 si el parche deja el ítem inválido).
   *
   * @param id Id del ítem.
   * @param dto Campos a cambiar (parciales).
   * @param usuario Profesor dueño de la clase del ítem.
   * @returns El ítem actualizado.
   */
  async actualizar(
    id: string,
    dto: ActualizarItemDto,
    usuario: UsuarioAutenticado,
  ): Promise<ItemDto> {
    await this.asegurarPertenencia('item', id, usuario);
    const idItem = BigInt(id);

    const actual = await this.prisma.redeemable_items.findUnique({
      where: { id: idItem },
    });
    if (!actual) {
      throw new NotFoundException('El registro solicitado no fue encontrado.');
    }

    this.validar({
      type: actual.type,
      costCoins: dto.costCoins ?? Number(actual.cost_coins),
      gradePoints:
        dto.gradePoints !== undefined
          ? dto.gradePoints
          : actual.grade_points === null
            ? null
            : Number(actual.grade_points),
      stock:
        dto.stock !== undefined
          ? dto.stock
          : actual.stock === null
            ? null
            : Number(actual.stock),
    });

    const item = await this.prisma.redeemable_items.update({
      where: { id: idItem },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.costCoins !== undefined && { cost_coins: dto.costCoins }),
        ...(dto.gradePoints !== undefined && { grade_points: dto.gradePoints }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    return aItemRespuesta(item);
  }

  /**
   * Borra un ítem de forma **lógica** (`status = 'deleted'`): la FK
   * `redemptions.item_id` impide el borrado físico y el canje (H4.4) ya
   * filtra `status = 'active'`, así el ítem desaparece de la tienda sin
   * tocar el histórico. Idempotente.
   *
   * @param id Id del ítem.
   * @param usuario Profesor dueño de la clase del ítem.
   * @returns El ítem con `status: 'deleted'`.
   */
  async borrar(id: string, usuario: UsuarioAutenticado): Promise<ItemDto> {
    await this.asegurarPertenencia('item', id, usuario);

    const item = await this.prisma.redeemable_items.update({
      where: { id: BigInt(id) },
      data: { status: 'deleted' },
    });
    return aItemRespuesta(item);
  }

  /**
   * Propiedad → 403 uniforme (CA 3): cualquier fallo de
   * `verificarPertenencia` (ajeno o inexistente) responde igual; los
   * errores que NO son de pertenencia (p. ej. BD caída) se propagan.
   */
  private async asegurarPertenencia(
    tipo: 'clase' | 'item',
    id: string,
    usuario: UsuarioAutenticado,
  ): Promise<void> {
    try {
      await this.autorizacionService.verificarPertenencia(tipo, id, usuario);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ForbiddenException(MENSAJE_ITEMS_AJENOS);
      }
      throw error;
    }
  }

  /** Reglas de tipo → 422 (CA 4 y T4.1.2), siempre ANTES de la BD. */
  private validar(datos: DatosItem): void {
    const evaluacion = evaluarItemPorTipo(datos);
    if (!evaluacion.valido) {
      throw new UnprocessableEntityException(evaluacion.motivo);
    }
  }
}
