# EduCoins — Contexto del proyecto y estado del MVP

> Documento de **contexto**: qué es el proyecto, qué reglas lo gobiernan, qué stack usamos,
> **qué ya está hecho** y **qué falta**. No contiene issues, criterios de aceptación ni
> responsables (aún no están definidos).
>
> **Fuentes de verdad** (si algo contradice este documento, gana la fuente indicada):
> 1. `db/001_schema.sql` — esquema real (9 tablas, 10 enums, 7 triggers, 3 vistas). Máxima autoridad.
> 2. `docs/plataforma_educativa_bd.md` — reglas de negocio y verificación 12/12.
> 3. `docs/post_mvp.md` — funcionalidades **planificadas que NO existen** en la BD.
> 4. `.opencode/agents/AGENTS.md` — convenciones, seguridad y arquitectura.
>
> **Fecha:** 2026-10-05 · **Alcance:** MVP de testeo.

---

## 1. Qué es EduCoins

Plataforma web educativa **gamificada** con tres roles:

- El **admin** registra organizaciones (escuelas/universidades) y crea las cuentas de
  profesores y estudiantes (con contraseña inicial).
- El **profesor** crea clases con **código de unión**, publica **actividades** con
  recompensa en monedas, administra el catálogo de **ítems canjeables** y revisa/califica
  las entregas con retroalimentación.
- El **estudiante** se inscribe en clases, resuelve actividades, gana monedas (por clase y
  ranking global) y las canjea **instantáneamente** por **puntos de nota** o actividades
  lúdicas.

### Ciclo principal del MVP

```
admin crea organización → crea teacher/student
teacher crea clase (código de unión) → publica actividad (questions JSONB)
student se une a la clase → resuelve la entrega (answers JSONB)
teacher califica         → gana 120 monedas (trigger, 1 sola vez)
student canjea ítem      → descuenta monedas + stock (instantáneo)
ranking global           → ordena por monedas GANADAS (vista)
```

### Personas de prueba (`db/002_seed.sql`)

| Persona | Rol | Usuario | Qué permite probar |
|---|---|---|---|
| Ada Admin | `admin` global | `admin` | Organización y altas de cuenta |
| Ana López | `teacher` | `prof.lopez` | Clase `Mathematics 10A`, actividad de 120 monedas, 2 ítems canjeables |
| Juan Pérez | `student` | `est.perez` | Desempeño alto |
| María Gómez | `student` | `est.gomez` | Saldo bajo → error de canje |

Todas las cuentas nacen con `must_change_password = TRUE`.

---

## 2. Reglas de negocio clave (resumen)

1. **3 roles**: `admin` (global), `teacher`, `student` (en una organización).
2. **Multi-organización**: cada usuario pertenece a una organización; `admin` puede no
   tener. Las clases e inscripciones son **siempre dentro de la misma organización**.
3. **Las monedas viven en la BD**: `coins_earned`, `coins_spent` y `coins_available` son
   columnas **generadas y solo-lectura**; el único camino de escritura es la tabla
   `coin_movements`, alimentada por **triggers**. El backend jamás recalcula saldos.
4. **Auto-calificación**: `test`/`completion` se corrigen con `is_correct`/`expected_answer`
   del `questions` JSONB. La respuesta correcta **nunca** se envía al frontend.
5. **1 entrega por actividad y estudiante** (`UNIQUE`), calificada solo por el profesor de
   la clase. Recalificar **no** duplica monedas (índice único parcial de movimiento).
6. **Canje instantáneo**: costo congelado en la inserción; si no alcanza el saldo o falta
   stock → error con **rollback total**. Estado: `completed | reversed`.
7. **Borrado lógico**: `status = deleted` + `deleted_at`; ninguna tabla se vacía a mano.
8. **Estados de actividad**: `draft → published → (closed|archived|deleted)`; estados de
   inscripción: `active → paused → withdrawn|blocked`; estados de entrega:
   `draft → submitted → graded|rejected|resubmitted`.
