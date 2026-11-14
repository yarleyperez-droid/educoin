import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsuarioAutenticado } from '../../common/interfaces/usuario-autenticado';
import {
  aMovimientoBilletera,
  verificarPropio,
  type FilaMovimiento,
} from './billetera.util';
import type { HistorialBilleteraQueryDto } from './dto/historial-billetera.query.dto';
import type {
  HistorialBilleteraDto,
  SaldoBilleteraDto,
} from './dto/saldo-billetera.dto';

/** Fila de la vista `student_coins`. */
interface FilaSaldo {
  total_earned: number;
  total_spent: number;
  total_available: number;
}

/**
 * Billetera del estudiante (H4.2 / PRO-280): saldo e historial en **solo
 * lectura**, sin recalcular nada en código (CA del ticket).
 *
 * - El saldo sale de la vista `student_coins` (suma de TODAS las
 *   inscripciones del estudiante); si no tiene ninguna, la vista no tiene
 *   fila y se responden ceros.
 * - El historial es `coin_movements` unido a su inscripción y clase,
 *   ordenado `created_at DESC` y paginado con la envoltura `{ data, meta }`.
 *
 * Ojo con la diferencia de alcance: la billetera es **global** (todas las
 * clases) mientras que el canje (H4.4) opera sobre el saldo de la clase
 * del ítem. Los IDs viajan como string (BigInt no serializa, AGENTS §7).
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saldo agregado del estudiante autenticado (T4.2.1 · CA 1).
   *
   * @param usuario Estudiante autenticado.
   * @param studentIdQuery `?studentId=` opcional (403 si es ajeno).
   * @returns Ganadas, gastadas y disponibles leídas de `student_coins`.
   */
  async saldo(
    usuario: UsuarioAutenticado,
    studentIdQuery?: string,
  ): Promise<SaldoBilleteraDto> {
    verificarPropio(studentIdQuery, usuario);

    const filas = await this.prisma.$queryRaw<FilaSaldo[]>(Prisma.sql`
      SELECT total_earned, total_spent, total_available
      FROM student_coins
      WHERE student_id = ${BigInt(usuario.id)}
    `);

    const fila = filas[0];
    return {
      monedasGanadas: Number(fila?.total_earned ?? 0),
      monedasGastadas: Number(fila?.total_spent ?? 0),
      monedasDisponibles: Number(fila?.total_available ?? 0),
    };
  }

  /**
   * Historial paginado de movimientos del estudiante (T4.2.2 · CA 2 y 4).
   *
   * @param dto Query con paginación opcional.
   * @param usuario Estudiante autenticado.
   * @returns Movimientos en orden descendente con `{ data, meta }`.
   */
  async historial(
    dto: HistorialBilleteraQueryDto,
    usuario: UsuarioAutenticado,
  ): Promise<HistorialBilleteraDto> {
    verificarPropio(dto.studentId, usuario);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const idEstudiante = BigInt(usuario.id);

    const filas = await this.prisma.$queryRaw<FilaMovimiento[]>(
      Prisma.sql`
      SELECT m.id, m.type, m.quantity, m.description,
             c.id AS class_id, c.name AS class_name, m.created_at
      FROM coin_movements m
      JOIN enrollments e ON e.id = m.enrollment_id
      JOIN classes c ON c.id = e.class_id
      WHERE e.student_id = ${idEstudiante}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    );

    // El total se cuenta aparte: un count(*) OVER() lo perdería en páginas
    // sin filas (mismo criterio que classes.buscar).
    const conteo = await this.prisma.$queryRaw<
      { total: bigint | number | string }[]
    >(Prisma.sql`
      SELECT count(*) AS total
      FROM coin_movements m
      JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.student_id = ${idEstudiante}
    `);

    return {
      data: filas.map((fila) => aMovimientoBilletera(fila)),
      meta: {
        total: Number(conteo[0]?.total ?? 0),
        page,
        limit,
      },
    };
  }
}
