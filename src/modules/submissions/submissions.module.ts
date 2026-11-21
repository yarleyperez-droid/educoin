import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { ArchivosService } from './archivos.service';

/**
 * Módulo de entregas (tabla submissions). No importa guards ni
 * PrismaModule: los guards de JWT/roles/pertenencia son globales
 * (AuthModule), PrismaModule es global y AutorizacionService vive en
 * AutorizacionModule que también es global — así que este módulo solo
 * declara su controller y services (mismo patrón que ActivitiesModule).
 *
 * MulterModule registra las opciones GLOBALES de multer para los
 * interceptores de subida: MemoryStorage por defecto (multer 2.x) y
 * el tope de tamaño UPLOAD_MAX_BYTES desde la configuración validada
 * (AGENTS.md §13: nunca process.env suelto). El tope de NEGOCIO con
 * mensaje en español lo aplica el Service; este límite protege la
 * petición (DoS) y su 413 lo traduce el filtro de la ruta.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: config.get<number>('UPLOAD_MAX_BYTES') },
      }),
    }),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, ArchivosService],
})
export class SubmissionsModule {}