9. **Ranking**: monedas **ganadas** (gastar no baja la posición); existe `student_coins`,
   `global_ranking` y `class_ranking` como **vistas** (solo lectura).
10. **Triggers de validación**: inscripción, entrega, saldo sin bajar de 0, stock de ítem
    y recompensa-dada-una-vez — todo verificado en la prueba 12/12 de
    `docs/plataforma_educativa_bd.md` §7.

---

## 3. Stack técnico y decisiones ya tomadas

| Capa | Elección | Nota |
|---|---|---|
| Backend | **NestJS 12 + TypeScript 6** | ESM-only; el código debe ser ESM-friendly |
| ORM / BD | **Prisma 7.10.0** (`@prisma/adapter-pg` + `pg`) · **PostgreSQL 14+** | versión fijada exacta; `prisma`/`@prisma/client`/`@prisma/adapter-pg` deben ir sincronizados; `prisma/schema.prisma` + migraciones **ya existen** |
| Frontend | **Next.js 16 + React 19 + Tailwind 4 + KaTeX** | en `frontend/`, aplicación aparte con su propio lockfile |
| Auth / seguridad | `@nestjs/jwt`, `passport`, `argon2`, `helmet`, `class-validator` | ✅ **cableado**: login 201 + cookie httpOnly `refresh_token` (Path=/api/v1/auth), refresh, logout 204, perfil; rate limit 5/min/IP; mensaje 401 "El usuario o la contraseña son erróneos" |
| Validación de negocio extra | `zod` | ✅ cableado: validación `.env` al arrancar (`src/config/env.validation.ts`) + `questions` JSONB |
| API docs | `@nestjs/swagger` | instalado, sin configurar |
| Tests / QA | **Jest 30 (modo CommonJS/CJS)** + oxlint + Prettier | CJS necesario por grafo mixto `@nestjs/common@12` (ESM-only) + `@nestjs/throttler@6.7.1` (CJS); `ERR_REQUIRE_CYCLE_MODULE` en modo ESM; CJS funciona en Node ≥ 24.9 |
| Tooling | **pnpm 11** · `pnpm install:all` · Node ≥ 24.9 | sin npm/yarn; prohibido `package-lock.json` |

**Decisiones operativas:**

- Dos apps independientes (no workspace): backend en la raíz, frontend en `frontend/`.
- Puertos: **API `:3000`** (`pnpm start:dev`) · **frontend `:3001`** (`pnpm dev:web`).
- Prefijo de API: **`/api/v1`**; respuestas paginadas `{ data, meta }`; códigos HTTP
  (`201` al crear, `409` duplicados, `422` validaciones de BD, `401/403` autorización).
- `pnpm-workspace.yaml` define `allowBuilds` para `@parcel/watcher`, `unrs-resolver`,
  `argon2`, `prisma`, `@prisma/engines` (sin eso `pnpm install` falla con
  `ERR_PNPM_IGNORED_BUILDS`); telemetría `@scarf/scarf` denegada.
- Config sensible **solo** en `.env` / `.env.example` (nunca commiteado).
- Reglas duras de `.opencode/agents/AGENTS.md`: sin commits a `main`; sin archivos/carpetas
  nuevas en la raíz sin aprobación; sin instalar dependencias sin aprobación; Prisma solo
  desde Services; `any` prohibido.

---

## 4. Qué llevamos hecho ✅

- **Rama `Alejandro`** sincronizada con `main` + commits del equipo; existe rama de trabajo `s2_h5_4_login` con H5.4 + integración (merge local en `main` sin push).
- **Instalación completa en verde** con `pnpm install:all` (backend + frontend).
- **Base de datos**: `db/001_schema.sql` (9 tablas, 10 enums, 7 triggers, 3 vistas) +
  `db/002_seed.sql` — **verificación 12/12** de reglas de negocio.
