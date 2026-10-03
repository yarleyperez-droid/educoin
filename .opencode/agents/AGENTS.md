# AGENTS.md — EduCoins (Plataforma educativa gamificada)

> Este archivo es la **fuente de verdad para agentes de IA** (OpenCode) que trabajan en este repositorio.
> Léelo completo al iniciar cada sesión. Si algo aquí contradice tu memoria o tus suposiciones, **gana este archivo**.
> Si algo no está definido aquí ni en `docs/`, **pregunta; no lo inventes**.
> Funcionalidades **planificadas pero NO implementadas** viven en [`docs/post_mvp.md`](../../docs/post_mvp.md) — jamás asumas que existen en la BD.

---

## 1. Descripción del proyecto

**EduCoins** es una plataforma web educativa gamificada con tres roles: **administrador**, **profesor** y **estudiante**.

- El **administrador** registra organizaciones (escuelas/universidades) y crea las cuentas de profesores y estudiantes (usuario + contraseña inicial generada; el usuario debe cambiarla en el primer ingreso: `must_change_password`).
- El **profesor** crea **clases** (con código de unión), **actividades** con recompensa en monedas e **ítems canjeables**, y revisa/califica manualmente las entregas que no se auto-califican.
- El **estudiante** busca una clase por **nombre o código**, se inscribe, resuelve actividades, gana monedas (por clase y global) y las **canjea** por puntos extra de nota o actividades lúdicas. Existe un **ranking** global y por clase.

> **Alcance actual = MVP.** El esquema real de la BD está en `db/001_schema.sql` (9 tablas, nombres en inglés).
> Ideas ampliadas (modalidades automática/manual, tablas de minijuegos, aprobación de canjes…) están en
> `docs/post_mvp.md` como pendientes; **no existen todavía**.

### Equipo y responsabilidades (referencia)

| Dev | Área |
|---|---|
| Dev 1 | Backend, seguridad, modelos base, auth, middlewares de roles, subida segura de archivos |
| Dev 2 | Panel profesor/administrador, creación de actividades, revisión/calificación, editor con ecuaciones (KaTeX) |
| Dev 3 | Panel estudiante, UI/UX, minijuegos en frontend, billetera (canje) y ranking, estilos responsive |

---

## 2. Stack tecnológico

> ⚠️ **[PENDIENTE DE CONFIRMACIÓN DEL EQUIPO]** — el PDF del proyecto dice *"libre elección"* y todavía no
> existe `package.json` en el repo. **No instales dependencias ni generes andamiaje** hasta que el equipo
> confirme estas decisiones. La tabla es la propuesta de trabajo hasta entonces.

| Capa | Tecnología (propuesta) |
|---|---|
| Lenguaje | **TypeScript** (modo `strict`) en backend y frontend |
| Backend | **NestJS** (API REST) |
| Frontend | **Next.js** (App Router) |
| ORM | **Prisma** |
| Base de datos | **PostgreSQL 14+** (extensiones `citext` y `pg_trgm`) ✅ *ya usadas por `db/001_schema.sql`* |
| Ecuaciones | **KaTeX** en el frontend (para enunciados) |
| Hash de contraseñas | **argon2** (o bcrypt). Nunca texto plano |

**Versiones:** no asumas versiones de memoria. Lee `package.json` / `pnpm-lock.yaml` y usa la API de **la versión instalada**. Si dudas de cómo funciona una función de una librería, revisa sus tipos en `node_modules` o la documentación oficial antes de escribir código.

**Decisiones aún NO definidas** (pregunta antes de elegir; no las decidas tú):
- Confirmar el stack de arriba y la forma del repo (plano vs monorepo — ver `docs/post_mvp.md`).
- Librería de UI / CSS (Tailwind, shadcn, etc.).
- Almacenamiento de archivos (disco local, S3, Supabase Storage…).
- Gestor de paquetes si no existe lockfile (regla global del equipo: **pnpm**).
- Estrategia de despliegue.

---

## 3. Fuentes de verdad y orden de consulta

