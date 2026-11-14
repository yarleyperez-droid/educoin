import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { EnrollmentsController } from './enrollments.controller';
import { ClassesService } from './classes.service';

/**
 * Módulo de clases. No importa guards ni PrismaModule: los guards de
 * JWT/roles/pertenencia son globales (AuthModule) y PrismaModule es
 * global, así que este módulo solo declara sus controllers y service.
 */
@Module({
  controllers: [ClassesController, EnrollmentsController],
  providers: [ClassesService],
})
export class ClassesModule {}