- **Prisma**: `prisma/schema.prisma` (modelos PascalCase español → `@@map` inglés) + migraciones SQL manuales en `prisma/migrations/` (baselining + triggers/vistas/índices parciales) + cliente generado en `src/generated/prisma` (`postinstall: prisma generate`); `PrismaModule`/`PrismaService` inyectable.
- **Configuración `.env` validada al arrancar** con zod (`src/config/env.validation.ts`): exige `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥16), `JWT_REFRESH_SECRET` (≥16); defaults `JWT_ACCESS_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`, `FRONTEND_URL=http://localhost:3001`, `PORT=3000`, `UPLOAD_MAX_BYTES=10485760`; `ConfigModule.forRoot({isGlobal, validate: validarEnv})` cableado en `AppModule`.
- **Backend NestJS** con módulos reales: `auth` (H2.1 **COMPLETO**), `autorizacion` (roles/pertenencia), `classes` (PARCIAL: crear/editar/archivar); prefijo global `/api/v1` (`app.setup.ts`), CORS con `credentials` y origen `FRONTEND_URL`, helmet, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), filtro global `PrismaExceptionFilter` (P2002→409, RAISE EXCEPTION→422, 500 genérico).
- **Auth backend (H2.1)**: `POST /api/v1/auth/login` 201 + cookie refresh httpOnly `refresh_token` (Path=/api/v1/auth); `POST /auth/refresh` (rotación); `POST /auth/logout` 204; `GET /auth/perfil`; `AuthThrottlerGuard` 5 intentos/min por IP (login y refresh contadores independientes); argon2 en `AuthService.validarUsuario`; mensaje 401 único `MENSAJE_CREDENCIALES_INVALIDAS`.
- **Guards/Decorators globales**: `JwtAuthGuard` (JWT acceso vida corta), `RolesGuard` (`@Roles(...)`), `AuthThrottlerGuard`, `@UsuarioActual`, `@Publico` en `src/common/`.
- **Frontend Next.js 16** (H5.1–H5.4 **completas**): `lib/api-client.ts` (HTTP único, access token en memoria, refresh-on-401 con cola de concurrencia, normaliza `auth/*` a `{data}`, 204→`data:null`, 401 login no dispara refresh); `lib/auth.ts` (`Sesion` espejo `UsuarioRespuestaDto` = `{id, username, email, role, nombre, apellido, organizacionId (string|null), debeCambiarContrasena}`, cookie legible `educoins_sesion` para middleware Edge); `middleware.ts` (guard por rol + bloqueo `debeCambiarContrasena` → `/cambiar-contrasena`); `features/auth/api/auth.ts` (`iniciarSesion`/`cerrarSesion` reales; `cambiarContrasena` = **MOCK documentado pendiente H2.2**); E2E Playwright con `webServer` array (Nest `:3000` + Next `:3001`), usuarios del seed reales; unit Vitest con stubs de fetch.
- **Tests backend**: Jest en **modo CommonJS/CJS** (`jest.config.ts` y `test/jest-e2e.json` sin `extensionsToTreatAsEsm`/`useESM`, con `moduleNameMapper` para cliente Prisma); `pnpm test` / `pnpm test:e2e` en verde (11 suites unitarias).
- **Servidor verificado en vivo**: API `:3000` → 200 · Next `:3001` → 200.
- **Deps limpias**: pnpm lockfiles correctos en ambas apps.

---

## 5. Qué falta por hacer ❌

> Orden lógico de dependencias (no es un cronograma ni incluye responsables).

### 5.1 Auth — pendiente único
- **H2.2**: endpoint de cambio de contraseña en el backend (`POST /api/v1/auth/cambiar-contrasena` o similar). Desbloquea reemplazar el **MOCK** de `cambiarContrasena` en `frontend/features/auth/api/auth.ts`.