Antes de tocar datos, consulta en este orden:

1. **`db/001_schema.sql`** — script ejecutable real (tablas, enums, índices, triggers, funciones, vistas). **Es la máxima autoridad.**
2. `docs/plataforma_educativa_bd.md` — especificación: reglas de negocio, diagrama Mermaid, estructura JSONB, resultados de verificación.
3. `db/002_seed.sql` — datos de prueba (muestra de flujos reales).
4. `docs/post_mvp.md` — pendientes/planificados. **NO existen en la BD**; solo referencia de futuro.
5. Este archivo.

> Si un futuro `schema.prisma` y el SQL discrepan, **el SQL de `db/` gana**. Repórtalo, no lo "arregles" en silencio.

---

## 4. Estructura del repositorio

Estructura **actual** (real, verificada):

```
.
├── README.md                        # overview, comandos de creación de la BD
├── educoins_platform.html           # demo principal (prototipo UI autocontenido)
├── db/
│   ├── 001_schema.sql               # esquema completo (MVP) + docstring
│   └── 002_seed.sql                 # datos de prueba + docstring
├── docs/
│   ├── plataforma_educativa_bd.md   # especificación de la BD (§7 = verificación 12/12)
│   └── post_mvp.md                  # backlog de funcionalidades pendientes
└── .opencode/
    └── agents/
        └── AGENTS.md                # este archivo (guardrails del proyecto)
```

- **No crees carpetas ni archivos raíz nuevos sin aprobación** (excepto los que el plan de la tarea incluya).
- Cuando el backend exista, la propuesta de estructura (monorepo `apps/api` + `apps/web`) está en
  `docs/post_mvp.md` — **hasta que se confirme, no crees esa estructura**.

Convención de módulos del backend (cuando exista), siguiendo el nombre **real** de las tablas en inglés:

```
modules/<tabla>/            # p. ej. modules/enrollments/, modules/submissions/
├── <tabla>.module.ts
├── <tabla>.controller.ts
├── <tabla>.service.ts
├── dto/
│   ├── crear-<entidad>.dto.ts
│   ├── actualizar-<entidad>.dto.ts
│   └── <entidad>-respuesta.dto.ts   # lo que SALE hacia el cliente
└── <tabla>.service.spec.ts
```

---

## 5. Mapa del dominio (tablas reales → módulos)

Nombres **reales** de la BD (del `db/001_schema.sql`): inglés, `snake_case`, plural. **No inventes tablas ni columnas.** Si necesitas una que no existe, propónla y espera aprobación (o revisa si está en `docs/post_mvp.md`).

| Módulo | Tabla(s) real(es) | Notas |
|---|---|---|
| `organizations` | `organizations` | Solo el administrador las crea |
| `users` / `auth` | `users` | Tabla única para los 3 roles (`role`); sin subtipos en el MVP |
| `classes` | `classes` | `code` lo autogenera la BD; `name` único vía índice `lower(name)` |
| `enrollments` | `enrollments` | Contadores de monedas por clase + columna generada `coins_available` |
| `activities` | `activities` | Preguntas **embebidas en `questions` JSONB**; borrado lógico `status='deleted'` |
| `submissions` | `submissions` | Respuestas **embebidas en `answers` JSONB**; 1 entrega por actividad y estudiante |
| `redeemable_items` | `redeemable_items` | Tipos: `grade_bonus` (exige `grade_points`) \| `fun_activity` |
| `redemptions` | `redemptions` | **Canje instantáneo**: `completed` \| `reversed` (sin aprobación en MVP) |
| `coins` | `coin_movements` | Libro mayor/auditoría — el backend **solo lee** |
| `ranking` | vistas `global_ranking`, `class_ranking`, `student_coins` | Solo lectura |

### Enums (valores exactos — 10)

```
organization_type:  school | university | other
user_role:          admin | teacher | student
class_status:       active | archived
enrollment_status:  active | withdrawn | blocked
activity_status:    draft | published | deleted
submission_status:  in_progress | submitted | graded | rejected
item_type:          grade_bonus | fun_activity
item_status:        active | inactive | deleted
redemption_status:  completed | reversed
movement_type:      earning | spending | reversal | adjustment
```

