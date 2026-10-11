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
| ORM / BD | **Prisma 7.10.0** (`@prisma/adapter-pg` + `pg`) · **PostgreSQL 14+** | versión fijada exacta; `prisma`/`@prisma/client`/`@prisma/adapter-pg` deben ir sincronizados |
| Frontend | **Next.js 16 + React 19 + Tailwind 4 + KaTeX** | en `frontend/`, aplicación aparte con su propio lockfile |
| Auth / seguridad | `@nestjs/jwt`, `passport`, `argon2`, `helmet`, `class-validator` | instalados, **sin cablear** |
| Validación de negocio extra | `zod` | para `questions` JSONB y `.env` |
| API docs | `@nestjs/swagger` | instalado, sin configurar |
| Tests / QA | **Jest 30 (modo ESM obligatorio)** + oxlint + Prettier | pasar a CJS rompe Nest 12 |
| Tooling | **pnpm 11** · `pnpm install:all` · Node ≥ 22 | sin npm/yarn; prohibido `package-lock.json` |

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

- **Rama `Alejandro`** sincronizada con `main` + commits del equipo.
- **Instalación completa en verde** con `pnpm install:all` (backend + frontend).
- **Base de datos**: `db/001_schema.sql` (9 tablas, 10 enums, 7 triggers, 3 vistas) +
  `db/002_seed.sql` — **verificación 12/12** de reglas de negocio.
- **Backend NestJS andamiaje** con scripts de calidad: `typecheck`, `build`, `lint`,
  `format:check`, `test`, `test:e2e` → todos en verde (2 pruebas).
- **Jest resuelto en modo ESM** (bloqueo histórico del equipo) y `tsconfig`/`jest.config`
  ajustados para ignorar `frontend/` y `dist/`.
- **Frontend Next.js 16** creado y verificado: `lint`, `typecheck`, `build` en verde;
  `.env.example` con `NEXT_PUBLIC_API_URL`.
- **Dependencias clave instaladas**: Prisma 7.10.0, `pg`, `@nestjs/config`, `@nestjs/jwt`,
  `@nestjs/passport`, `passport`, `passport-local`, `class-validator`, `class-transformer`,
  `@nestjs/swagger`, `helmet`, `zod`, `argon2`, y en dev `@types/pg`,
  `@types/passport-local`.
- **Documentación**: `README.md` (estado real, comandos, estructura) y
  `.opencode/agents/AGENTS.md` (guardrails, fuentes de verdad, árbol de carpetas) al día.
- **Servidor verificado en vivo**: API `:3000` → 200 · Next `:3001` → 200.
- **Deps limpias**: eliminado archivo basura `=22`; pnpm lockfiles correctos en ambas apps.

---

## 5. Qué falta por hacer ❌

> Orden lógico de dependencias (no es un cronograma ni incluye responsables).

### 5.1 Fundación del backend
- `prisma/schema.prisma` reflejando el SQL real + **baselining** de la BD existente
  (`migrate resolve`, nunca `db push` para no perder triggers/vistas/columnas generadas).
  **Requiere aprobación** por ser la zona de mayor riesgo.
- `PrismaModule`/`PrismaService` global con cierre de conexión.
- Configuración centralizada de `.env` con validación al arrancar.
- Swagger/OpenAPI en `/api` con el prefijo `/api/v1`.
- Filtro global de excepciones que traduzca errores de Prisma/BD → HTTP
  (`P2002→409`, `RAISE EXCEPTION→422`, `500` genérico sin filtrar detalles).

### 5.2 Identidad y autorización
- Módulo `auth`: login con usuario **o** correo, refresh token en cookie `httpOnly`,
  logout con revocación, rate limiting en login, argon2.
- Cambio obligatorio de contraseña inicial (`must_change_password`).
- Guards globales de JWT + rol y **verificación de pertenencia** en cada Service
  (profesor solo sus clases; estudiante solo sus inscripciones/entregas/canjes).
- Módulo `organizations` y `users` (altas por admin, listados con paginación, `PATCH /me`).

### 5.3 Aula (clases, actividades, entregas)
- `classes`: crear con código generado por la BD, editar/archivar, buscar con `pg_trgm`,
  unión por código (traduciendo el error de la BD a un mensaje amable), gestión de
  inscriptos.
- `activities`: crear/editar/publicar/archivar con validación de `questions` (zod),
  **120 monedas** de recompensa en el seed, editor con render **KaTeX** saneado.
- `submissions`: crear entrega (validaciones en BD), auto-calificación `test`/`completion`,
  cola de entregas del profesor, calificar/rechazar con `feedback`,
  **recalificar sin duplicar monedas**.
- Subida de archivos (PDF/JPG/PNG) con validación MIME real, límite de tamaño y nombre
  de archivo generado por el servidor.

### 5.4 Economía y gamificación
- Billetera del estudiante (saldo por clase, historial de `coin_movements` — solo lectura).
- Catálogo de ítems canjeables (`grade_bonus` con `grade_points`, `fun_activity` con stock).
- Canje instantáneo con confirmación previa de costo/saldo y anulación (reversión de
  monedas y stock vía trigger).
- Rankings (global y por clase) leyendo las **vistas**, sin recalcular en código.
- **Minijuegos**: hoy `type: "minigame"` es solo un marcador; no hay tablas de
  configuración ni solución → **requiere proponer esquema y que se apruebe**.

### 5.5 Frontend (hoy solo el scaffold)
- Cliente HTTP único (`lib/api-client.ts`): token, refresco en 401, manejo de errores,
  `NEXT_PUBLIC_API_URL`. Prohibido `fetch` disperso con URLs escritas a mano.
- Rutas y layouts separados por rol (`/admin`, `/teacher`, `/student`) con middleware +
  validación de rol en servidor (el frontend no es barrera de seguridad).
- Estados base de UI: carga / vacío / error, componente de toast y accesibilidad
  (labels, foco, contraste) en toda vista con datos.
- Vistas: login y cambio de contraseña · panel del admin (organizaciones, usuarios) ·
  panel del profesor (clases, actividades, revisión/calificación, ítems) · panel del
  estudiante (dashboard, cuestionario, billetera, canjes, rankings, progreso).
- Decidir el destino del prototipo `educoins_platform.html` (referencia visual o
  descartado) para no mantener dos interfaces.

### 5.6 Calidad, seguridad y entrega
- `helmet` + CORS restringido al frontend, `ValidationPipe` global con `whitelist`,
  rate limiting, auditoría de que ninguna respuesta filtre `password_hash`,
  `is_correct` ni `expected_answer` al estudiante.
- Pruebas por funcionalidad (unit + e2e + casos negativos de rol/recurso ajeno/validación
  de BD) siguiendo el checklist de "terminado" de los guardrails.
- CI que ejecute `typecheck`, `lint`, `build`, `test`, `test:e2e` (+ build del frontend)
  en cada PR; rama `develop` y flujo de PR (hoy solo existen `main` y `Alejandro`).
- Despliegue de backend + frontend + PostgreSQL, variables de entorno fuera del repo,
  datos de demo sembrados y guía de arranque de 5 minutos.

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
