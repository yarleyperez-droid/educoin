import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configurarApp } from '../app.setup';
import { construirDocumentoOpenApi } from '../swagger';

/**
 * Exporta el documento OpenAPI de la API a docs/openapi.json:
 *   pnpm swagger:export
 *
 * Arranca la app SIN escuchar puerto y con el mismo configurarApp que
 * main.ts (el prefijo /api/v1 influye en las rutas del spec), genera el
 * documento con el MISMO builder que la UI de /api/v1/docs y lo escribe
 * con `await app.close()` al final — sin servir HTTP.
 *
 * Debe ejecutarse COMPILADO (dist/scripts/exportar-openapi.js, lo hace
 * el propio npm script): el plugin CLI de @nestjs/swagger inyecta las
 * descripciones y validaciones de los DTOs durante `nest build`
 * (_OPENAPI_METADATA_FACTORY), y ese metadata solo existe en dist —
 * ts-node no puede ejecutar el cliente generado de Prisma 7 (importa
 * con extensión .js) ni aplicaría el plugin.
 *
 * Requiere la BD disponible: NestFactory.create ejecuta los hooks de
 * inicialización y PrismaService.onModuleInit conecta (la conexión se
 * cierra sola con app.close()).
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configurarApp(app);
    const documento = construirDocumentoOpenApi(app);
    const destino = resolve(process.cwd(), 'docs', 'openapi.json');
    await writeFile(destino, `${JSON.stringify(documento, null, 2)}\n`);
    console.log(`OpenAPI exportado: ${destino}`);
  } finally {
    await app.close();
  }
}

void main();
