import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // El filtro global de Prisma se registra dentro de configurarApp para
  // que producción y tests e2e compartan exactamente la misma cadena HTTP.
  configurarApp(app);
  const config = app.get(ConfigService);
  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen(puerto);
}
void bootstrap();
