import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';
import { configurarSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // El filtro global de Prisma se registra dentro de configurarApp para
  // que producción y tests e2e compartan exactamente la misma cadena HTTP.
  configurarApp(app);
  const config = app.get(ConfigService);
  // Swagger (UI en /api/v1/docs) solo fuera de producción (decisión del
  // equipo): en la BD de prod no tiene sentido exponer el contrato de la
  // API. Se registra aquí y no en configurarApp para que los tests e2e
  // mantengan exactamente la misma cadena HTTP que producción.
  if (config.get<string>('NODE_ENV') !== 'production') {
    configurarSwagger(app);
  }
  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen(puerto);
}
void bootstrap();
