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
| [`docs/plataforma_educativa_bd.md`](docs/plataforma_educativa_bd.md) | **Especificación de la BD**: reglas de negocio, diagrama Mermaid, estructura JSONB, resultados de verificación. |
| [`docs/post_mvp.md`](docs/post_mvp.md) | **Backlog post-MVP**: funcionalidades planificadas (minijuegos, modalidades, aprobación de canjes…) que *no existen aún* en la BD. |
| [`docs/contexto_mvp.md`](docs/contexto_mvp.md) | **Contexto del MVP**: reglas de negocio, stack y decisiones, qué está hecho y qué falta. |
| [`.opencode/agents/AGENTS.md`](.opencode/agents/AGENTS.md) | Guardrails del proyecto para agentes de IA. |
| [`package.json`](package.json) | **Backend NestJS** (API REST): scripts, dependencias y `engines`. |
| [`src/`](src) | Código del backend (NestJS). Hoy solo el andamiaje inicial (`AppModule`, `GET /`). |
| [`test/`](test) | Pruebas e2e (Jest + Supertest). |
| [`frontend/`](frontend) | **Frontend Next.js 16** (App Router + Tailwind 4 + KaTeX). App aparte con su propio lockfile; estructura de capas por rol en `frontend/src/` (`app/(auth|admin|teacher|student)/`, `features/`, `components/`, `lib/api-client.ts`). |
| [`.env.example`](.env.example) | Variables del backend. Cópialo a `.env` (nunca se commitea). |
| [`frontend/.env.example`](frontend/.env.example) | Variables del frontend (`NEXT_PUBLIC_API_URL`). |

## Requisitos

- **Node.js ≥ 22** (probado en 22.23.3).
- **pnpm ≥ 11** (`corepack enable pnpm` o `npm i -g pnpm`). **No se usa npm ni yarn**:
  hay dos lockfiles, `pnpm-lock.yaml` (raíz) y `frontend/pnpm-lock.yaml`.
- **PostgreSQL 14+** (probado en 16) con extensiones `citext` y `pg_trgm`
  (incluidas en el script).
- Opcional: `python3` + `build-essential` por si alguna dependencia nativa
  (`argon2`) tenga que compilarse en tu plataforma.

## Instalar y arrancar todo

```bash
# 1. Dependencias de backend + frontend (una sola vez)
pnpm install:all

# 2. Variables de entorno
cp .env.example .env                    # backend (rellenar)
cp frontend/.env.example frontend/.env.local   # frontend

# 3. Terminal 1 -> API NestJS en http://localhost:3000
pnpm start:dev

# 4. Terminal 2 -> Frontend Next en http://localhost:3001
pnpm dev:web
```

### Comandos

| Comando | Qué hace |
|---|---|
| `pnpm install:all` | Instala backend (raíz) **y** frontend |
| `pnpm start:dev` | API Nest en watch → `:3000` |
| `pnpm dev:web` | Next en watch → `:3001` |
| `pnpm build` / `pnpm build:web` | Compilar backend (`dist/`) / frontend (`.next/`) |
| `pnpm typecheck` | `tsc --noEmit` del backend |
| `pnpm lint` | oxlint (backend). Frontend: `pnpm --dir frontend lint` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Pruebas unitarias (Jest, modo ESM) |
| `pnpm test:e2e` | Pruebas e2e |

## Crear la base de datos

```bash
# 1. Crear la BD (UTF8)
createdb -U <usuario> plataforma_educativa

# 2. Esquema (enum, tablas, índices, triggers, vistas)
psql -U <usuario> -d plataforma_educativa -v ON_ERROR_STOP=1 -f db/001_schema.sql

# 3. Datos de prueba
psql -U <usuario> -d plataforma_educativa -v ON_ERROR_STOP=1 -f db/002_seed.sql

# 4. Verificación (§7 de la especificación): ranking, monedas, canjes
psql -U <usuario> -d plataforma_educativa
```

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

El esquema fue verificado en PostgreSQL 16 con **12/12 pruebas** (pruebas
positivas y negativas) — detalle en
[`docs/plataforma_educativa_bd.md` §7](docs/plataforma_educativa_bd.md).

## Stack

| Capa | Tecnología | Estado |
|---|---|---|
| Base de datos | PostgreSQL 14+ (multi-tenant: `organizations`) | ✅ esquema y seeds en `db/` |
| Backend | **NestJS 12 + TypeScript 6** (API REST) | 🟡 andamiaje inicial: solo `GET /`. Sin módulos de dominio |
| ORM | **Prisma 7.10** + `@prisma/adapter-pg` + `pg` | 🟡 paquetes instalados. Falta `prisma/schema.prisma` y el baselining |
| Auth / seguridad | `@nestjs/jwt`, `@nestjs/passport`, `helmet`, `argon2`, `class-validator` | 🟡 instalados, sin cablear |
| API docs | `@nestjs/swagger` | 🟡 instalado, sin configurar |
| Frontend demo | HTML/CSS plano (`educoins_platform.html`) | ✅ prototipo autocontenido |
| Frontend final | **Next.js 16 + React 19 + Tailwind 4** (`frontend/`) | 🟡 landing propia + esqueleto de capas por rol (`app/`, `features/`, `components/`, `lib/api-client.ts`). Sin vistas por rol |
| Editor de ecuaciones | **KaTeX 0.19** | 🟡 instalado en `frontend/`, sin integrar |
| Lint / formato | oxlint + Prettier (backend), ESLint (frontend) | ✅ configurado |
| Tests | Jest 30 (unit + e2e con Supertest) | ✅ 2 pruebas en verde |

### Pendiente para el equipo

- **Prisma**: crear `prisma/schema.prisma` a partir de `db/001_schema.sql` y hacer
  el *baselining* (`.opencode/agents/AGENTS.md` §7). **Requiere aprobación**: toca la
  zona de mayor riesgo.
- **Cablear lo instalado**: `@nestjs/config` + `helmet` + `ValidationPipe` global +
  Swagger en `main.ts`; `PrismaService` único inyectable.
- **Cablear auth**: `JwtAuthGuard` + `RolesGuard` + hash `argon2`.
- **Frontend**: crear las vistas por rol (el esqueleto de carpetas y
  `lib/api-client.ts` ya existen en `frontend/src/`).
- **Puertos acordados**: API `:3000`, frontend `:3001`.
- Confirmar estrategia de despliegue (el script `pnpm deploy` de `@nestjs/mau`
  aún no está configurado).

## Convenciones rápidas

- Nombres en inglés `snake_case`, tablas en plural.
- Contraseñas **solo** como hash (bcrypt/argon2) — jamás texto plano.
- Sentencias preparadas / ORM en la app (prevención de inyección SQL) y
  escape/sanitizado de todo dato de usuario (prevención de XSS).
- Cada archivo del proyecto lleva cabecera documentada (docstring).