### 5.2 Backend de dominio (módulos no construidos)
- `classes` **completar**: listar, unir por código, gestión de inscriptos, `pg_trgm` búsqueda.
- `activities`: crear/editar/publicar/archivar con validación `questions` (zod), KaTeX saneado, recompensa 120 monedas (seed).
- `submissions`: crear entrega (validaciones BD), auto-calificación `test`/`completion`, cola del profesor, calificar/rechazar con `feedback`, recalificar sin duplicar monedas (índice único parcial).
- `enrollments`: inscripción, contadores monedas por clase, `coins_available` (columna generada).
- `redeemable_items` / `redemptions`: catálogo (`grade_bonus` con `grade_points`, `fun_activity` con stock), canje instantáneo (trigger `fn_execute_redemption` + `fn_register_redemption`), reversión (`status=reversed` → trigger `fn_reverse_redemption`), validación `ck_enrollment_no_negative`.
- `coins` / ranking: `coin_movements` solo lectura (auditoría); vistas `global_ranking`, `class_ranking`, `student_coins` para consultar (no recalcular).
- Subida de archivos (PDF/JPG/PNG) con validación MIME real, límite `UPLOAD_MAX_BYTES`, nombre UUID servidor; ruta guardada en `submissions.answers[].files[]`.

### 5.3 Autorización por recurso (pendiente en módulos nuevos)
- Guards globales JWT + roles + pertenencia **ya existen**; falta verificación de **propiedad por recurso** en cada service (profesor solo sus clases/actividades/ítems/entregas; estudiante solo sus inscripciones/entregas/redemptions/monedas; ambos solo su organización).

### 5.4 Frontend — paneles por rol (H5.6/H5.8+)
- H5.4 solo cubre auth. Faltan: panel admin (organizaciones, usuarios), panel profesor (clases, actividades, revisión/calificación, ítems), panel estudiante (dashboard, cuestionario, billetera, canjes, rankings, progreso).
- Estados UI obligatorios: carga / vacío / error en toda vista con datos.
- Decidir destino de `educoins_platform.html` (referencia o descarte).

### 5.5 API Docs
- Swagger/OpenAPI en `/api` con prefijo `/api/v1` (hoy el frontend deriva tipos del código real del backend, no de Swagger).

### 5.6 Calidad, seguridad y entrega
- `helmet` + CORS + `ValidationPipe` global + rate limiting **ya cableados**; auditoría de que ninguna respuesta filtre `password_hash`, `is_correct`, `expected_answer` al estudiante.
- Pruebas por funcionalidad (unit + e2e + casos negativos de rol/recurso ajeno/validación BD) siguiendo checklist "terminado" de AGENTS.md §12.
- CI: `typecheck`, `lint`, `build`, `test`, `test:e2e` (+ build frontend) en cada PR; rama `develop` y flujo PR (hoy `main` + `Alejandro` + `s2_h5_4_login`).
- Despliegue backend + frontend + PostgreSQL (Docker `educoin-db` puerto host 5434), variables fuera del repo, datos demo sembrados, guía arranque 5 min.

---

## 6. Fuera de alcance del MVP

Definido en `docs/post_mvp.md`; **no existe en la BD** y no debe presentarse como
funcionalidad actual: modalidades automática/manual con umbral · tabla `preguntas`
independiente · canje con aprobación (`pending/approved/rejected/delivered`) · subtipos de
usuario · `equivalencias_nota` · historiales como vistas · varios intentos · ranking por
organización · recompensa condicionada · RLS · WebSockets para ranking en tiempo real.

---

## 7. Próximos pasos (sugeridos, aún sin asignar)

1. Aprobar el plan de `schema.prisma` + baselining (puerta de entrada a todo lo demás).
2. Cablear `.env` validado, `PrismaService` y Swagger.
3. Autenticación con JWT y guards por rol (bloque de seguridad transversal).
4. Primer flujo completo en vertical: clase → actividad → entrega → calificación → monedas.
5. Catálogo + canje, luego rankings y panel del estudiante.
6. CI, endurecimiento de seguridad y despliegue de la demo.
