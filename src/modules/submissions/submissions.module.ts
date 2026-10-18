import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

/**
 * Módulo de entregas (tabla submissions). No importa guards ni
 * PrismaModule: los guards de JWT/roles/pertenencia son globales
 * (AuthModule), PrismaModule es global y AutorizacionService vive en
 * AutorizacionModule que también es global — así que este módulo solo
 * declara su controller y service (mismo patrón que ActivitiesModule).
 */
@Module({
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