### Tipos de pregunta (valores de `activities.questions[].type` — JSONB, validados en la app)

```
test | completion | file | minigame
```

---

## 6. Regla de oro: la lógica crítica vive en la base de datos

La BD implementa reglas de negocio con **triggers, funciones y constraints** (ver `db/001_schema.sql` §12). El backend **no las reimplementa ni las evita**; las usa y traduce sus errores.

| Situación | Qué hace la BD | Qué hace el backend |
|---|---|---|
| Inscripción | Trigger `fn_validate_enrollment`: estudiante y profesor deben compartir organización | Validar antes para dar un error amigable |
| Crear entrega | Trigger `fn_validate_submission`: actividad `published` y vigente, inscripción `active`, misma clase | Solo INSERT; traducir la excepción |
| Calificar | Cambiar `status` a `graded` → trigger `fn_award_coins` otorga `reward_coins` **una sola vez** e inserta el movimiento `earning` (garantizado por índice único parcial) | **Nunca** insertar en `coin_movements` ni tocar `coins_earned/coins_spent` |
| Contadores | Trigger `fn_apply_movement` actualiza `enrollments` con cada movimiento | Solo leer. `coins_available` es **columna generada** (no escribirla) |
| Canje | Triggers `fn_execute_redemption` (valida ítem/stock/clase y congela costo y puntos) + `fn_register_redemption` (descuenta monedas; `ck_enrollment_no_negative` impide saldo negativo) | Solo `INSERT` en `redemptions` (`enrollment_id`, `item_id`). No calcular costo ni descontar |
| Revertir canje | Cambiar `status` a `reversed` → trigger `fn_reverse_redemption` devuelve monedas y stock | Solo cambiar el `status` |
| Borrado lógico de actividad | `status='deleted'` + `deleted_at` | No `DELETE` físico |
| `updated_at` | Trigger `fn_set_updated_at` | No setearlo a mano |
| Ranking | Vistas `global_ranking` / `class_ranking` / `student_coins` | Consultarlas; no recalcular en código |

**Validación doble:** el backend valida primero (errores claros en español, HTTP correcto) y la BD es la red de seguridad final. Nunca confíes solo en una de las dos capas.

### Errores de BD → HTTP

Crea un `ExceptionFilter` en `common/filters` que traduzca:

| Origen | HTTP |
|---|---|
| Prisma `P2002` (único) | `409 Conflict` |
| Prisma `P2003` (FK) | `409` / `422` según el caso |
| Prisma `P2025` (no encontrado) | `404 Not Found` |
| `RAISE EXCEPTION` de triggers / `ck_enrollment_no_negative` | `422 Unprocessable Entity` con mensaje legible |
| Inesperado | `500` genérico, **sin filtrar detalles internos** al cliente |

---

## 7. Convenciones de Prisma (puntos donde los modelos suelen equivocarse)

> **Nota:** Prisma aún no existe en el repo. Esta sección aplica cuando el equipo confirme el stack (§2).

**Estrategia:** el SQL de `db/001_schema.sql` es la base. Lo que Prisma no puede expresar (triggers, funciones, vistas, índices funcionales/parciales, columnas generadas) se mantiene en **migraciones SQL manuales** dentro de `prisma/migrations/` (usar `--create-only` y editar). Para partir de una BD ya creada, sigue la guía oficial de *baselining* de Prisma. No uses `db push` como flujo normal.

**Nomenclatura en `schema.prisma`** (aplícala siempre igual):
- Modelos: `PascalCase` singular en español → `Usuario`, `Clase`, `Inscripcion`, con `@@map` al nombre **real en inglés** (`@@map("users")`, `@@map("classes")`, `@@map("enrollments")`).
- Campos: `camelCase` → `classId`, con `@map("class_id")`.
- Enums: `PascalCase` con `@@map` al nombre real (`@@map("submission_status")`); valores iguales a los de la BD.
- Nunca renombres tablas/columnas de la BD para "acomodar" Prisma: mapea con `@map`/`@@map`.

