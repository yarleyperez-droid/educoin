/**
 * Configuración de OpenAPI/Swagger (H1.3 / PRO-267, T1.3.1 + T1.3.2).
 *
 * Fuente del contrato "API primero": lo que se documenta aquí es lo que el
 * front (y TBD) usan para construir sin esperar implementaciones.
 *
 * - `CONFIGURACION_SWAGGER`: metadatos del documento (título, versión,
 *   convenciones de respuesta, códigos HTTP, autenticación bearer JWT y tags).
 * - `crearDocumentoSwagger(app)`: genera el documento a partir de las rutas
 *   reales de la app (`deepScanRoutes` + `autoTagControllers`).
 *
 * Los esquemas de los DTO **no** se escriben a mano: el plugin CLI de
 * `@nestjs/swagger` (habilitado en `nest-cli.json` con `classValidatorShim`)
 * los infiere de las clases con class-validator al compilar con `nest build`.
 * Por eso los e2e (ts-jest, sin plugin) ven la estructura del documento pero
 * no las propiedades: los esquemas se validan en el arranque compilado
 * (ver spec 024 §Supuestos 3).
 *
 * @packageDocumentation
 */

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Descripción del documento: convenciones del contrato (T1.3.2).
 *
 * Recoge lo que la API ya cumple: envoltura `{ data, meta }` de los
 * listados (AGENTS.md §8), la excepción de login/refresh (responden la
 * sesión sin envoltura) y los códigos HTTP estándar del MVP.
 */
const DESCRIPCION = `
## Convención de respuesta

- **Listados** → \`{ data, meta }\` donde \`meta = { total, page, limit }\`
  (p. ej. \`GET /classes\`, \`GET /classes/:id/estudiantes\`).
- **Sesión** (\`POST /auth/login\`, \`POST /auth/refresh\`) → objeto plano
  \`{ accessToken, tipoToken, expiraEn, usuario }\`; el refresh token viaja en
  la cookie httpOnly \`refresh_token\` (Path=/api/v1/auth), no en el cuerpo.
- **Sin cuerpo** (\`POST /auth/logout\`) → \`204\` y la cookie expirada.

## Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 | Lectura correcta |
| 201 | Recurso creado (login/refresh también) |
| 204 | Éxito sin cuerpo (logout) |
| 400 | Validación de DTO (\`ValidationPipe\` whitelist) |
| 401 | Sin token, token inválido o credenciales erróneas |
| 403 | Rol insuficiente (\`@Roles\`) o recurso de otra organización |
| 404 | Recurso inexistente o ajeno (\`@PerteneceA\`, anti-enumeración) |
| 409 | Conflicto de unicidad (Prisma \`P2002\`, p. ej. nombre de clase repetido) |
| 422 | Regla de negocio rechazada por la BD (\`RAISE EXCEPTION\`) |
| 429 | Rate limit global (300/min por IP) o de auth (5 intentos/min) |

## Autenticación

- \`Bearer <accessToken>\` (JWT de vida corta) en el header \`Authorization\`.
- El refresh se renueva con la cookie httpOnly \`refresh_token\` (\`POST /auth/refresh\`).
`.trim();

/** Configuración base del documento OpenAPI. */
export const CONFIGURACION_SWAGGER = new DocumentBuilder()
  .setTitle('EduCoins API')
  .setVersion('1.0.0')
  .setDescription(DESCRIPCION)
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      name: 'JWT',
      description: 'Access token JWT devuelto por POST /api/v1/auth/login',
    },
    'bearer',
  )
  .addTag('auth', 'Login, refresh, logout y perfil')
  .addTag('classes', 'Clases e inscriptos (gestión del profesor)')
  .build();

/**
 * Genera el documento OpenAPI a partir de las rutas reales de la aplicación.
 *
 * Debe llamarse **después** de `configurarApp(app)` (que instala el prefijo
 * global `api/v1`), para que las rutas del documento queden como
 * `/api/v1/...`.
 *
 * @param app Aplicación Nest ya configurada.
 * @returns Documento OpenAPI listo para `SwaggerModule.setup`.
 */
export function crearDocumentoSwagger(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, CONFIGURACION_SWAGGER, {
    deepScanRoutes: true,
    autoTagControllers: true,
  });
}
