import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './../src/app.module';
import { configurarApp } from './../src/app.setup';
import { crearDocumentoSwagger } from '../src/swagger.config';

/**
 * Spec OpenAPI (H1.3 / PRO-267, T1.3.3): la documentación se genera en un
 * arranque normal sin degradar la app.
 *
 * Esta suite replica el arranque de `main.ts` (configurarApp + crear el
 * documento + setup de la UI) y verifica la ESTRUCTURA del contrato:
 * - documento `openapi` servido en `GET /api-json`;
 * - todas las rutas bajo `/api/v1` (prefijo global);
 * - securityScheme bearer JWT definido y aplicado a las rutas protegidas;
 * - convenciones `{ data, meta }` y códigos estándar en la descripción;
 * - UI de Swagger en `GET /api`.
 *
 * NOTA: corre bajo ts-jest, que NO aplica el plugin CLI de `@nestjs/swagger`,
 * así que NO se afirman las propiedades de los DTO (esas se verifican en el
 * arranque compilado, `pnpm build` + `node dist/main`; spec 024 §Supuestos 3).
 */

interface OperacionSwagger {
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, unknown>;
}

interface DocumentoSwagger {
  openapi: string;
  info: { title: string; description?: string };
  paths: Record<string, Record<string, OperacionSwagger>>;
  components?: {
    securitySchemes?: Record<
      string,
      { type?: string; scheme?: string; bearerFormat?: string }
    >;
  };
}

describe('Spec OpenAPI bajo /api/v1 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    SwaggerModule.setup('api', app, crearDocumentoSwagger(app));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Descarga y valida el documento JSON servido por la app. */
  async function descargarDocumento(): Promise<DocumentoSwagger> {
    const respuesta = await request(app.getHttpServer())
      .get('/api-json')
      .expect(200);
    return respuesta.body as DocumentoSwagger;
  }

  it('sirve el documento openapi en GET /api-json', async () => {
    const documento = await descargarDocumento();

    expect(documento.openapi).toMatch(/^3\./);
    expect(documento.info.title).toBe('EduCoins API');
    expect(Object.keys(documento.paths).length).toBeGreaterThan(0);
  });

  it('todas las rutas del contrato quedan bajo /api/v1', async () => {
    const documento = await descargarDocumento();
    const rutas = Object.keys(documento.paths);

    expect(rutas.length).toBeGreaterThanOrEqual(8);
    for (const ruta of rutas) {
      expect(ruta.startsWith('/api/v1')).toBe(true);
    }
  });

  it('declara el securityScheme bearer JWT y lo aplica a las rutas protegidas', async () => {
    const documento = await descargarDocumento();
    const esquema = documento.components?.securitySchemes?.bearer;

    expect(esquema).toBeDefined();
    expect(esquema?.type).toBe('http');
    expect(esquema?.scheme).toBe('bearer');
    expect(esquema?.bearerFormat).toBe('JWT');

    // Protegidas: clases (todas las operaciones) y perfil de auth.
    expect(documento.paths['/api/v1/classes'].get?.security).toEqual([
      { bearer: [] },
    ]);
    expect(documento.paths['/api/v1/auth/perfil'].get?.security).toEqual([
      { bearer: [] },
    ]);
    // Públicas: login, refresh y logout NO exigen bearer.
    expect(documento.paths['/api/v1/auth/login'].post?.security).toBeUndefined();
    expect(documento.paths['/api/v1/auth/logout'].post?.security).toBeUndefined();
  });

  it('documenta la envoltura { data, meta } y los códigos estándar', async () => {
    const documento = await descargarDocumento();
    const descripcion = documento.info.description ?? '';

    expect(descripcion).toContain('{ data, meta }');
    expect(descripcion).toContain('total, page, limit');
    for (const codigo of ['201', '409', '422', '401', '403']) {
      expect(descripcion).toContain(codigo);
    }

    // Códigos declarados en las operaciones clave (POST /classes).
    const respuestas = documento.paths['/api/v1/classes'].post?.responses ?? {};
    for (const codigo of ['201', '401', '403', '409', '422']) {
      expect(Object.keys(respuestas)).toContain(codigo);
    }
  });

  it('la UI de Swagger responde en GET /api', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/api')
      .expect(200);

    expect(respuesta.text).toContain('swagger');
  });
});
