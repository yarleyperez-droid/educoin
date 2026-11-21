import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';
import { crearDocumentoSwagger } from './swagger.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // El filtro global de Prisma se registra dentro de configurarApp para
  // que producción y tests e2e compartan exactamente la misma cadena HTTP.
  configurarApp(app);

  // Documentación OpenAPI (H1.3 / PRO-267): UI en GET /api y spec JSON en
  // GET /api-json. Se monta DESPUÉS de configurarApp para que las rutas del
  // documento hereden el prefijo global api/v1 (la UI queda en /api porque
  // no se pasa la opción useGlobalPrefix).
  const documento = crearDocumentoSwagger(app);
  SwaggerModule.setup('api', app, documento, {
    swaggerOptions: { persistAuthorization: true },
  });

  const config = app.get(ConfigService);
  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen(puerto);
}
void bootstrap();
