# EduCoins 🪙

> Plataforma web educativa **gamificada**: los profesores publican actividades
> con recompensa en monedas virtuales; los estudiantes las resuelven, acumulan
> monedas y las canjean por **puntos de nota** o actividades lúdicas.
> Sistema multi-rol: `admin`, `teacher`, `student`.

---

## Contenido del repositorio

| Ruta | Qué es |
|---|---|
| [`educoins_platform.html`](educoins_platform.html) | **Demo principal** (prototipo de interfaz autocontenido: HTML + CSS, sin dependencias). Ábrelo directo en el navegador. |
| [`db/001_schema.sql`](db/001_schema.sql) | Esquema completo de la BD (9 tablas, 10 enums, 7 triggers, 3 vistas) — *docstring de cabecera con uso y convenciones*. |
| [`db/002_seed.sql`](db/002_seed.sql) | Datos de prueba mínimos para recorrer todo el ciclo — *docstring de cabecera*. |
| [`docs/EduCoin.md`](docs/EduCoin.md) | **Ficha técnica oficial** (Plan de Dirección Técnica v1.0): requerimientos por rol (Dev 1/2/3), stack permitido, estándares de código y flujo Git. |
| [`docs/post_mvp.md`](docs/post_mvp.md) | **Post-MVP (backlog + planes, documento único)**: trazabilidad contra la ficha (§0), funcionalidades planificadas que *no existen aún* en la BD (Parte I) + plan de la épica E7 — canje con aprobación (Parte II) + plan de la épica E8 — minijuegos como pregunta de actividad (Parte III) + plan de la épica E9 — KaTeX + responsive (Parte IV). |
| [`docs/guard_pertenencia.md`](docs/guard_pertenencia.md) | **Guard `@PerteneceA`**: cómo funciona la verificación de propiedad de recursos y cómo declararla en endpoints nuevos. |
| [`.opencode/agents/AGENTS.md`](.opencode/agents/AGENTS.md) | Guardrails del proyecto para agentes de IA. |
| [`package.json`](package.json) | **Backend NestJS** (API REST): scripts, dependencias y `engines`. |
| [`src/`](src) | Código del backend (NestJS). Módulos reales: `auth` (H2.1 completo), `autorizacion`, `classes` (parcial), `common/` (guards, decorators, filters), `config/` (validación .env), `prisma/`, `generated/prisma/`. |
| [`test/`](test) | Pruebas e2e (Jest + Supertest). |
| [`frontend/`](frontend) | **Frontend Next.js 16** (App Router + Tailwind 4 + KaTeX). App aparte con su propio lockfile; estructura de capas por rol en `frontend/src/` (`app/(auth|admin|teacher|student)/`, `features/`, `components/`, `lib/api-client.ts`). |
| [`.env.example`](.env.example) | Variables del backend. Cópialo a `.env` (nunca se commitea). |
| [`frontend/.env.example`](frontend/.env.example) | Variables del frontend (`NEXT_PUBLIC_API_URL`). |

## Requisitos

- **Node.js ≥ 24.9** (`engines.node` en `package.json`; probado en 24.21.0).
- **pnpm ≥ 11** (`corepack enable pnpm` o `npm i -g pnpm`). **No se usa npm ni yarn**:
  hay dos lockfiles, `pnpm-lock.yaml` (raíz) y `frontend/pnpm-lock.yaml`.
- **PostgreSQL 14+** (probado en 16) con extensiones `citext` y `pg_trgm`
  (incluidas en el script / Docker).
- Opcional: `python3` + `build-essential` por si alguna dependencia nativa
  (`argon2`) tenga que compilarse en tu plataforma.

## Instalar y arrancar todo

