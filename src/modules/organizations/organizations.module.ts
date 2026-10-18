import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/**
 * Módulo de organizaciones. No importa guards ni PrismaModule: los
 * guards de JWT/roles/pertenencia son globales (AuthModule) y
 * PrismaModule es global, así que este módulo solo declara su
 * controller y service.
 */
@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
