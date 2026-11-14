import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Módulo de cuentas de usuario (altas de teacher/student y listado,
 * ambos exclusivos del admin). No importa guards ni PrismaModule: los
 * guards de JWT/roles/pertenencia son globales (AuthModule) y
 * PrismaModule es global, así que este módulo solo declara su
 * controller y service.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
