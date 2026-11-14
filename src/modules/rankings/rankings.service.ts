import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  AutorizacionService,
  MENSAJE_RECURSO_NO_ENCONTRADO,
} from '../autorizacion/autorizacion.service';
import { aFilaRanking, type FilaRanking } from './rankings.util';
import type { RankingDto } from './dto/ranking.dto';

/** Conteo del total de filas (query aparte, nunca count(*) OVER()). */
interface FilaConteo {
  total: bigint | number | string;
}

/**
 * Rankings global y por clase (H4.3 / PRO-281): SOLO lectura sobre las
 * vistas `global_ranking` y `class_ranking`, sin recalcular nada en
 * código (S5). El orden es por monedas **ganadas** (`coins_earned`),
 * nunca por saldo disponible, así que canjear no baja de puesto (CA 2,
 * garantizado por la definición de la vista).
 *
 * - Global (S2): `student`/`teacher` solo ven su organización; `admin`
 *   ve todas (espejo de `classes.condicionPorRol`). Un token sin
 *   organización no admin recibe `{ data: [] }` sin consultar.
 * - Por clase (S4): sin `@PerteneceA` (su regla `'clase'` es teacher-only
 *   y rechazaría al estudiante); el acceso se ramifica aquí por rol y
 *   todo fallo responde el 404 estándar anti-enumeración.
 *
 * `$queryRaw` tipado con tagged template parametrizado (AGENTS.md §7:
 * prohibido `$queryRawUnsafe`). Los IDs viajan como string en los DTOs
 * (BigInt no serializa).
 */
@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autorizacion: AutorizacionService,
  ) {}

  /**
   * Ranking global paginado por monedas ganadas (T4.3.1 · CA 1, 2, 5 y 6).
   *
   * @param usuario Usuario autenticado (roles student|teacher|admin).
   * @param page Página 1-indexada (default 1).
   * @param limit Filas por página (default 20).
   * @returns Filas de `global_ranking` con la envoltura `{ data, meta }`.
   */
  async global(
    usuario: UsuarioAutenticado,
    page = 1,
    limit = 20,
  ): Promise<RankingDto> {
    const filtro = this.condicionPorRol(usuario);
    if (filtro === null) {
      return { data: [], meta: { total: 0, page, limit } };
    }
    const offset = (page - 1) * limit;

    const filas = await this.prisma.$queryRaw<FilaRanking[]>(Prisma.sql`
      SELECT position, student_id, first_name, last_name,
             coins_earned, coins_available
      FROM global_ranking
      WHERE ${filtro}
      ORDER BY coins_earned DESC, first_name ASC, student_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // El total se cuenta aparte: un count(*) OVER() lo perdería en páginas
    // sin filas (mismo criterio que classes.buscar y wallet.historial).
    const conteo = await this.prisma.$queryRaw<FilaConteo[]>(Prisma.sql`
      SELECT count(*) AS total
      FROM global_ranking
      WHERE ${filtro}
    `);

    return {
      data: filas.map((fila) => aFilaRanking(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }

  /**
   * Ranking paginado de una clase (T4.3.1 · CA 3, 4 y 7): solo
   * inscripciones `active` (definición de `class_ranking`).
   *
   * @param id Id de la clase (no numérico → 404 anti-enumeración).
   * @param usuario Usuario autenticado (roles student|teacher|admin).
   * @param page Página 1-indexada (default 1).
   * @param limit Filas por página (default 20).
   * @returns Filas de `class_ranking` con la envoltura `{ data, meta }`.
   * @throws NotFoundException 404 si la clase no es accesible para el rol.
   */
  async porClase(
    id: string,
    usuario: UsuarioAutenticado,
    page = 1,
    limit = 20,
  ): Promise<RankingDto> {
    const idNumerico = Number(id);
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
    }
    const idClase = BigInt(idNumerico);

    if (usuario.role === 'teacher') {
      await this.autorizacion.verificarPertenencia('clase', id, usuario);
    } else if (usuario.role === 'student') {
      const inscripcion = await this.prisma.enrollments.findFirst({
        where: {
          class_id: idClase,
          student_id: BigInt(usuario.id),
          status: 'active',
        },
        select: { id: true },
      });
      if (inscripcion === null) {
        throw new NotFoundException(MENSAJE_RECURSO_NO_ENCONTRADO);
      }
    }

    const offset = (page - 1) * limit;

    const filas = await this.prisma.$queryRaw<FilaRanking[]>(Prisma.sql`
      SELECT position, student_id, first_name, last_name,
             coins_earned, coins_available
      FROM class_ranking
      WHERE class_id = ${idClase}
      ORDER BY coins_earned DESC, first_name ASC, student_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const conteo = await this.prisma.$queryRaw<FilaConteo[]>(Prisma.sql`
      SELECT count(*) AS total
      FROM class_ranking
      WHERE class_id = ${idClase}
    `);

    return {
      data: filas.map((fila) => aFilaRanking(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }

  /**
   * Filtro de organización del ranking global según el rol (S2). El
   * admin, como rol global, no recibe filtro; un token sin organización
   * no admin devuelve `null` y el llamador responde vacío sin consultar
   * (patrón `Prisma.sql\`false\`` de classes, sin gastar la query).
   */
  private condicionPorRol(usuario: UsuarioAutenticado): Prisma.Sql | null {
    if (usuario.role === 'admin') {
      return Prisma.sql`true`;
    }
    if (usuario.organizacionId === null) {
      return null;
    }
    return Prisma.sql`organization_id = ${BigInt(usuario.organizacionId)}`;
  }
}
