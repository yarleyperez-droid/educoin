import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  app.useGlobalFilters(new PrismaExceptionFilter());
  const config = app.get(ConfigService);
  const puerto = config.get<number>('PORT') ?? 3000;
  await app.listen(puerto);
}
void bootstrap();