```bash
# 1. Dependencias de backend + frontend (una sola vez; postinstall genera el cliente Prisma)
pnpm install:all

# 2. Variables de entorno
cp .env.example .env                    # backend (rellenar; ver "Base de datos")
cp frontend/.env.example frontend/.env.local   # frontend

# 3. Base de datos (ver sección siguiente): docker start educoin-db + esquema/seed

# 4. Terminal 1 -> API NestJS en http://localhost:3000 (prefijo /api/v1)
pnpm start:dev

# 5. Terminal 2 -> Frontend Next en http://localhost:3001
pnpm dev:web
```

> **Documentación de la API (H1.3):** UI en <http://localhost:3000/api> y spec
> OpenAPI JSON en <http://localhost:3000/api-json> (todas las rutas bajo
> `/api/v1`, esquema de seguridad JWT bearer).

### Comandos

| Comando | Qué hace |
|---|---|
| `pnpm install:all` | Instala backend (raíz) **y** frontend |
| `pnpm start:dev` | API Nest en watch → `:3000` (`/api/v1`) |
| `pnpm dev:web` | Next en watch → `:3001` |
| `pnpm build` / `pnpm build:web` | Compilar backend (`dist/`) / frontend (`.next/`) |
| `pnpm typecheck` | `tsc --noEmit` del backend. Frontend: `pnpm --dir frontend typecheck` |
| `pnpm lint` | oxlint (backend). Frontend: `pnpm --dir frontend lint` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Pruebas unitarias backend (Jest, modo CommonJS) |
| `pnpm test:e2e` | Pruebas e2e backend (Jest + Supertest; requiere BD) |
| `pnpm --dir frontend test` | Pruebas unitarias frontend (Vitest) |
| `pnpm --dir frontend test:e2e` | E2E frontend (Playwright; levanta backend + Next vía `webServer`) |

## Base de datos (Docker)

El proyecto usa un contenedor PostgreSQL 16 gestionado con Docker:

```bash
# Contenedor: educoin-db (imagen postgres:16)
# Puerto host: 5434 → 5432 (interno)
# Usuario: educoins
# Contraseña: educoins_dev
# Base de datos: educoins

# Arrancar (si ya existe el contenedor):
docker start educoin-db

# O crear por primera vez:
docker run -d \
  --name educoin-db \
  -e POSTGRES_USER=educoins \
  -e POSTGRES_PASSWORD=educoins_dev \
  -e POSTGRES_DB=educoins \
  -p 5434:5432 \
  postgres:16
```

### Variables de entorno (backend `.env`)

```bash
DATABASE_URL=postgresql://educoins:educoins_dev@localhost:5434/educoins
JWT_ACCESS_SECRET=...mínimo 16 chars...
JWT_REFRESH_SECRET=...mínimo 16 chars...
# Opcionales (tienen defaults):
# JWT_ACCESS_EXPIRES_IN=15m
# JWT_REFRESH_EXPIRES_IN=7d
# FRONTEND_URL=http://localhost:3001
# PORT=3000
# UPLOAD_MAX_BYTES=10485760
```

### Esquema y seed (aplicados al contenedor)

```bash
# 1. Esquema (enum, tablas, índices, triggers, vistas)
psql -U educoins -h localhost -p 5434 -d educoins -v ON_ERROR_STOP=1 -f db/001_schema.sql

# 2. Datos de prueba (usuarios con hashes argon2 reales)
psql -U educoins -h localhost -p 5434 -d educoins -v ON_ERROR_STOP=1 -f db/002_seed.sql
```

### Usuarios de prueba (seed real)

| Usuario | Contraseña | Rol | `must_change_password` |
|---|---|---|---|
| `admin` | `Admin123!` | `admin` (global) | `true` |
| `prof.lopez` | `Prof123!` | `teacher` | `false` |
| `est.perez` | `Estudiante123!` | `student` | `true` |
| `est.gomez` | `Estudiante123!` | `student` | `true` |

> Clase de prueba: `Mathematics 10A` (código generado por BD), actividad de 120 monedas, 2 ítems canjeables.

## Ciclo principal del MVP

