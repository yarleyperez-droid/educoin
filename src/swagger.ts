import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { NOMBRE_COOKIE_REFRESH } from './modules/auth/cookies';

/**
 * Bootstrap de la documentación OpenAPI (solo fuera de producción, lo
 * decide main.ts). Se monta DIRECTAMENTE sobre la instancia de Express
 * — la ruta es exacta y NO recibe el prefijo global de los
 * controladores, que ya se incluye aquí a propósito para que todo viva
 * bajo /api/v1:
 *
 *   UI interactiva → /api/v1/docs
 *   Esquema JSON   → /api/v1/docs-json
 */

/** Ruta exacta donde se sirven la UI y el JSON de Swagger. */
export const RUTA_SWAGGER = 'api/v1/docs';

/**
 * Nombre del esquema de seguridad de la cookie de refresco. Lo usan
 * los endpoints que la EXIGEN (POST /auth/refresh) con @ApiSecurity;
 * se registra abajo con addSecurity.
 */
export const SEGURIDAD_COOKIE_REFRESH = 'cookie-refresh';

const DESCRIPCION_GENERAL = `
API de **Educoin**, la plataforma educativa de monedas: los estudiantes
resuelven actividades de sus clases, acumulan monedas al calificarse y
las gastan en la tienda de recompensas del aula.

### Autenticación (doble token)

* **Access token** (JWT corto): sale en el cuerpo de \`POST /auth/login\`
  y viaja en cada petición como \`Authorization: Bearer …\`. Pulsa el
  botón **Authorize** de esta UI para probar los endpoints protegidos.
* **Refresh token** (JWT largo): NUNCA viaja en el cuerpo; el login lo
  establece como cookie **httpOnly** \`refresh_token\` (Path=/api/v1/auth,
  SameSite=Lax) y \`POST /auth/refresh\` la canjea por una sesión nueva.
  \`POST /auth/logout\` la revoca en el servidor y expira la cookie.

### Convenciones de la API

* Prefijo global: todas las rutas viven bajo \`/api/v1\`.
* Paginación estándar de listados: \`{ data, meta }\` con
  \`meta = { total, page, limit }\` (page 1-indexada; limit ≤ 50).
* Los IDs BigInt viajan como **string** (BigInt no se serializa a JSON).
* Errores con la forma \`{ statusCode, message, error }\`; los 404 son
  deliberadamente idénticos para recursos ajenos o inexistentes
  (anti-enumeración).
* Los JSONB complejos (\`questions\` de actividades, \`answers\` de
  entregas) se validan en profundidad con zod en el backend; su
  estructura documentada está en los esquemas de cada endpoint.`;

/**
 * Construye el documento OpenAPI a partir de la app ya configurada
 * (con prefijo global y pipes, para que las rutas del spec salgan con
 * /api/v1). Lo usa configurarSwagger y el script de exportación
 * scripts/exportar-openapi.ts, para que la UI y docs/openapi.json
 * siempre salgan del mismo builder.
 */
export function construirDocumentoOpenApi(
  app: INestApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Educoin API')
    .setDescription(DESCRIPCION_GENERAL)
    .setVersion('0.0.1')
    .addServer('/', 'Servidor local (http://localhost:3000)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token JWT devuelto por POST /api/v1/auth/login. Vigencia corta (JWT_ACCESS_EXPIRES_IN).',
      },
      'bearer',
    )
    .addSecurity(SEGURIDAD_COOKIE_REFRESH, {
      type: 'apiKey',
      in: 'cookie',
      name: NOMBRE_COOKIE_REFRESH,
      description:
        'Cookie httpOnly establecida por POST /api/v1/auth/login. El navegador la envía automáticamente en /api/v1/auth/*; la exige POST /auth/refresh.',
    })
    .addTag('Sistema', 'Healthcheck de la API.')
    .addTag(
      'Auth',
      'Sesión: login, refresh y logout públicos, y perfil del usuario autenticado.',
    )
    .addTag(
      'Users',
      'Cuentas de usuario: alta/listado/gestión por el admin y edición del propio perfil (PATCH /users/me).',
    )
    .addTag(
      'Organizations',
      'Organizaciones (colegio/universidad/otra): CRUD exclusivo del admin con borrado lógico.',
    )
    .addTag(
      'Classes',
      'Clases del profesor: creación, edición, búsqueda por nombre e inscripción por código.',
    )
    .addTag(
      'Activities',
      'Actividades de las clases: borrador y publicación del profesor, consulta del estudiante inscrito.',
    )
    .addTag(
      'Submissions',
      'Entregas: borrador/autosave y envío del estudiante; cola de calificación y revisión del profesor.',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Registra la UI y el JSON de Swagger en RUTA_SWAGGER. */
export function configurarSwagger(app: INestApplication): void {
  const documento = construirDocumentoOpenApi(app);
  SwaggerModule.setup(RUTA_SWAGGER, app, documento, {
    customSiteTitle: 'Educoin API — Documentación',
    swaggerOptions: { persistAuthorization: true },
  });
}
