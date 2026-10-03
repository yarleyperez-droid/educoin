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

## Requisitos

- **PostgreSQL 14+** (probado en 16) con extensiones `citext` y `pg_trgm`
  (incluidas en el script).

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

## Stack (definido por el equipo)

- **BD:** PostgreSQL (multi-tenant: `organizations`)
- **Frontend demo:** HTML/CSS plano (`educoins_platform.html`)
- **Editor de ecuaciones:** KaTeX o MathJax (pendiente de integrar)
- **Patrón:** MVC o API REST + frontend separado (pendiente de elegir lenguaje)

## Convenciones rápidas

- Nombres en inglés `snake_case`, tablas en plural.
- Contraseñas **solo** como hash (bcrypt/argon2) — jamás texto plano.
- Sentencias preparadas / ORM en la app (prevención de inyección SQL) y
  escape/sanitizado de todo dato de usuario (prevención de XSS).
- Cada archivo del proyecto lleva cabecera documentada (docstring).
