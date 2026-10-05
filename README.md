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
| [`.opencode/agents/AGENTS.md`](.opencode/agents/AGENTS.md) | Guardrails del proyecto para agentes de IA. |
| [`package.json`](package.json) | **Backend NestJS** (API REST): scripts, dependencias y `engines`. |
| [`src/`](src) | Código del backend (NestJS). Hoy solo el andamiaje inicial (`AppModule`, `GET /`). |
| [`test/`](test) | Pruebas e2e (Jest + Supertest). |
| [`.env.example`](.env.example) | Nombres de variables de entorno. Cópialo a `.env` (nunca se commitea). |

## Requisitos

- **Node.js ≥ 22** (probado en 22.23.3).
- **pnpm ≥ 11** (`corepack enable pnpm` o `npm i -g pnpm`). **No se usa npm ni yarn**:
  el lockfile del repo es `pnpm-lock.yaml`.
- **PostgreSQL 14+** (probado en 16) con extensiones `citext` y `pg_trgm`
  (incluidas en el script).

## Instalar y arrancar el backend

```bash
# 1. Dependencias (una sola vez)
pnpm install

# 2. Variables de entorno
cp .env.example .env        # rellena los valores

# 3. Desarrollo con recarga automática -> http://localhost:3000
pnpm start:dev

# 4. Producción
pnpm build && pnpm start:prod
```

### Comandos

| Comando | Qué hace |
|---|---|
| `pnpm start:dev` | Servidor en watch (`--watch`) |
| `pnpm build` | Compila a `dist/` |
| `pnpm typecheck` | `tsc --noEmit` (sin generar archivos) |
| `pnpm lint` | oxlint con reglas de tipos |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Pruebas unitarias |
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
| ORM | Prisma | ⏳ pendiente de instalar |
| Frontend demo | HTML/CSS plano (`educoins_platform.html`) | ✅ prototipo autocontenido |
| Frontend final | Next.js (App Router) | ⏳ pendiente |
| Editor de ecuaciones | KaTeX | ⏳ pendiente de integrar |
| Lint / formato | oxlint + Prettier | ✅ configurado |
| Tests | Jest 30 (unit + e2e con Supertest) | ✅ 2 pruebas en verde |

### Pendiente para el equipo

- Instalar Prisma y el resto de dependencias del backend (`@nestjs/config`,
  `@nestjs/jwt`, `class-validator`, `@nestjs/swagger`, `helmet`, `argon2`…):
  ver `.opencode/agents/AGENTS.md` §2 y §9.
- Crear el frontend Next.js (decisión de estructura: plano vs monorepo).
- Confirmar estrategia de despliegue (el script `pnpm deploy` de `@nestjs/mau`
  aún no está configurado).

## Convenciones rápidas

- Nombres en inglés `snake_case`, tablas en plural.
- Contraseñas **solo** como hash (bcrypt/argon2) — jamás texto plano.
- Sentencias preparadas / ORM en la app (prevención de inyección SQL) y
  escape/sanitizado de todo dato de usuario (prevención de XSS).
- Cada archivo del proyecto lleva cabecera documentada (docstring).