```
admin crea organización → crea teacher/student
teacher crea clase (código de unión) → publica actividad (questions JSONB)
student se une a la clase → resuelve la entrega (answers JSONB)
teacher califica         → gana 120 monedas (trigger, 1 sola vez)
student canjea ítem      → descuenta monedas + stock (instantáneo)
ranking global           → ordena por monedas GANADAS (vista)
```

## Verificación

- **Esquema BD**: verificado en PostgreSQL 16 con **12/12 pruebas** (2026-10-02):
  otorgamiento de monedas, contadores, canje + stock, ranking, unicidad de clase,
  saldo sin negativo, organización compartida, recalificación sin duplicar,
  reversión de canje, bloqueo a actividad `draft` y auditoría en `coin_movements`.
  La regresión continua la cubre `test:e2e` en CI.
- **Backend**: `pnpm test` (11 suites / 104 tests) y `pnpm test:e2e` (5 suites /
  53 tests, requieren la BD Docker corriendo).
- **Frontend**: `pnpm --dir frontend test` (Vitest), `pnpm --dir frontend test:e2e`
  (Playwright contra backend real + Next; requiere BD Docker), más
  `typecheck`/`lint`/`build`.
- **CI (H6.4 / PRO-295)**: cada PR a `main`/`develop` y cada push a `develop`
  corren [.github/workflows/ci.yml](.github/workflows/ci.yml) — backend
  (`typecheck`, `lint`, `build`, `test`, `test:e2e` contra PostgreSQL 16
  efímero con esquema + seed por corrida) **y** `build` del frontend, en paralelo.
  Verificado con un PR sano en **verde** y un PR con error intencional en **rojo**.
  Nota: `db/002_seed.sql` lleva hashes argon2id reales de las contraseñas de
  esta sección; sin ellos los e2e de login fallan en CI.
- **Contrato OpenAPI (H1.3 / PRO-267)**: `GET /api` (Swagger UI) y
  `GET /api-json` (spec `openapi 3.0`) generados en el arranque desde
  `src/swagger.config.ts`; los esquemas de los 12 DTO los infiere el plugin CLI
  de `@nestjs/swagger` (`nest-cli.json`). Suite `test/swagger.e2e-spec.ts`
  (5 tests: prefijo `/api/v1`, `securitySchemes` bearer aplicado a las rutas
  protegidas, convención `{ data, meta }` + códigos, UI). Verificado además en
  arranque compilado (`pnpm build` → `node dist/main` → esquemas reales).
- **Kit UI y accesibilidad (H5.2 / PRO-283)**: componentes en
  [`frontend/src/components/ui/`](frontend/src/components/ui/) — `EstadoCarga`
  (`role="status"` + `aria-live`), `EstadoVacio` (acción sugerida),
  `EstadoError` (`role="alert"`) y toast accesible propio (auto-ocultado 3 s,
  sin librerías de runtime); 13 tests con Testing Library. Auditoría de
  contraste **WCAG AA** (T5.2.3): 3 fallos detectados y corregidos —

  | Elemento | Antes | Después | Mínimo |
  |---|---:|---:|---:|
  | placeholder de inputs | 2.52:1 (`neutral-400`) | 4.74:1 (`neutral-500`) | 4.5:1 |
  | texto atenuado del kit | 4.37:1 (`--muted` del prototipo) | 5.43:1 (`#6b6a63`) | 4.5:1 |
  | anillo de foco | 1.48:1 (`ring-neutral-300`) | 10.37:1 (`ring-neutral-700`) | 3:1 |

  El resto (labels, `text-red-700` 6.47:1, botón primario 17.93:1, toast de
  éxito 5.34:1 y de error 7.07:1) cumple AA sin cambios.

## Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Base de datos | PostgreSQL 14+ (multi-tenant: `organizations`), **Docker `educoin-db` :5434** | ✅ esquema y seed en `db/`, poblados |
| Backend | **NestJS 12 + TypeScript 6** (API REST, prefijo `/api/v1`) | ✅ módulos `auth` (H2.1), `autorizacion`, `classes` (parcial) |
| ORM | **Prisma 7.10** + `@prisma/adapter-pg` + `pg` | ✅ `prisma/schema.prisma` + migraciones + cliente generado |
| Auth / seguridad | `@nestjs/jwt`, passport, helmet, argon2, throttler | ✅ H2.1 cableado: login/refresh/logout/perfil, rate limit 5/min, argon2 |
| Env | `@nestjs/config` + `zod` (`validarEnv`) | ✅ cableado; `.env` validada al arrancar |
| API docs | `@nestjs/swagger` | 🟡 instalado, sin configurar |
| Frontend demo | HTML/CSS plano (`educoins_platform.html`) | ✅ prototipo autocontenido |
| Frontend final | **Next.js 16 + React 19 + Tailwind 4** (`frontend/`) | 🟡 H5.1–H5.4 completas (api-client con refresh, middleware por rol, login real); faltan paneles por rol |
| Editor de ecuaciones | **KaTeX 0.19** | 🟡 instalado en `frontend/`, sin integrar |
| Lint / formato | oxlint + Prettier (backend), ESLint (frontend) | ✅ configurado |
| Tests | Jest 30 backend (**modo CommonJS**), Vitest + Playwright frontend | ✅ verdes (ver §Verificación) |

### Pendiente para el equipo

- **H2.2**: endpoint de cambio de contraseña en el backend (único pendiente
  de auth; desbloquea reemplazar el mock de `cambiarContrasena` del frontend).
- **Backend de dominio**: clases completas, actividades, entregas,
  inscripciones, canjes y ranking (estado y asignación en **Linear**;
  plan post-MVP en `docs/post_mvp.md`).
- **Autorización por recurso**: verificar propiedad/organización en cada
  service de los módulos nuevos (los guards globales ya existen).
- **Frontend**: paneles por rol (H5.6+).
- **Swagger**: ✅ contrato publicado en `/api` (H1.3 / PRO-267).
- **Despliegue**: el script `pnpm deploy` de `@nestjs/mau` aún no está
  configurado; estrategia pendiente de confirmar.
  - Hecho: flujo de ramas y PR (H6.2 / PRO-293) **y** CI en cada PR (H6.4 / PRO-295).

## Flujo de ramas y PRs

### Ramas
| Rama | Propósito | Acceso |
|---|---|---|
| `main` | Producción (solo releases) | **Protegida**: sin commits directos, PR obligatorio; solo Tech Lead fusiona |
| `develop` | Integración continua del equipo | Fusionada solo vía PR desde ramas de feature |
| `feature/devX-nombre-tarea`<br/>`sN_hX_Y_descripcion` | Trabajo individual por tarea | Cualquier dev; PR hacia `develop` |

> Convención establecida en **H6.2 / PRO-293 (Sprint 0)**.

### Flujo estándar
```
main → develop → feature/... → PR a develop → merge → PR develop → main (Tech Lead)
```

### Reglas obligatorias
- **Nunca** commit directo a `main` ni a `develop`.
- PRs de tamaño manejable (una tarea lógica por PR).
- Commits en **Conventional Commits**: `feat(...)`, `fix(...)`, `docs: ...`, etc.
- **Nunca** subir `.env`, secretos, llaves ni lockfiles ajenos (`package-lock.json`).
- Antes de pedir revisión: ejecutar `pnpm typecheck`, `pnpm lint`, `pnpm test` (y sus equivalentes en `frontend/`) y que pasen en verde.
- La protección de `main` a nivel de GitHub (regla de rama) queda a cargo del Tech Lead; el flujo se cumple igual vía PR.

## Convenciones rápidas

- Nombres en inglés `snake_case`, tablas en plural.
- Contraseñas **solo** como hash (bcrypt/argon2) — jamás texto plano.
- Sentencias preparadas / ORM en la app (prevención de inyección SQL) y
  escape/sanitizado de todo dato de usuario (prevención de XSS).
- Cada archivo del proyecto lleva cabecera documentada (docstring).