**Tipos y trampas conocidas:**
- `BIGINT` → `BigInt` en Prisma. **`BigInt` no se serializa a JSON**: convierte a `string` en los DTOs de respuesta (interceptor o mapper). Los IDs viajan como `string` en la API; parsea con un `ParseBigIntPipe` propio.
- `NUMERIC` → `Prisma.Decimal`. No lo trates como `number`; conviértelo explícitamente al responder.
- `CITEXT` (`username`, `email`): requiere la extensión habilitada y el tipo nativo correspondiente en Prisma. Verifica en la documentación de la versión instalada cómo declararlo (`@db.Citext` con la preview feature de extensiones, o `Unsupported`).
- **Columnas JSONB** (`activities.questions`, `submissions.answers`): se mapean como `Json?`. La app escribe/lee estructura, **la BD no valida el interior** más allá de `jsonb_typeof = 'array'` — valida con `zod`/DTOs antes de guardar.
- Índice único funcional `lower(name)` en `classes`, índice GIN `pg_trgm` y los índices únicos **parciales** de `coin_movements`: se crean por SQL manual; no los pierdas al regenerar el schema.
- El MVP **no tiene claves foráneas compuestas**. Si `docs/post_mvp.md` añade alguna, declárala con relaciones multi-campo (`fields: [a, b], references: [a, b]`) y su `@@unique` de soporte.
- `classes.code` tiene default en BD: **no lo envíes**.
- Vistas (`global_ranking`, `class_ranking`, `student_coins`): consúltalas con `$queryRaw` tipado (o la preview de views si el equipo la aprueba). No las modeles como tablas escribibles.
- Operaciones que mezclan varias tablas (entregas, calificación, canjes) van en `prisma.$transaction`.
- Prohibido `$queryRawUnsafe` y concatenar strings en SQL. Usa siempre `Prisma.sql` / tagged templates parametrizados.
- Un único `PrismaService` inyectable. Nunca instancies `new PrismaClient()` fuera de él.
- No uses `prisma migrate reset`, `db push --force-reset` ni borres datos **sin confirmación explícita** del usuario.

---

## 8. Convenciones de código (TypeScript)

### Generales
- `strict: true`. **Prohibido `any`** (usa `unknown` + validación o tipos concretos). Prohibido `// @ts-ignore` sin comentario justificado.
- ESLint + Prettier del repo. No cambies su configuración sin aprobación.
- Funciones pequeñas, una responsabilidad. Preferir `async/await`. Sin código muerto ni `console.log` olvidados.
- **Idioma:** términos del dominio en **español** en el código (`Actividad`, `Entrega`, `Inscripcion`); sufijos técnicos en inglés (`Service`, `Controller`, `Dto`, `Module`, `Guard`). Comentarios y mensajes de error al usuario en español. **En la BD y en `@@map` se usan los nombres reales en inglés.**
- Nombres de archivo: `kebab-case` (`redeemable-items.service.ts`). Clases: `PascalCase`. Variables/funciones: `camelCase`. Constantes: `UPPER_SNAKE_CASE`.
- Imports con alias (`@/…`) según `tsconfig`; sin rutas relativas profundas (`../../../`).

