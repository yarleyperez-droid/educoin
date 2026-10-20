import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Módulo de cuentas de usuario (altas de teacher/student y listado,
 * ambos exclusivos del admin, más el auto-servicio PATCH /me). No
 * importa guards ni PrismaModule: los guards de JWT/roles/pertenencia
 * son globales (AuthModule) y PrismaModule es global. Sí importa
 * AuthModule porque UsersService usa SesionesActivasService (exportado
 * por aquel) para cerrar todas las sesiones tras cambiar credenciales.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
