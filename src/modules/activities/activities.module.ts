import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

/**
 * Módulo de actividades (tabla activities). No importa guards ni
 * PrismaModule: los guards de JWT/roles/pertenencia son globales
 * (AuthModule), PrismaModule es global y AutorizacionService vive en
 * AutorizacionModule que también es global — así que este módulo solo
 * declara su controller y service (mismo patrón que ClassesModule).
 */
@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
})
export class ActivitiesModule {}