### Backend (NestJS)
- Arquitectura por módulos de dominio (sección 4). **Controller** = HTTP y validación; **Service** = lógica; **Prisma** solo se usa desde los Services.
- Validación de entrada con **DTOs** + `class-validator` / `class-transformer` y `ValidationPipe` global (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`).
- **Nunca devuelvas entidades Prisma crudas.** Mapea a DTOs de respuesta explícitos (evita filtrar `password_hash`, respuestas correctas ni el interior de `questions` que no corresponde al rol).
- Autorización con `@Roles(...)` + `RolesGuard` + `JwtAuthGuard`, **y además verificación de propiedad** en el Service:
  - Profesor: solo sus clases/actividades/ítems/entregas de sus clases.
  - Estudiante: solo sus inscripciones, entregas, redemptions y monedas.
  - Profesor y estudiante: solo datos de **su organización**.
- API REST con prefijo `/api/v1`, recursos en plural: `/classes`, `/activities`, `/submissions`, `/redemptions`.
- Códigos HTTP correctos: `201` crear, `204` sin cuerpo, `400` validación, `401`, `403`, `404`, `409`, `422`.
- Paginación estándar en listados: `?page=1&limit=20` → `{ data, meta: { total, page, limit } }`.
- Configuración por variables de entorno validadas al arrancar (`@nestjs/config`); no leas `process.env` suelto en el código.
- Documenta la API con Swagger (`@nestjs/swagger`); es el contrato con el frontend.

### Frontend (Next.js)
- **App Router**. Componentes de servidor por defecto; `"use client"` solo cuando haya estado, efectos o eventos (minijuegos, formularios interactivos).
- Rutas separadas por rol con route groups; protege con middleware **y** valida el rol en el servidor (el frontend no es una barrera de seguridad).
- Todas las llamadas HTTP pasan por `lib/api-client.ts`. Prohibido `fetch` disperso con URLs escritas a mano.
- Formularios con `react-hook-form` + `zod` (si el equipo ya los tiene instalados; si no, pregunta).
- Tipos de la API: derivados del contrato (Swagger/DTOs). No dupliques tipos "a ojo".
- Estados de UI obligatorios: carga, vacío y error en toda vista con datos.
- Responsive (mobile-first) y accesibilidad básica (labels, foco, contraste).
- **KaTeX:** renderiza ecuaciones solo desde contenido saneado (ver sección 9).
- Minijuegos: **aún no existen en la BD** (ver `docs/post_mvp.md`); cuando se implementen, un componente por tipo en `components/features/minijuegos/` con interfaz común, y el frontend **nunca** conoce la solución.

### Git
- Ramas: `main` (solo Tech Lead) → `develop` → `feature/devX-nombre-tarea`.
- **Prohibido commit directo a `main` o `develop`.** Trabaja en la rama `feature/...` indicada por el usuario.
- Commits en formato *Conventional Commits*: `feat(submissions): guardar respuestas JSONB`, `fix(redemptions): …`, `docs: …`.
- No hagas `git push`, `merge`, `rebase` ni `reset --hard` salvo que el usuario lo pida explícitamente.
- Nunca subas `.env`, secretos, llaves ni volcados de datos reales.

---

## 9. Seguridad (no negociable)

1. **SQL/NoSQL injection:** solo Prisma o `Prisma.sql` parametrizado. Nunca concatenar variables en consultas.
2. **XSS:** todo texto de usuario se escapa al renderizar. Si se admite formato enriquecido o ecuaciones, sanear con una librería de saneamiento (allow-list) antes de guardar/mostrar. Prohibido `dangerouslySetInnerHTML` con contenido sin sanear.
3. **Contraseñas:** hash con argon2/bcrypt generado **por la aplicación**. Nunca texto plano, nunca en logs, nunca en respuestas. El admin genera la contraseña inicial con `must_change_password = true`.
4. **Autenticación:** JWT de acceso de vida corta + refresh token. Preferir cookies `httpOnly`, `secure`, `sameSite`. Rate limiting en login.
5. **No filtrar respuestas correctas:** mientras un estudiante resuelve, la API **nunca** incluye `activities.questions[].options[].is_correct`, `questions[].expected_answer` ni el campo `answers[].is_correct` ajeno. Usa DTOs distintos para profesor y estudiante.
6. **Subida de archivos:** solo `application/pdf`, `image/jpeg`, `image/png`; límite de tamaño; valida el tipo real (no solo la extensión); nombre de archivo generado por el servidor (UUID); en la BD solo se guarda la ruta dentro de `submissions.answers[].files[]` (decisión de almacenamiento pendiente, §2); descarga con autorización (solo el estudiante dueño y el profesor de la clase).
7. **Autorización por recurso:** nunca confiar en un `id` que llega del cliente sin comprobar que pertenece al usuario/organización autenticado (previene IDOR).
8. **Secretos** solo en variables de entorno; mantén un `.env.example` sin valores reales.
9. CORS restringido al origen del frontend. `helmet` activado.

---

## 10. Protocolo anti-alucinación (OBLIGATORIO para el agente)

### Antes de escribir código
1. **Lee antes de escribir.** Abre los archivos relacionados (`db/001_schema.sql`, la especificación en `docs/`, módulos, DTOs). No asumas su contenido.
2. **Verifica que existe** todo lo que vas a usar: tabla, columna, enum, endpoint, función, componente, paquete. Búscalo en el repo (`grep`/búsqueda de archivos). Si no lo encuentras en `db/` ni en el código, **no lo inventes**: revisa si está en `docs/post_mvp.md` (existe solo como plan) y, si tampoco, dilo y pregunta.
3. **No importes paquetes que no estén en `package.json`.** Si hace falta una dependencia nueva, propónla (nombre, motivo, alternativa) y espera aprobación antes de instalarla.
4. **No adivines APIs de librerías.** Si no estás 100 % seguro de la firma de una función de Nest, Prisma o Next, revisa los tipos en `node_modules` o la documentación oficial de la versión instalada.
5. **Declara tus suposiciones** en una línea al empezar ("Asumo que X porque Y"). Si la suposición afecta al diseño, pregunta primero.

### Mientras trabajas
6. **Cambios pequeños y acotados.** Un módulo o una funcionalidad por vez. No refactorices ni "mejores" código que no te pidieron tocar.
7. **No modifiques el esquema de BD** (SQL, `schema.prisma`, migraciones) sin aprobación explícita. Es la zona de mayor riesgo.
8. **No reimplementes lo que ya hace la BD** (sección 6): monedas, contadores, stock, validaciones de entrega/canje.
9. **No inventes endpoints, campos ni respuestas** del backend desde el frontend: consulta el controller/Swagger real.
10. **No dejes `TODO` vacíos ni código "de ejemplo"** que aparente funcionar. Si algo no se puede completar, indícalo claramente.
11. **No simules datos** ("mock") en código de producción sin marcarlo y avisarlo.
12. Mantén el **mismo patrón** que los módulos existentes. Antes de crear uno nuevo, copia la estructura de uno ya hecho.

### Después de escribir código
13. **Verifica con comandos reales**, no con "creo que funciona":
    - `pnpm typecheck` / `tsc --noEmit`
    - `pnpm lint`
    - `pnpm test` (y pruebas e2e si tocas endpoints)
    - `pnpm prisma validate` / `prisma generate` si tocaste el schema
    *(Usa los scripts que existan en `package.json`; si un script no existe, no lo inventes: dilo.)*
14. **Si un comando falla, lee el error completo** y corrige la causa. No silencies errores, no desactives reglas de lint, no uses `any` para "hacer que compile".
15. **Informa con honestidad:** al terminar, resume qué hiciste, qué verificaste, qué **no** pudiste verificar y qué queda pendiente. Nunca afirmes que algo funciona si no lo ejecutaste.

### Cuando dudes
16. **Pregunta** si hay ambigüedad en una regla de negocio, una decisión de diseño o un requisito. Una pregunta corta es mejor que un módulo entero construido sobre una suposición.
17. Ante conflicto entre una instrucción del usuario y este archivo, **avisa del conflicto** antes de actuar.
18. Si el contexto se vuelve largo o confuso, **re-lee `AGENTS.md` y los archivos relevantes** en lugar de continuar de memoria.

### Cómo trabajar con tareas grandes
- Divide en pasos y **propón un plan breve antes de implementar** cualquier tarea que toque más de ~3 archivos o más de un módulo.
- Orden recomendado de construcción (cuando el backend exista): `config + prisma` → `auth + roles` → `organizations/users` → `classes/enrollments` → `activities` → `submissions + calificación` → `redeemable_items/redemptions` → `ranking` → frontend por rol.
- Termina cada paso con el código compilando y las pruebas pasando antes de empezar el siguiente.

---

## 11. Flujos de negocio de referencia (MVP actual)

### Resolver una actividad (estudiante)
1. El estudiante crea la entrega (`INSERT` en `submissions`). La BD valida: actividad `published` y vigente, inscripción `active`, misma clase → si falla, `422`.
2. El backend evalúa las respuestas contra `activities.questions` (`test`/`completion` por `is_correct`/`expected_answer`; validación de `file` y puntuación de `minigame` — **minijuegos sin implementar**, ver `docs/post_mvp.md`) y guarda el resultado en `submissions.answers` (JSONB) con puntaje y `score` de la entrega.
3. El backend pasa la entrega a `submitted` (manual) o directamente a `graded` (auto-calificada).
4. Al llegar a `graded`, el trigger `fn_award_coins` otorga `reward_coins` **una sola vez** e inserta el movimiento `earning` → contadores y rankings se actualizan solos.
5. El profesor también puede calificar manualmente (`graded`, con `graded_by` y `feedback`) o rechazar (`rejected`).

### Canje (instantáneo — sin aprobación en MVP)
1. Estudiante: `INSERT` en `redemptions` (`enrollment_id`, `item_id`). El trigger congela `cost_coins`/`grade_points`, descuenta stock y registra el movimiento `spending`.
2. Si no alcanza el saldo → `ck_enrollment_no_negative` → `422` (la operación completa se revierte).
3. Si se anula un canje: `status = 'reversed'` → el trigger devuelve monedas y stock.

### Ranking
Se basa en **monedas ganadas** (gastar no baja la posición). Leer de las vistas `global_ranking` / `class_ranking`, no recalcular en código.

---

## 12. Definición de "terminado" (checklist por tarea)

- [ ] Compila sin errores (`tsc`) y pasa lint.
- [ ] Pruebas unitarias/e2e relevantes añadidas y en verde.
- [ ] DTOs de entrada validados; DTOs de salida explícitos (sin datos sensibles).
- [ ] Autorización por rol **y** por propiedad/organización verificada.
- [ ] Errores de BD traducidos a HTTP correctos.
- [ ] Sin `any`, sin secretos, sin `console.log`, sin SQL concatenado.
- [ ] Coherente con `db/001_schema.sql` y `docs/` (nombres de tablas, columnas, enums).
- [ ] Swagger actualizado (backend) / estados carga-vacío-error cubiertos (frontend).
- [ ] Resumen final honesto: hecho, verificado, pendiente.

---

## 13. Variables de entorno (propuesta de nombres)

Define los nombres exactos en `.env.example` y valida al arrancar. Valores reales **nunca** en el repo.

```
DATABASE_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=
JWT_REFRESH_EXPIRES_IN=
FRONTEND_URL=
UPLOAD_MAX_BYTES=
NEXT_PUBLIC_API_URL=
```

---

## 14. Recomendaciones de uso con OpenCode (para el equipo humano)

- Este archivo vive en **`.opencode/agents/AGENTS.md`** (convención del proyecto; OpenCode también lee un `AGENTS.md` en la raíz si lo hubiera).
- Consulta la especificación de la BD por ruta (`docs/plataforma_educativa_bd.md`) en lugar de pegarla completa en cada prompt; lo mismo con `docs/post_mvp.md` cuando se planifique futuro.
- Da **una tarea por prompt**, con rama, módulo y criterio de aceptación. Ejemplo:
  > *"En `apps/api/src/modules/submissions` (cuando exista), implementa el guardado de respuestas JSONB siguiendo la sección 11 de AGENTS.md. Tabla: `submissions`. Solo el estudiante dueño de la inscripción. Primero muéstrame el plan."*
- Pide **plan antes de código** en tareas grandes y revisa el diff antes de aceptar.
- Si el agente inventa algo, respóndele con la regla concreta ("sección 10, punto 2: esa tabla no existe") y pídele que busque en el repo.
- Reinicia la sesión entre módulos distintos para no arrastrar contexto viejo.
