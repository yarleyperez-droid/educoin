import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

/**
 * Configuración transversal de la aplicación: prefijo /api/v1, validación
 * global de DTOs, cabeceras seguras (helmet), CORS restringido al frontend
 * y el filtro global que traduce errores de Prisma/BD a respuestas HTTP
 * (P2002→409, RAISE EXCEPTION→422, 500 genérico). Se extrae de main.ts
 * para que los tests e2e repliquen la misma configuración.
 */
export function configurarApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const frontendUrl =
    config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.use(helmet());
  app.enableCors({ origin: frontendUrl, credentials: true });
  // Confiar en 1 proxy inverso: detrás de nginx req.ip será la IP real del
  // cliente (necesario para que el rate limit de auth no agrupe a todos los
  // usuarios bajo la IP del proxy). En desarrollo directo no tiene efecto.
  const instanciaExpress = app.getHttpAdapter().getInstance() as Express;
  instanciaExpress.set('trust proxy', 1);
}
