import { Global, Module } from '@nestjs/common';
import { AutorizacionService } from './autorizacion.service';

/**
 * Módulo global con las reglas de pertenencia de recursos. PrismaService
 * es global (PrismaModule), así que este módulo solo publica
 * AutorizacionService para que lo consuman PertenenciaGuard y cualquier
 * Service que necesite verificar pertenencia en flujos internos.
 */
@Global()
@Module({
  providers: [AutorizacionService],
  exports: [AutorizacionService],
})
export class AutorizacionModule {}
