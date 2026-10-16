# EduCoins — Post-MVP (backlog + plan)

> **⚠️ Nada de lo que aparece en este documento existe en la base de datos actual**, salvo lo indicado como ✅ resuelto.
> Son funcionalidades **planificadas / propuestas** que se dejaron fuera del MVP de testeo
> (esquema real: `db/001_schema.sql` — 9 tablas) pero que **no se descartan**.
>
> **Regla para agentes y equipo:** antes de implementar cualquier ítem de aquí,
> proponer el cambio de esquema (SQL + especificación + diagrama) y esperar aprobación.
> No referirse a estas tablas/columnas/funciones como si ya existieran (AGENTS.md §10, punto 2).
>
> **Fuente de verdad de la ejecución:** Linear (workspace projectsU, team Integrator). Este documento concentra el backlog y los planes de las épicas E7 (Parte II) y E8 (Parte III); el estado diario (asignaciones, avance) vive en los issues de Linear.
>
> **Ficha técnica oficial:** `docs/EduCoin.md` (Plan de Dirección Técnica v1.0). La trazabilidad completa de requisitos → estado está en **§0** de la Parte I.
>
> Cada ítem del backlog indica: **Origen** · **Impacto en la BD** · **Prioridad** · **Estado del plan**.

---

## Parte I — Backlog de funcionalidades

### 0. Trazabilidad con la ficha técnica (`docs/EduCoin.md`)

Cobertura de cada requisito de la ficha oficial respecto a lo planificado:

| Requisito de la ficha (sección) | Rol | Estado | Dónde |
|---|---|---|---|
| Stack libre + REST/API + frontend separado (§1) | — | ✅ MVP | NestJS + Next.js |
| BD MySQL/PostgreSQL/MongoDB (§1) | Dev 1 | ✅ MVP | PostgreSQL + Prisma |
| Editor de ecuaciones KaTeX/MathJax — **render** en el frontend (§1) | Dev 3 | ✅ MVP planeado | H5.8 / T5.8.1 (KaTeX saneado) |
| Modelos base: User, Activity, Submission, Coin (§2.1) | Dev 1 | ✅ MVP | H1.0 + `db/001_schema.sql` |
| Autenticación central + middlewares de roles (§2.1) | Dev 1 | ✅ MVP | H2.1–H2.3, guards globales |
| Subida segura de archivos imágenes/PDF (§2.1) | Dev 1 | ✅ MVP planeado | H3.4 (validación MIME, `UPLOAD_MAX_BYTES`) |
| Creación de actividades: texto y opción múltiple (§2.2) | Dev 2 | ✅ MVP planeado | H3.3 + H5.6 |
| **Creación de actividades tipo minijuego (§2.2)** | Dev 2 | 🟡 **Planificado** | §4 + **Parte III** (épica E8) |
| Módulo de revisión y calificación de entregas (§2.2) | Dev 2 | ✅ MVP | H3.5 + H5.9 |
| **Editor de texto y ecuaciones KaTeX para los enunciados del profesor (§2.2)** | Dev 2 | 🟡 **Planificado** | §10 + **E9** (S12) |
| Interfaz del estudiante y resolución de actividades (§2.3) | Dev 3 | ✅ MVP planeado | H5.8 |
| **Lógica de minijuegos en frontend — ordenar palabras, memoria (§2.3)** | Dev 3 | 🟡 **Planificado** | §4 + **Parte III** (épica E8) |
| Billetera (canje de monedas) y ranking general (§2.3) | Dev 3 | ✅ MVP | H5.7 + H4.3/H5.10 |
| **Estilos globales y responsive design (§2.3)** | Dev 3 | 🟡 **Planificado** | §11 + **E9** (S13) |
| Flujo Git: `main` → `develop` → `feature/…`, sin commits directos (§3) | — | ✅ MVP | H6.2 (naming `feature/H…` en vez de `feature/devX-…`; desviación acordada) |
| Prevención SQL/NoSQL con prepared statements/ORM (§4) | — | ✅ MVP | Prisma (queries parametrizadas) |
| Prevención XSS: escapado/saneado de datos de usuario (§4) | — | 🟡 Parcial | KaTeX saneado en T5.8.1; saneado general de outputs documentado en AGENTS.md — sin criterio de historia explícito |
| Contraseñas nunca en texto plano — bcrypt/Argon2 (§4) | — | ✅ MVP | argon2id en H2.1 + seed con hashes reales |

**Conclusión para llegar al 100% de la ficha:** cerrar el MVP no basta. Quedan pendientes: **minijuegos (§4, planificados como épica E8)**, **editor KaTeX del profesor (§10, épica E9)** y **responsive (§11, épica E9)**. Los tres ya están publicados en Linear con historias, subtareas, asignaciones y estimaciones.

### 1. Decisiones abiertas

#### 1.1 Stack tecnológico — ✅ Resuelto en el MVP
- **Decidido y en uso:** TypeScript + NestJS (backend, raíz) + Next.js 16 (frontend, `frontend/`) + Prisma 7 + pnpm.
- Sin acción pendiente.

#### 1.2 Forma del repo (plano vs monorepo) — 🟡 Pendiente
- **Qué:** mantener el repo plano (actual: backend en la raíz + `frontend/` aparte, dos apps sin workspace) o migrar a monorepo:
  `apps/api/` (NestJS) + `apps/web/` (Next.js) + `packages/shared/`.
- **Origen:** propuesta del equipo (descrita originalmente en AGENTS.md §4).
- **Impacto:** reorganización de carpetas, paths, tooling; README y AGENTS §4 se actualizan.
- **Estado del plan:** sin historias; decisión diferida (el `pnpm-workspace.yaml` actual solo contiene `allowBuilds`, no define packages).

### 2. Sistema de modalidades de actividad (automática / manual)

- **Qué:** cada actividad tendría una modalidad **inmutable** tras la primera pregunta:
  - **Automática:** preguntas `test`/`completion` + minijuegos; la plataforma califica sola
    con una función `fn_calificar_automatica(activity_id)` que suma puntajes y cierra la entrega
    (`calificada` si `puntaje ≥ porcentaje_aprobacion`, si no `rechazada`).
  - **Manual:** preguntas de interpretación y archivo; flujo `en_progreso → enviada → calificada | rechazada`
    con revisión del profesor (`calificado_por`, retroalimentación).
- **Origen:** propuesta del equipo (ampliación sobre el PDF, que pide "texto, opción múltiple, minijuego"
  y "módulo de revisión y calificación (aprobación/rechazo)").
- **Impacto en la BD:**
  - `activities.modalidad` (`ENUM modalidad_actividad: automatica | manual`) + `NOT NULL`.
  - `activities.porcentaje_aprobacion NUMERIC` (umbral de aprobación automática).
  - `preguntas.modalidad` si `preguntas` se separa en tabla (ver §3) + trigger `fn_preguntas_modalidad`.
  - Función `fn_calificar_automatica(entrega_id)` + trigger `fn_validar_calificacion`
    (que `graded_by` sea el profesor de la clase).
  - Restricción "no mezclar modalidades" (CHECK o trigger).
- **Prioridad:** 🟡 Media — el MVP ya cubre ambos caminos de forma simple
  (auto-calificación en backend + `fn_award_coins`, y manual con `graded_by`).
- **Estado del plan:** sin historias planificadas.

### 3. Tabla `preguntas` independiente (hoy es JSONB)

- **Qué:** sacar `activities.questions` de la columna JSONB a una tabla `questions`
  (+ `options` si se necesita), para puntuación por pregunta, reordenar, editar sin reescribir el array
  y mantener historial de versión.
- **Origen:** diseño original del modelo (pre-MVP); postergada para simplificar el MVP.
- **Impacto:** tabla `questions` con `UNIQUE(activities_id, position)`,
  FK desde respuestas, posible `answers` también tabular; ajustar `fn_award_coins`/calificación.
- **Prioridad:** 🟡 Media — necesaria cuando se requiera analítica por pregunta.
- **Estado del plan:** sin historias planificadas.

### 4. Minijuegos como pregunta de actividad — ✅ Planificado (épica E8)

- **Qué:** soporte real de minijuegos (`ordenar_frase`, `crucigrama`, `sopa_letras`, `emparejar`,
  `memoria`, `arrastrar_soltar`, `adivina_palabra`) con configuración y solución guardadas,
  y registro de la respuesta del estudiante.
- **Origen:** **`docs/EduCoin.md`** — requisito explícito de dos roles: Dev 2 ("creación de
  actividades: texto, opción múltiple, **minijuego**") y Dev 3 ("**lógica de minijuegos en
  frontend** — ordenar palabras, memoria").
- **Estado:** en el MVP, `activities.questions[].type = 'minigame'` es solo un marcador;
  **no hay tablas de configuración ni solución**.
- **Impacto en la BD:**
  - Tabla `minijuegos` (`actividad_id`, `tipo_minijuego` ENUM con los 7 tipos,
    `configuracion JSONB`, `solucion JSONB`).
  - Tabla `respuestas_minijuego` (`entrega_id`, `minijuego_id`, `respuesta JSONB`,
    `es_correcta`, `puntaje_obtenido`).
  - La **solución nunca sale al frontend**; la comparación ocurre en el backend.
- **Prioridad:** 🔴 Alta — es requisito explícito de la ficha técnica (`docs/EduCoin.md`) para la demo final.
- **Estado del plan:** **planificado y aprobado** como épica E8 (piloto `ordenar_frase` + `memoria`, auto-calificación backend, sin pistas desbloqueables — decisión del PO 2026-10-15) — ver **Parte III** de este documento.

### 5. Canje con aprobación del profesor — ✅ Planificado (épica E7)

- **Qué:** flujo de canje revisable: `pendiente → aprobado | rechazado → entregado`,
  con reversión automática (monedas + stock) al rechazar.
- **Origen:** diseño original (regla "resuelve los canjes" del rol profesor).
- **Estado MVP:** canje **instantáneo** (`redemption_status: completed | reversed`) —
  elegido para simplificar el testeo.
- **Impacto:** ampliar `redemption_status` con `pending | approved | rejected | delivered`,
  trigger de reversión al `rejected`, campo `resolved_by`/`resolved_at`.
- **Prioridad:** 🟡 Media.
- **Estado del plan:** **planificado y en ejecución** como épica E7 con las historias H7.1–H7.5 —
  ver **Parte II** de este documento. Issues en Linear (PRO-422…PRO-440).

### 6. Tablas y objetos del diseño original (pre-MVP)

| Ítem | Qué aporta | Impacto | Prioridad |
|---|---|---|---|
| Subtipos de usuario (`administradores`, `teachers`, `students`) | Columnas específicas por rol con integridad FK (especialidad, grado, es_superadmin) | 3 tablas 1:1 + FK compuesta `(id, role)`; hoy son columnas opcionales en `users` | 🟢 Baja |
| `equivalencias_nota` | Varios tipos de cambio monedas→nota por clase (hoy la equivalencia vive en cada ítem: `cost_coins` ↔ `grade_points`) | Tabla nueva + FK desde `redeemable_items` | 🟢 Baja |
| Historiales como vistas (`vista_historial_actividades`, `vista_historial_canjes`, `vista_realizaron_actividad`) | Consultas de historial listas | 3 vistas nuevas (hoy son queries directas) | 🟢 Baja |
| `pending_reviews` / `vista_pendientes_revision` | Cola de entregas por revisar para el profesor | 1 vista | 🟢 Baja |
| Varios intentos por actividad | `UNIQUE(submission)` → columna `attempt` | Cambio de restricción única | 🟢 Baja |
| Ranking por organización | `PARTITION BY organization_id` en vista derivada | Vista nueva | 🟢 Baja |
| Recompensa condicionada (`porcentaje_minimo`) | Exigir nota mínima para ganar monedas | Columna + trigger `fn_award_coins` ampliado | 🟢 Baja |
| Row Level Security (RLS) | Aislamiento por rol a nivel BD | Policies en todas las tablas | 🟢 Baja |

- **Estado del plan:** sin historias planificadas (todas 🟢 Baja).

### 7. Decisiones técnicas pendientes

- **Almacenamiento de archivos:** 🟡 Pendiente — disco local / S3 / Supabase Storage.
  La BD solo guarda la ruta (`submissions.answers[].files[].path`).
- **Despliegue:** ✅ cubierto en el MVP (H6.5 / plan MVP, sprint S5).
- **Gestor de paquetes:** ✅ resuelto — pnpm.
- **Librería de UI/CSS:** ✅ resuelta — Tailwind 4 (+ KaTeX).

### 8. Notificaciones (email / push)

- **Qué:** avisar a estudiantes y profesores de eventos relevantes: canje resuelto (aprobado/rechazado),
  entrega calificada, monedas acreditadas, actividad nueva o con fecha límite.
- **Origen:** exclusión explícita de la épica E7 (el plan del canje revisable la dejó fuera);
  necesidad operativa (hoy el estudiante solo se entera al abrir su billetera).
- **Impacto en la BD:** tabla `notifications` (`user_id`, `tipo`, `payload JSONB`, `read_at`),
  servicio de envío (email transaccional y/o push), plantillas; sin cambios en flujos existentes.
- **Prioridad:** 🟡 Media — mejora la experiencia pero no bloquea la demo.
- **Estado del plan:** sin historias planificadas.

### 9. WebSockets para ranking en tiempo real

- **Qué:** que el ranking global de la clase/organización se actualice en tiempo real sin recargar la página.
- **Origen:** diseño original pre-MVP (fuera de alcance del MVP según el backlog histórico del proyecto).
- **Impacto en la BD:** sin cambio de esquema; gateway WebSocket en el backend (NestJS) + suscripción del frontend.
- **Prioridad:** 🟢 Baja — el ranking con refresh manual del MVP es suficiente para la demo.
- **Estado del plan:** sin historias planificadas.

### 10. Editor de texto y ecuaciones KaTeX para enunciados del profesor

- **Qué:** que al crear/editar una actividad, el profesor disponga de un editor de texto
  enriquecido básico con inserción y preview de ecuaciones KaTeX en el enunciado y en los
  prompts de las preguntas (el estudiante ya las renderiza con T5.8.1, pero el autor no
  tiene herramienta para escribirlas cómodamente).
- **Origen:** **`docs/EduCoin.md`** §2.2 — "Integración del editor de texto y ecuaciones
  matemáticas (KaTeX) para los enunciados" (responsabilidad de Dev 2).
- **Estado MVP:** H5.6 / T5.6.2 define el "editor de preguntas" como formulario según el
  contrato zod, **sin criterio explícito de editor KaTeX**; KaTeX está instalado en el
  frontend pero solo se usa (o se usará) para render en H5.8.
- **Impacto en la BD:** ninguno — es frontend puro (el JSONB `questions[].prompt` ya admite
  texto con sintaxis KaTeX). Dependencia: paquete `katex` ya instalado.
- **Prioridad:** 🟡 Media — requisito de la ficha para Dev 2; esfuerzo acotado.
- **Estado del plan:** **planificado como épica E9 (H9.1, sprint S12)**; publicado en Linear con subtareas. Verificar primero si T5.6.2 del MVP ya incluye inserción KaTeX (si la incluye completamente, cerrar H9.1).

### 11. Responsive design (mobile-first)

- **Qué:** que todos los paneles (admin, profesor, estudiante) funcionen y se vean
  correctamente en móvil y tablet, no solo en desktop.
- **Origen:** **`docs/EduCoin.md`** §2.3 — "Estilos globales y responsive design"
  (responsabilidad de Dev 3).
- **Estado MVP:** el kit UI (H5.2) es accesible (WCAG AA) pero **ninguna historia exige
  criterios responsive**; AGENTS.md lo menciona como estándar ("responsive (mobile-first)")
  sin criterios de aceptación verificables.
- **Impacto en la BD:** ninguno — frontend puro (breakpoints Tailwind, layout de paneles).
- **Prioridad:** 🟡 Media — requisito explícito de la ficha; auditoría + ajustes puntuales.
- **Estado del plan:** **planificado como épica E9 (H9.2, sprint S13)**; publicado en Linear con subtareas de auditoría y ajuste por panel.

---

## Historial de cambios (Parte I)

| Fecha | Cambio |
|---|---|
| 2026-10-02 | Creación del backlog al corregir `AGENTS.md`: contenido obsoleto/inventado movido aquí en lugar de borrarse; el esquema MVP real (9 tablas, inglés) quedó como única fuente de verdad en `db/001_schema.sql`. |
| 2026-10-15 | Unificación con el plan post-MVP (`plan-historias.md`, fusionado como Parte II y eliminado como archivo suelto). §1.1 y §7 actualizados (stack, pnpm y UI resueltos en el MVP); §5 marcado como planificado (E7); nuevo §8 Notificaciones; §4 marca el hueco de planificación de minijuegos. |
| 2026-10-15 | Trazabilidad contra la ficha técnica oficial (`docs/EduCoin.md`): nueva §0 con la tabla requisito→estado; §4 actualiza su origen (ficha, Dev 2 + Dev 3); nuevos §10 (editor KaTeX del profesor) y §11 (responsive design). |
| 2026-10-15 | Épica E8 aprobada por el PO: minijuegos como pregunta de actividad (piloto `ordenar_frase` + `memoria`, auto-calificado en backend, sin pistas desbloqueables). §0 y §4 actualizados a "planificado"; nueva **Parte III** con el plan completo. |
| 2026-10-15 | Replanificación post-MVP y publicación en Linear: fechas corregidas para iniciar el 26 oct; creadas épicas E7, E8 y E9 como proyectos de Linear; historias PRO-447…PRO-458 y subtareas PRO-459…PRO-503 publicadas con asignaciones, estimaciones y prefijos de sprint; nueva **Parte IV** para E9.

---

## Parte II — Plan: Épica E7 · Canje con aprobación

> Épica en ejecución en Linear (team Integrator / workspace projectsU). Esta sección es la referencia del plan; el estado diario está en los issues.

### Resumen
- Objetivo: que el canje de monedas pase del canje instantáneo del MVP a un flujo revisable por el profesor (`pendiente → aprobado | rechazado → entregado`) con reversión íntegra de saldo y stock al rechazar.
- Equipo: 3 personas — Front (tú), Backend (jhon), TBD/QA (julian).
- Enfoque de división: flujo de trabajo (2–3 personas) + spike de esquema — porque el valor está en la cadena canje y las UIs se construyen en paralelo.
- Sprint: 1 semana, arranque **26 oct** (post-MVP inicia inmediatamente tras el MVP; las fechas anteriores de 18 nov estaban desactualizadas).
- Capacidad por carril: 6 pts front · 8 pts back · 6 pts QA por sprint.
- Numeración de sprints: continúa la secuencia del MVP (S6 en adelante) para aprovechar los ciclos de Linear. Los títulos de las historias en Linear incluyen el prefijo `[S6·...]` para facilitar la asignación manual al ciclo correspondiente.
- Hitos: ninguno.
- Suposiciones:
  - El esquema se aprueba dentro de H7.1 (regla de este documento: proponer y esperar aprobación antes de implementar).
  - Las monedas y el stock se descuentan al solicitar (reserva) y se revierten al rechazar, porque el backlog pide "reversión automática (monedas + stock) al rechazar".
  - El canje instantáneo del MVP (`completed`/`reversed`) coexiste hasta que H7.2 cambie el estado inicial de la solicitud a `pending`.
  - IDs continúan la secuencia del plan MVP: E7, H7.x, T7.x.x (las épicas E1–E6 del MVP están en Linear marcadas `[OBSOLETO — archivar]`).
  - Los carriles quedan ociosos en algunos sprints por la cadena de dependencias; no hay historias movibles sin romper el orden "nunca en sprint anterior o igual al de su bloqueadora".
  - Cycles del team Integrator ya están habilitados (verificado 2026-10-08); el ciclo auto 12–19 oct no se solapa con estos sprints.

### Sprints
| Sprint | Fechas | Meta del sprint | Historias | Carga (Front·Back·QA) |
|---|---|---|---|---|
| S6 | 26 oct–1 nov | El esquema del canje revisable está aprobado y las UIs de estudiante y profesor quedan listas contra el contrato | H7.1, H7.3, H7.4 | 6·2·0 |
| S7 | 2–8 nov | La API crea canjes pendientes, los resuelve (aprobar/rechazar) y revierte monedas y stock al rechazar | H7.2 | 0·5·3 |
| S8 | 9–15 nov | El flujo completo canje revisable pasa de extremo a extremo en la suite E2E | H7.5 | 0·0·3 |

### E7 — Canje con aprobación del profesor
- Resumen: canjes de monedas que el profesor aprueba o rechaza, con reversión automática de saldo y stock, en lugar del canje instantáneo actual.
- Sprints que la abarcan: S6, S7, S8

#### Descripción de la épica
**Objetivo de negocio:** dar al profesor el control sobre los canjes de su clase (evitar canjes abusivos o desinformados) manteniendo saldo y stock siempre consistentes. Extiende el MVP, que canjea instantáneamente sin revisión.

**Alcance**
- Incluye: estados `pending | approved | rejected | delivered` del canje, reserva y reversión de monedas/stock, cola de pendientes del profesor, billetera del estudiante con nuevos estados, aprobación/rechazo desde la UI, suite E2E de regresión, propuesta y aprobación del cambio de esquema.
- No incluye: notificaciones (email/push — ver §8), aprobación múltiple, motivo obligatorio de rechazo, filtros avanzados de la cola, cambios a otros flujos del MVP, minijuegos o modalidades de actividad.

**Usuarios involucrados:** estudiante (solicita y consulta sus canjes), profesor (aprueba o rechaza los canjes de sus clases).

**Historias que la componen**
- H7.1 — Propuesta y aprobación del esquema del canje revisable
- H7.2 — Canje revisable en la API (pendiente → aprobado/rechazado → entregado)
- H7.3 — Billetera del estudiante con estados del canje
- H7.4 — Cola de aprobación de canjes del profesor
- H7.5 — Suite E2E del flujo canje revisable

**Criterio de éxito:** ningún canje llega a entregado sin aprobación del profesor; todo rechazo devuelve exactamente las monedas y el stock previos (verificado en BD); el recorrido completo pasa en la suite E2E.

**Riesgos y suposiciones:** el trigger de reversión es el riesgo principal (duplicar movimientos si no es transaccional); la aprobación del esquema (H7.1) puede cambiar el diseño; el canje instantáneo coexiste hasta H7.2.

**Dependencias con otras épicas:** E4 — Economía y canje del MVP (H4.4, canje instantáneo) y E5 — Panel del profesor del MVP (H5.7, billetera y cola), ya publicadas en Linear.

### H7.1 — Propuesta y aprobación del esquema del canje revisable
- Etiquetas: historia, habilitadora, spike-técnico
- Prioridad: 1
- Estimación: 2
- Carga: 0·2·0
- Sprint: S1
- Rol sugerido: Backend (jhon)
- Bloqueada por: —

#### Descripción de la historia
**Como** equipo técnico de EduCoins, **quiero** contar con una propuesta de cambio de esquema aprobada para el canje revisable, **para que** implementemos los estados pendiente/aprobado/rechazado sin romper el flujo del MVP.

**Contexto:** §5 de este documento exige proponer el cambio (SQL + especificación + diagrama) y esperar aprobación antes de implementar. El MVP canjea instantáneamente (`completed`/`reversed`); el nuevo flujo agrega estados intermedios y columnas de resolución.

**Alcance**
- Incluye: especificación SQL del enum ampliado, columnas `resolved_by`/`resolved_at`, trigger de reversión al rechazar; diagrama de transiciones; checklist de impacto sobre las 9 tablas del MVP y `fn_award_coins`.
- No incluye: ejecutar la migración, modificar código de la API ni de la UI.

**Criterios de aceptación**
- [ ] **Escenario 1 — Transiciones válidas:** Dado el diagrama propuesto, cuando el equipo lo revisa, entonces las únicas transiciones permitidas son pendiente→aprobado, pendiente→rechazado y aprobado→entregado, y quedan documentadas.
- [ ] **Escenario 2 — Compatibilidad MVP:** Dado el flujo actual (`completed`/`reversed`), cuando se compara con la propuesta, entonces la propuesta lo conserva o documenta explícitamente su migración.
- [ ] **Escenario 3 — Sin implementación prematura:** Dado que la propuesta no está aprobada, cuando se intenta ejecutar la migración, entonces no se aplica ningún cambio en la base.

**Reglas de negocio y datos:** enum `pending | approved | rejected | delivered | completed | reversed`; `resolved_by` = profesor que resuelve; `resolved_at` = timestamp; la reversión devuelve monedas y stock en la misma transacción.

**Conversación (por aclarar con el Product Owner):** ¿el canje instantáneo actual pasa a ser "aprobar automáticamente" o se elimina cuando exista el flujo revisable?

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T7.1.1 — Redactar la especificación SQL del cambio
- Etiquetas: tarea, base-de-datos
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** dejar por escrito el cambio de esquema exacto para que se pueda revisar y aprobar.

**Qué hacer**
1. Escribir el `ALTER TYPE`/`ALTER TABLE` que amplía `redemption_status` con `pending | approved | rejected | delivered` y agrega `resolved_by` y `resolved_at`.
2. Escribir la función/trigger de reversión que devuelve monedas y stock en la misma transacción al rechazar.
3. Documentar las transiciones válidas en una tabla estado→estado.

**Hecho cuando**
- [ ] El SQL está completo y revisado por pares (cubre criterio 1).
- [ ] La tabla de transiciones coincide con el diagrama (cubre criterio 1).

**Dependencias:** ninguna.

**Notas:** no ejecutar en ninguna base; el SQL vive solo en la propuesta. Fuente de verdad: `db/001_schema.sql`.

##### T7.1.2 — Diagrama y registro de la propuesta para aprobación
- Etiquetas: tarea, backend
- Bloqueada por: T7.1.1

**Descripción de la tarea**

**Objetivo:** que la propuesta quede visible en la historia y tenga un veredicto explícito del equipo/PO.

**Qué hacer**
1. Dibujar el diagrama de estados del canje: `pending`, `approved`, `rejected`, `delivered` más los heredados `completed`/`reversed`.
2. Publicar la propuesta en el issue de la historia con el checklist de impacto (9 tablas, `fn_award_coins`, UIs afectadas).
3. Pedir la aprobación y registrar la respuesta en el issue.

**Hecho cuando**
- [ ] El diagrama está publicado en la historia (cubre criterio 1).
- [ ] Existe respuesta explícita de aprobación registrada (cubre criterio 3).

**Dependencias:** el SQL de T7.1.1.

**Notas:** si el PO rechaza, se abre una nueva iteración de la propuesta antes de arrancar H7.2.

##### T7.1.3 — Verificar impacto sobre el flujo MVP
- Etiquetas: tarea, testing
- Bloqueada por: T7.1.1

**Descripción de la tarea**

**Objetivo:** asegurar que la propuesta no rompe el comportamiento existente del canje.

**Qué hacer**
1. Listar los lugares del código y la BD que hoy escriben `completed`/`reversed` (canje instantáneo y su reversión).
2. Comprobar en la propuesta cómo queda cubierto cada uno de esos lugares tras el cambio de enum.
3. Registrar los hallazgos en la historia.

**Hecho cuando**
- [ ] Todo punto de escritura del enum tiene tratamiento definido en la propuesta (cubre criterio 2).
- [ ] Los hallazgos están escritos en la historia (cubre criterio 2).

**Dependencias:** el SQL de T7.1.1.

**Notas:** usar `db/001_schema.sql` como fuente, no el diseño original pre-MVP.

### H7.2 — Canje revisable en la API (pendiente → aprobado/rechazado → entregado)
- Etiquetas: historia, flujo-de-trabajo, reglas-de-negocio
- Prioridad: 1
- Estimación: 8
- Carga: 0·5·3
- Sprint: S2
- Rol sugerido: Backend (jhon) con apoyo de QA en las pruebas
- Bloqueada por: H7.1

#### Descripción de la historia
**Como** profesor de una clase, **quiero** que un canje solicitado por un estudiante quede pendiente de mi aprobación y que rechazarlo devuelva monedas y stock, **para que** controle la economía de la clase sin perder la consistencia de los saldos.

**Contexto:** el MVP canjea instantáneamente y §5 de este documento pide un flujo revisable. Esta historia implementa el lado servidor completo: estados, solicitud con reserva, endpoints de resolución, reversión al rechazar y cola de pendientes.

**Alcance**
- Incluye: migración aprobada del enum; solicitud de canje que crea `pending` con reserva de monedas y stock; endpoints de aprobación y rechazo; reversión transaccional; cierre a `delivered`; cola paginada por profesor; autorización por clase; pruebas del backend.
- No incluye: UIs (van en H7.3 y H7.4), notificaciones, motivo de rechazo, cambios en otros flujos del MVP.

**Criterios de aceptación**
- [ ] **Escenario 1 — Solicitud con reserva:** Dado un estudiante con saldo ≥ costo y un ítem con stock, cuando solicita el canje, entonces la fila queda en `pending` con el costo congelado y su saldo y el stock quedan descontados.
- [ ] **Escenario 2 — Rechazo con reversión total:** Dado un canje `pending` con la reserva hecha, cuando el profesor lo rechaza, entonces el estado pasa a `rejected`, `resolved_by` y `resolved_at` quedan llenos, y saldo y stock vuelven exactamente a su valor previo.
- [ ] **Escenario 3 — Aprobación → entregado:** Dado un canje `pending`, cuando el profesor lo aprueba, entonces el estado pasa a `delivered` con `resolved_by` y `resolved_at` llenos y no se genera ningún movimiento de monedas adicional.
- [ ] **Escenario 4 — Sin saldo o sin stock:** Dado un estudiante sin saldo suficiente o un ítem sin stock, cuando solicita el canje, entonces recibe un error y no se crea ninguna fila.
- [ ] **Escenario 5 — Doble resolución o no autorizado:** Dado un canje ya resuelto, cuando se intenta resolver de nuevo, entonces responde 409; dado un profesor que no imparte la clase del estudiante, cuando intenta resolverlo, entonces responde 403 y el canje no cambia.

**Reglas de negocio y datos:** solo se puede resolver desde `pending`; el costo se congela al crear la solicitud; `resolved_by` = id del profesor autenticado; mensajes exactos de error: `Saldo insuficiente`, `Sin stock disponible`, `No tienes permiso para resolver este canje`, `El canje ya fue resuelto`; ninguna respuesta expone campos internos de auditoría.

**Conversación (por aclarar con el Product Owner):** ¿la reserva al solicitar (elegida aquí por el texto "reversión al rechazar") o el descuento solo al aprobar? ¿Se mantiene el canje instantáneo como atajo "aprobar automáticamente"?

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T7.2.1 — Migrar el enum de estados y las columnas de resolución
- Etiquetas: tarea, base-de-datos
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** aplicar en el entorno de desarrollo el esquema aprobado en H7.1, base de todos los endpoints siguientes.

**Qué hacer**
1. Escribir la migración que amplía `redemption_status` con `pending | approved | rejected | delivered` y agrega `resolved_by` y `resolved_at`.
2. Aplicarla en el entorno de desarrollo y verificar que no hay errores.
3. Comprobar que las filas existentes quedan con un estado heredado coherente (`completed` o `reversed`).

**Hecho cuando**
- [ ] La migración aplica sin errores y las filas existentes conservan su estado (prepara criterios 1–3).

**Dependencias:** SQL y aprobación de T7.1.1/T7.1.2.

**Notas:** no aplicar en producción; registrar la migración en el flujo de migraciones del repo.

##### T7.2.2 — Modificar la solicitud de canje para crear `pending` con reserva
- Etiquetas: tarea, backend
- Bloqueada por: T7.2.1

**Descripción de la tarea**

**Objetivo:** que pedir un canje pase a crear una solicitud pendiente con la reserva de monedas y stock, en lugar de completar el canje al instante.

**Qué hacer**
1. Modificar la ruta de solicitud de canje existente del MVP para que, en lugar de cerrar el canje, cree la fila en `pending` con el costo congelado.
2. Dentro de una sola transacción: validar saldo ≥ costo y stock > 0 → descontar monedas → descontar stock → crear la fila `pending`.
3. Si cualquier validación falla, responder `400` con `Saldo insuficiente` o `Sin stock disponible` y no crear ninguna fila (rollback total).
4. Devolver el id del canje y su estado `pending`, sin exponer campos internos.

**Hecho cuando**
- [ ] Una solicitud válida queda `pending` con saldo y stock descontados (cubre criterio 1).
- [ ] Saldo o stock insuficiente responde 400 sin crear fila (cubre criterio 4).

**Dependencias:** migración de T7.2.1.

**Notas:** reutilizar la validación de costo del canje instantáneo del MVP; toda la operación en una transacción para no dejar reservas a medias.

##### T7.2.3 — Crear los endpoints de aprobación y rechazo
- Etiquetas: tarea, backend
- Bloqueada por: T7.2.2

**Descripción de la tarea**

**Objetivo:** exponer las dos acciones del profesor (aprobar, rechazar) con autorización y transiciones controladas.

**Qué hacer**
1. Crear las rutas de aprobación y de rechazo que reciben el id del canje y operan sobre el canje autenticado.
2. Validar que la transición sea solo desde `pending`; si el canje ya fue resuelto, responder `409` con `El canje ya fue resuelto`.
3. Validar que el profesor autenticado imparta la clase del estudiante que solicitó; si no, responder `403` con `No tienes permiso para resolver este canje`.
4. Al aprobar: pasar a `delivered` llenando `resolved_by` y `resolved_at`, sin mover monedas ni stock.
5. Al rechazar: invocar la reversión (T7.2.4) y pasar a `rejected` con `resolved_by` y `resolved_at`.

**Hecho cuando**
- [ ] La aprobación marca `delivered` con auditoría llena y sin movimientos nuevos (cubre criterio 3).
- [ ] No autorizado responde 403 y doble resolución responde 409 (cubre criterio 5).

**Dependencias:** T7.2.2 (fila `pending` que resolver).

**Notas:** el rechazo debe abortar la transacción completa si la reversión falla (nunca dejar `rejected` sin reversión).

##### T7.2.4 — Crear la función de reversión total al rechazar
- Etiquetas: tarea, base-de-datos
- Bloqueada por: T7.2.3

**Descripción de la tarea**

**Objetivo:** garantizar que rechazar devuelve exactamente las monedas y el stock reservados, sin duplicados ni pérdidas.

**Qué hacer**
1. Crear la función de reversión que, en la misma transacción del rechazo, suma de vuelta las monedas al estudiante y restaura el stock del ítem a partir del costo congelado de la fila.
2. Enganchar la función al rechazo implementado en T7.2.3.
3. Verificar que un reintento o una transacción abortada a mitad no genera movimientos duplicados.

**Hecho cuando**
- [ ] Tras el rechazo, saldo y stock vuelven exactamente al valor previo (cubre criterio 2).
- [ ] No se generan movimientos duplicados en un reintento (cubre criterio 2).

**Dependencias:** T7.2.3 (punto donde se invoca).

**Notas:** riesgo principal de la épica; probar con rollback forzado a mitad de transacción.

##### T7.2.5 — Crear la cola de canjes pendientes paginada
- Etiquetas: tarea, backend
- Bloqueada por: T7.2.3

**Descripción de la tarea**

**Objetivo:** dar al profesor el listado de canjes que esperan su decisión, limitado a sus clases.

**Qué hacer**
1. Crear la ruta de consulta de canjes en `pending` de las clases del profesor autenticado, paginada.
2. Devolver por fila: estudiante, ítem, costo, fecha de solicitud e id del canje.
3. Si el profesor no imparte la clase, responder `403`.

**Hecho cuando**
- [ ] La cola devuelve solo pendientes de las clases del profesor y pagina sin duplicados (cubre criterio 5).

**Dependencias:** T7.2.3 (estados que la alimentan).

**Notas:** el mismo contrato consume T7.4 (UI del profesor); publicarlo en la historia antes de construir la UI.

##### T7.2.6 — Pruebas del backend del canje revisable
- Etiquetas: tarea, testing
- Bloqueada por: T7.2.4, T7.2.5

**Descripción de la tarea**

**Objetivo:** verificar de una sola pasada todos los criterios de aceptación de la historia antes de integrar las UIs.

**Qué hacer**
1. Ejecutar el camino feliz: solicitud → `pending` con reserva → aprobación → `delivered`.
2. Ejecutar el rechazo y comparar saldo y stock previos y posteriores (valores exactos en BD).
3. Verificar doble resolución → 409, no autorizado → 403, sin saldo → 400.
4. Revisar que ninguna respuesta trae secretos ni campos internos de auditoría.

**Hecho cuando**
- [ ] Las 5 comprobaciones automatizadas pasan (cubre criterios 1–5).
- [ ] Ninguna respuesta expone datos internos (cubre criterios 1 y 5).

**Dependencias:** T7.2.4 y T7.2.5 (todo el comportamiento bajo prueba).

**Notas:** usar datos de prueba propios y limpiarlos al terminar.

### H7.3 — Billetera del estudiante con estados del canje
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 2
- Estimación: 3
- Carga: 3·0·0
- Sprint: S1
- Rol sugerido: Frontend (tú)
- Bloqueada por: —

#### Descripción de la historia
**Como** estudiante, **quiero** ver en mi billetera el estado de cada canje que solicité, **para que** sepa si sigue pendiente de aprobación, fue entregado o fue rechazado, y con qué saldo quedé.

**Contexto:** hoy la billetera solo refleja movimientos instantáneos. Con el flujo revisable el estudiante necesita distinguir su canje pendiente del resultado final para no pensar que el canje desapareció.

**Alcance**
- Incluye: fila de estado del canje en la vista de billetera, mensajes para los estados `pending`, `delivered` y `rejected`, estado vacío, datos de prueba por contrato y sustitución por la API real cuando exista.
- No incluye: solicitar canjes nuevos (ya existe en el MVP), notificaciones, historial de auditoría completo.

**Criterios de aceptación**
- [ ] **Escenario 1 — Canje pendiente visible:** Dado un canje `pending`, cuando el estudiante abre su billetera, entonces ve el canje con el texto `Pendiente de aprobación` y sin movimientos de saldo no esperados.
- [ ] **Escenario 2 — Rechazo visible:** Dado un canje `rejected`, cuando el estudiante abre su billetera, entonces ve el texto `Rechazado` y su saldo refleja la reversión.
- [ ] **Escenario 3 — Entrega confirmada:** Dado un canje `delivered`, cuando el estudiante abre su billetera, entonces ve el texto `Entregado` con la fecha de resolución.
- [ ] **Escenario 4 — Sin canjes:** Dado un estudiante sin canjes, cuando abre la sección, entonces ve el mensaje `Aún no has solicitado canjes`.
- [ ] **Escenario 5 — Integración:** Dado el contrato de la API de H7.2, cuando la vista consume datos reales, entonces los estados mostrados coinciden con los del backend sin cambios visuales.

**Reglas de negocio y datos:** textos exactos `Pendiente de aprobación`, `Rechazado`, `Entregado`, `Aún no has solicitado canjes`; la fecha de resolución se muestra en formato local; no se exponen `resolved_by` ni otros campos internos.

**Conversación (por aclarar con el Product Owner):** ¿mostrar el nombre del profesor que resolvió el canje?

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T7.3.1 — Crear la fila de estado de canje en la billetera
- Etiquetas: tarea, frontend
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** tener un componente visual que represente cualquier canje y su estado, como base del resto de la historia.

**Qué hacer**
1. Crear la fila de canje que recibe: estado, ítem, costo, fecha de solicitud y (si existe) fecha de resolución.
2. Renderizar los estados `pending`, `delivered` y `rejected` con su indicación visual.
3. Integrar la fila en la vista existente de billetera.

**Hecho cuando**
- [ ] Los tres estados se renderizan con su indicación visual (cubre criterios 1–3).

**Dependencias:** ninguna.

**Notas:** seguir el estilo visual de las filas de movimientos ya existentes en la billetera.

##### T7.3.2 — Añadir textos, estado vacío y datos de prueba por contrato
- Etiquetas: tarea, frontend
- Bloqueada por: T7.3.1

**Descripción de la tarea**

**Objetivo:** cerrar toda la capa visible (textos exactos, vacío, fechas) con datos simulados del contrato, sin esperar al backend.

**Qué hacer**
1. Aplicar los textos exactos `Pendiente de aprobación`, `Rechazado` y `Entregado`.
2. Crear el estado vacío con el mensaje `Aún no has solicitado canjes`.
3. Montar datos de prueba locales que cubran los cuatro estados según el contrato de la API de H7.2.
4. Formatear la fecha de resolución en formato local.

**Hecho cuando**
- [ ] El estado vacío y los textos coinciden exactamente (cubre criterio 4).
- [ ] Los datos de prueba cubren los estados de los criterios 1–3.

**Dependencias:** T7.3.1.

**Notas:** el mock se reemplaza en T7.3.3; no inventar estados fuera del contrato.

##### T7.3.3 — Integrar la billetera con la API real
- Etiquetas: tarea, frontend
- Bloqueada por: T7.3.2

**Descripción de la tarea**

**Objetivo:** sustituir los datos simulados por la API real y confirmar paridad con el backend.

**Qué hacer**
1. Reemplazar el mock por la llamada real a la consulta de canjes del estudiante.
2. Manejar los estados de carga y error de red de la vista.
3. Comparar los estados mostrados contra los del backend en los cuatro casos.

**Hecho cuando**
- [ ] La vista con datos reales coincide con el backend (cubre criterio 5).
- [ ] Carga y error quedan cubiertos sin romper el resto de la vista.

**Dependencias:** contrato y endpoints de H7.2.

**Notas:** H7.2 está en S2; si la API aún no existe al llegar a esta tarea, se deja el mock activo y la integración se cierra en cuanto H7.2 publique sus endpoints (mismo patrón que el plan MVP: integración real pospuesta a la historia bloqueadora).

##### T7.3.4 — Pruebas E2E de la billetera del estudiante
- Etiquetas: tarea, testing
- Bloqueada por: T7.3.3

**Descripción de la tarea**

**Objetivo:** verificar que cada estado del canje se ve correctamente para el estudiante, con y sin datos reales.

**Qué hacer**
1. Ejecutar los escenarios: canje pendiente visible, rechazado con saldo revertido, entregado con fecha.
2. Ejecutar el estado vacío con un estudiante sin canjes.
3. Revisar que no aparecen campos internos de auditoría en la vista.

**Hecho cuando**
- [ ] Los cuatro escenarios pasan (cubre criterios 1–4).
- [ ] No hay datos internos en la vista (cubre criterio 1).

**Dependencias:** T7.3.3 (vista con datos reales).

**Notas:** usar datos de prueba propios y limpiarlos al terminar.

### H7.4 — Cola de aprobación de canjes del profesor
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 2
- Estimación: 3
- Carga: 3·0·0
- Sprint: S1
- Rol sugerido: Frontend (tú)
- Bloqueada por: —

#### Descripción de la historia
**Como** profesor, **quiero** una cola de canjes pendientes con acciones de aprobar y rechazar, **para que** resuelva los canjes de mis clases en segundos desde un solo lugar.

**Contexto:** el PDF pide un módulo de revisión para el profesor; el flujo revisable necesita su punto de entrada, ya que hoy no existe ninguna vista de canjes en espera.

**Alcance**
- Incluye: listado paginado de pendientes con estudiante, ítem, costo y fecha; acciones de aprobar y rechazar con confirmación obligatoria; mensajes de éxito y error; integración con la API real.
- No incluye: filtros avanzados, aprobación masiva, motivo de rechazo, notificaciones, revisión de otras entidades.

**Criterios de aceptación**
- [ ] **Escenario 1 — Cola de pendientes:** Dado un profesor con canjes pendientes en sus clases, cuando abre la cola, entonces ve cada canje con estudiante, ítem, costo y fecha de solicitud.
- [ ] **Escenario 2 — Aprobar:** Dado un canje en la cola, cuando el profesor pulsa Aprobar y confirma, entonces el canje sale de la cola y ve la confirmación `Canje aprobado`.
- [ ] **Escenario 3 — Rechazar:** Dado un canje en la cola, cuando el profesor pulsa Rechazar y confirma, entonces el canje sale de la cola y ve `Canje rechazado: se devolvieron monedas y stock`.
- [ ] **Escenario 4 — Cola vacía:** Dado un profesor sin pendientes, cuando abre la cola, entonces ve `No hay canjes pendientes`.
- [ ] **Escenario 5 — Sin permiso:** Dado un profesor sin canjes de sus clases, cuando intenta resolver un canje ajeno, entonces ve un mensaje de error y el canje no cambia.

**Reglas de negocio y datos:** confirmación obligatoria antes de resolver; textos exactos `Canje aprobado`, `Canje rechazado: se devolvieron monedas y stock`, `No hay canjes pendientes`; tras cada resolución la cola se actualiza sin recargar la página.

**Conversación (por aclarar con el Product Owner):** ¿motivo opcional al rechazar? (fuera de alcance por ahora).

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T7.4.1 — Crear la vista de cola de canjes pendientes
- Etiquetas: tarea, frontend
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** tener la pantalla con el listado de pendientes, como base de las acciones.

**Qué hacer**
1. Crear la vista de cola con listado paginado de canjes.
2. Pintar por fila: estudiante, ítem, costo y fecha de solicitud.
3. Implementar los estados de carga y vacío de la cola.

**Hecho cuando**
- [ ] La cola renderiza los pendientes (cubre criterio 1).
- [ ] El estado vacío se muestra (cubre criterio 4).

**Dependencias:** ninguna.

**Notas:** seguir el patrón de listas paginadas ya existentes en el panel del profesor del MVP.

##### T7.4.2 — Acciones de aprobar y rechazar con confirmación
- Etiquetas: tarea, frontend
- Bloqueada por: T7.4.1

**Descripción de la tarea**

**Objetivo:** que el profesor pueda resolver cada canje desde la fila, con confirmación y feedback claro.

**Qué hacer**
1. Añadir los botones Aprobar y Rechazar en cada fila.
2. Mostrar diálogo de confirmación obligatorio antes de resolver.
3. Mostrar `Canje aprobado` o `Canje rechazado: se devolvieron monedas y stock` según el resultado.
4. Mostrar el mensaje de error cuando la API responda 403 o 409.

**Hecho cuando**
- [ ] Aprobar y rechazar piden confirmación y muestran sus mensajes exactos (cubre criterios 2 y 3).
- [ ] El error de permiso se muestra sin cambiar el canje (cubre criterio 5).

**Dependencias:** T7.4.1.

**Notas:** la cola se actualiza optimistamente solo tras confirmación de la API.

##### T7.4.3 — Integrar la cola con la API real
- Etiquetas: tarea, frontend
- Bloqueada por: T7.4.2

**Descripción de la tarea**

**Objetivo:** conectar la cola con los endpoints de H7.2 y eliminar los datos simulados.

**Qué hacer**
1. Conectar la consulta de pendientes y las rutas de aprobación y rechazo.
2. Refrescar la cola tras cada resolución, retirando la fila resuelta.
3. Verificar que los mensajes de la UI coinciden con las respuestas del backend.

**Hecho cuando**
- [ ] Las acciones afectan el backend real (cubre criterios 2 y 3).
- [ ] La cola queda actualizada tras resolver (cubre criterios 2 y 3).

**Dependencias:** endpoints de H7.2.

**Notas:** H7.2 está en S2; si la API aún no existe, se mantiene el mock local y la integración se cierra en cuanto H7.2 publique sus endpoints (mismo patrón que T7.3.3).

##### T7.4.4 — Pruebas E2E de la cola del profesor
- Etiquetas: tarea, testing
- Bloqueada por: T7.4.3

**Descripción de la tarea**

**Objetivo:** verificar que el profesor resuelve canjes de punta a punta desde su cola.

**Qué hacer**
1. Ejecutar: aprobar desde la cola y comprobar que sale de la cola.
2. Ejecutar: rechazar desde la cola y comprobar el mensaje exacto.
3. Ejecutar: cola vacía con un profesor sin pendientes.
4. Ejecutar: intento de resolver un canje ajeno y comprobar el error.

**Hecho cuando**
- [ ] Los cuatro escenarios pasan (cubre criterios 1–5).

**Dependencias:** T7.4.3 (cola con datos reales).

**Notas:** usar datos de prueba propios y limpiarlos al terminar.

### H7.5 — Suite E2E del flujo canje revisable
- Etiquetas: historia, testing
- Prioridad: 1
- Estimación: 3
- Carga: 0·0·3
- Sprint: S3
- Rol sugerido: TBD/QA (julian)
- Bloqueada por: H7.2, H7.3, H7.4

#### Descripción de la historia
**Como** equipo de QA, **quiero** una suite E2E que cubra el flujo completo de canje revisable, **para que** liberemos la épica con evidencia de que saldos y stock quedan consistentes en cada camino.

**Contexto:** cada historia anterior prueba su pieza; esta verifica el recorrido completo de extremo a extremo y fija la regresión mínima del flujo.

**Alcance**
- Incluye: escenario aprobado de punta a punta, escenario rechazado con verificación exacta de reversión, casos negativos, registro de la suite como regresión del equipo.
- No incluye: rendimiento, pruebas multi-navegador, notificaciones (no existen), pruebas de UI de detalle (ya cubiertas en H7.3/H7.4).

**Criterios de aceptación**
- [ ] **Escenario 1 — Ruta feliz:** Dado un estudiante con saldo y un profesor de su clase, cuando solicita el canje y el profesor lo aprueba, entonces el flujo termina en `delivered` y la suite verifica saldo y stock consistentes en BD.
- [ ] **Escenario 2 — Rechazo con reversión exacta:** Dado un canje `pending`, cuando el profesor lo rechaza, entonces la suite compara saldo y stock previos y finales en BD y son idénticos.
- [ ] **Escenario 3 — Negativos:** Dados los casos no autorizado (403), doble resolución (409) y sin saldo (400), cuando se ejecutan, entonces cada caso responde su código esperado y la BD no cambia.
- [ ] **Escenario 4 — Regresión:** Dada la suite registrada, cuando corre con cada cambio, entonces pasa completa o detiene el avance, y ninguna respuesta contiene secretos ni campos internos.

**Reglas de negocio y datos:** la suite usa datos de prueba propios y los limpia al terminar; compara valores exactos de saldo y stock en BD, no solo códigos HTTP.

**Conversación (por aclarar con el Product Owner):** ¿en qué punto del flujo de pruebas habitual del repo queda registrada la suite? El documento no fija herramientas.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T7.5.1 — Escenario E2E: pendiente → aprobado → entregado
- Etiquetas: tarea, testing
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** cubrir el camino feliz completo del flujo con verificación en base de datos.

**Qué hacer**
1. Crear datos de prueba: estudiante con saldo, ítem con stock y su profesor.
2. Solicitar el canje y verificar en BD: estado `pending`, saldo y stock descontados.
3. Aprobar desde la perspectiva del profesor y verificar: estado `delivered`, `resolved_by` y `resolved_at` llenos, sin movimientos nuevos de monedas.
4. Limpiar los datos creados.

**Hecho cuando**
- [ ] El escenario completo pasa y la BD queda limpia (cubre criterio 1).

**Dependencias:** ninguna (corre sobre H7.2 ya integrada).

**Notas:** ejecutar solo en entorno de pruebas; nunca sobre datos reales.

##### T7.5.2 — Escenario E2E: rechazo con reversión exacta
- Etiquetas: tarea, testing
- Bloqueada por: T7.5.1

**Descripción de la tarea**

**Objetivo:** probar el riesgo principal de la épica: que rechazar devuelva exactamente lo reservado.

**Qué hacer**
1. Capturar en BD los valores previos de saldo y stock antes del canje.
2. Solicitar el canje y rechazarlo desde la cola del profesor.
3. Comparar saldo y stock finales contra los previos (valores exactos).
4. Verificar estado `rejected` con `resolved_by` y `resolved_at` llenos.

**Hecho cuando**
- [ ] La reversión es exacta y verificada en BD (cubre criterio 2).

**Dependencias:** flujo de aprobación de T7.5.1 (mismos datos y utilidades).

**Notas:** falla dura si hay cualquier diferencia de redondeo o de stock.

##### T7.5.3 — Casos negativos y registro como regresión
- Etiquetas: tarea, qa
- Bloqueada por: T7.5.1

**Descripción de la tarea**

**Objetivo:** cubrir los caminos de error y dejar la suite como regresión obligatoria del equipo.

**Qué hacer**
1. Ejecutar: resolver un canje ajeno → 403 sin cambios en BD.
2. Ejecutar: resolver dos veces el mismo canje → 409 sin cambios en BD.
3. Ejecutar: solicitar sin saldo → 400 sin fila creada.
4. Registrar la suite en el flujo de pruebas habitual del equipo.
5. Revisar que ninguna respuesta incluye secretos ni campos internos.

**Hecho cuando**
- [ ] Los tres negativos pasan sin cambios en BD (cubre criterio 3).
- [ ] La suite queda registrada como regresión (cubre criterio 4).

**Dependencias:** T7.5.1 (utilidades de datos y ejecución base).

**Notas:** si el equipo no tiene flujo de pruebas definido, dejarlo anotado en la historia para decisión del PO.

---

## Parte III — Plan: Épica E8 · Minijuegos como pregunta de actividad

> Épica **aprobada y pendiente de publicación** en Linear (team Integrator / workspace projectsU). Esta sección es la referencia del plan; el estado diario estará en los issues de Linear. Piloto: `ordenar_frase` + `memoria`. **Sin pistas desbloqueables** (decisión del PO, 2026-10-15).

### Resumen
- Objetivo: que el profesor pueda añadir preguntas de tipo minijuego (`ordenar_frase`, `memoria`) a sus actividades y el estudiante las responda jugando, con auto-calificación en backend que jamás expone la solución.
- Equipo: 3 personas — Front (tú), Backend (jhon), TBD/QA (julian).
- Enfoque de división: flujo de trabajo + spike de esquema — porque el valor está en la cadena esquema → API → juegos → E2E, y las UIs se construyen en paralelo.
- Sprint: 1 semana, arranque **16 nov** (E7 cierra 15 nov; continúa la numeración de sprints del MVP).
- Capacidad por carril: 6 pts front · 8 pts back · 6 pts QA por sprint.
- Hitos: ninguno.
- Suposiciones:
  - El esquema se aprueba dentro de H8.1 (regla de este documento: proponer y esperar aprobación antes de implementar).
  - El piloto cubre solo `ordenar_frase` y `memoria`; el enum y el modelo de datos quedan preparados para los 5 tipos restantes (`crucigrama`, `sopa_letras`, `emparejar`, `arrastrar_soltar`, `adivina_palabra`).
  - El minijuego es **una pregunta de `questions[]`** con auto-calificación al estilo `test`/`completion`; monedas y calificación usan la ruta existente de H3.4/H3.6 sin cambios de flujo.
  - El backend aún no tiene los módulos de actividades/entregas (H3.3/H3.4/H3.6, sprint S3 del MVP); H8.3 se integra con el **pipeline de grading que entreguen esas historias**.
  - Las fechas de fin de año (S3: 23–29 dic y S4: 30 dic–5 ene) son un riesgo: si el equipo toma vacaciones, las sprints se corren a enero sin reordenar historias ni dependencias.
  - El link pregunta-minijuego se resuelve por `(activity_id, question_position)` apuntando al `position` del ítem `minigame` dentro de `questions` JSONB (el spike H8.1 puede proponer otro mecanismo si lo justifica).
  - IDs continúan la secuencia del plan: E8, H8.x, T8.x.x.

### Sprints
| Sprint | Fechas | Meta del sprint | Historias | Carga (Front·Back·QA) |
|---|---|---|---|---|
| S9 | 16–22 nov | El esquema de minijuegos está aprobado y el profesor crea preguntas minijuego en su editor | H8.1, H8.2 | 5·2·0 |
| S10 | 23–29 nov | La API sirve el tablero jugable sin solución y auto-califica la respuesta del estudiante | H8.3 | 0·5·1 |
| S11 | 30 nov–6 dic | El estudiante juega `ordenar_frase` y `memoria` dentro de una actividad publicada | H8.4 | 5·0·0 |
| S12 | 7–13 dic | El flujo completo actividad-con-minijuego pasa en la suite E2E; el profesor ya puede insertar ecuaciones KaTeX en enunciados | H8.5, H9.1 | 3·0·5 |
| S13 | 14–20 dic | Los paneles admin, profesor y estudiante pasan la auditoría responsive | H9.2 | 5·0·2 |

### E8 — Minijuegos como pregunta de actividad (piloto ordenar_frase + memoria)
- Resumen: preguntas de tipo minijuego dentro de las actividades existentes: el profesor las crea con su configuración y solución, el estudiante las juega y el backend las auto-califica sin exponer la solución.
- Sprints que la abarcan: S9, S10, S11, S12

#### Descripción de la épica
**Objetivo de negocio:** gamificar la práctica dentro de las actividades para que el estudiante demuestre conocimiento activo (reconstruir un proceso, emparejar pares) en lugar de solo reconocer opciones, cumpliendo el requisito de la ficha técnica (`docs/EduCoin.md` §2.2 y §2.3) sin tocar el flujo de calificación ni de monedas existente.

**Alcance**
- Incluye: spike y aprobación del esquema (tablas `minigames` y `minigame_responses`), editor del profesor para crear preguntas `ordenar_frase` y `memoria`, proyección jugable en la API del estudiante (tablero sin solución), auto-calificación en el envío de la entrega, juegos del estudiante (componente despachador + un componente por tipo), suite E2E de regresión.
- No incluye: los 5 tipos restantes del enum, pistas desbloqueables (decisión del PO 2026-10-15), minijuego como actividad autónoma (es una pregunta de `questions[]`), notificaciones, cambios a la ruta de monedas, drag táctil más allá del fallback de selección.

**Usuarios involucrados:** profesor (crea y edita preguntas minijuego en sus actividades), estudiante (juega y gana los puntos de la pregunta).

**Historias que la componen**
- H8.1 — Propuesta y aprobación del esquema de minijuegos
- H8.2 — Editor del profesor: preguntas tipo minijuego
- H8.3 — API: configuración jugable y auto-calificación
- H8.4 — Juegos del estudiante: ordenar_frase y memoria
- H8.5 — Suite E2E del flujo minijuego

**Criterio de éxito:** el profesor publica una actividad con preguntas minijuego; el estudiante las resuelve jugando; la entrega se auto-califica con el puntaje correcto; el payload del estudiante no contiene en ningún punto la solución (auditable); el recorrido completo pasa en la suite E2E.

**Riesgos y suposiciones:** el link `(activity_id, question_position)` entre la fila y el JSONB es el riesgo de integridad principal (un minigame huérfano o apuntando a una pregunta que ya no es `minigame`); el shuffle del tablero debe ocurrir en backend para que el frontend no pueda inferir el orden; el calendario de fin de año puede correr S3/S4 a enero.

**Dependencias con otras épicas:** E5/E6 del MVP — H3.3 (GET de actividad del estudiante), H3.4/H3.6 (envío y grading de entregas, aún en el sprint S3 del MVP), H5.6 (editor de actividades, T5.6.2) y H5.8 (cuestionario, spec 019 — el aviso "se resuelve de otra forma" es el punto de sustitución de T8.4.1). Ninguna dependencia con E7.

### H8.1 — Propuesta y aprobación del esquema de minijuegos
- Etiquetas: historia, habilitadora, spike-técnico
- Prioridad: 1
- Estimación: 2
- Carga: 0·2·0
- Sprint: S1
- Rol sugerido: Backend (jhon)
- Bloqueada por: —

#### Descripción de la historia
**Como** equipo técnico de EduCoins, **quiero** contar con una propuesta de esquema aprobada para las preguntas minijuego, **para que** implementemos configuración, solución y respuestas sin exponer la solución ni romper el JSONB `questions` existente.

**Contexto:** §4 de la Parte I exige proponer el cambio (SQL + especificación + diagrama) y esperar aprobación antes de implementar. El MVP solo tiene el marcador `type: 'minigame'` en `questions` sin tablas de configuración ni solución (§4 de la Parte I; spec 015 tipa el enum en zod sin UI).

**Alcance**
- Incluye: especificación SQL de las tablas `minigames` y `minigame_responses` (nombres en inglés, `snake_case`, plural — convención AGENTS.md), enums, FKs, índices y unicidad `(activity_id, question_position)`; contrato JSON de `config`, `solution` y `response` por tipo (`ordenar_frase`, `memoria`); diagrama de datos; checklist de impacto sobre H3.3/H3.4/H3.6 y `fn_award_coins`.
- No incluye: ejecutar la migración, modificar código de la API ni de la UI.

**Criterios de aceptación**
- [ ] **Escenario 1 — Tablas especificadas:** Dada la propuesta, cuando se revisa, entonces `minigames` guarda `kind`, `config`, `solution` y la unicidad `(activity_id, question_position)`, y `minigame_responses` guarda la respuesta del estudiante con `is_correct` y `score_earned`.
- [ ] **Escenario 2 — Solución confinada:** Dada la propuesta, cuando se revisa la proyección del estudiante, entonces queda especificado que `solution` jamás se incluye en ningún GET de estudiante.
- [ ] **Escenario 3 — Extensible sin migración gorda:** Dado el enum de `kind`, cuando se añade un tipo futuro, entonces solo requiere valor nuevo en el enum y su contrato de config (sin tocar tablas existentes).
- [ ] **Escenario 4 — Sin implementación prematura:** Dada la propuesta no aprobada, cuando se intenta ejecutar la migración, entonces no se aplica ningún cambio en la base.

**Reglas de negocio y datos:** enum `kind` inicial `ordenar_frase | memoria`; `config` y `solution` en JSONB validado por contrato zod en la app (la BD solo exige `jsonb`); la respuesta del estudiante se guarda en `minigame_responses` con referencia a la entrega (`submission_id`) y al `minigame_id`; el shuffle del tablero es responsabilidad del backend al servir.

**Conversación (por aclarar con el Product Owner):** ¿el tablero servido se re-baraja en cada GET (más justo) o una vez por actividad publicada (más simple y testeable)?

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T8.1.1 — Redactar la especificación SQL del esquema
- Etiquetas: tarea, base-de-datos
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** dejar por escrito el DDL exacto de las dos tablas para que se pueda revisar y aprobar.

**Qué hacer**
1. Escribir el `CREATE TABLE minigames` (`id`, `activity_id` FK a `activities`, `question_position` smallint, `kind` enum, `config` jsonb, `solution` jsonb, `created_at`/`updated_at`) con `UNIQUE (activity_id, question_position)`.
2. Escribir el `CREATE TABLE minigame_responses` (`id`, `submission_id` FK a `submissions`, `minigame_id` FK a `minigames`, `response` jsonb, `is_correct` boolean, `score_earned` integer, `created_at`) con `UNIQUE (submission_id, minigame_id)`.
3. Definir el `CREATE TYPE minigame_kind AS ENUM ('ordenar_frase', 'memoria')`.
4. Escribir los índices de lectura frecuente: `minigames(activity_id)` y `minigame_responses(submission_id)`.

**Hecho cuando**
- [ ] El DDL es completo y ejecutable en un entorno de prueba (cubre criterio 1).
- [ ] La unicidad y las FKs quedan declaradas (cubre criterio 1).

**Dependencias:** ninguna.

**Notas:** nombres en inglés por convención de AGENTS.md §Esquema; no usar `minijuegos`/`respuestas_minijuego` en español (el backlog §4 los nombró así como concepto).

##### T8.1.2 — Especificar el contrato JSON por tipo
- Etiquetas: tarea, backend
- Bloqueada por: T8.1.1

**Descripción de la tarea**

**Objetivo:** fijar la forma de `config`, `solution` y `response` para que backend, editor y juegos se desarrollen contra el mismo contrato.

**Qué hacer**
1. `ordenar_frase`: `solution = { ordered: string[] }`; `config = { pieces?: never }` (las piezas derivan de `ordered`); `response = { ordered: string[] }`; el GET de estudiante devuelve `{ kind, pieces: string[] }` con `pieces` **re-barajadas por backend** (sin índice original).
2. `memoria`: `solution = { pairs: Array<{ left: string; right: string }> }`; `response = { pairs: Array<{ leftCardId: string; rightCardId: string }> }`; el GET devuelve `{ kind, cards: Array<{ id: string; text: string }> }` con textos barajados y **sin identificador de par**.
3. Definir cómo se acopla a `questions`: el ítem JSONB `type: 'minigame'` mantiene `prompt` y `score`; la fila `minigames` se asocia por `(activity_id, question_position)` y aporta `kind`/`config`/`solution`.
4. Escribir la nota de validación: la app valida el interior del JSONB con zod (la BD solo exige `jsonb`), regla ya establecida en spec 015.

**Hecho cuando**
- [ ] Los tres contratos (config/solution/response) están escritos para los 2 tipos (cubre criterio 2 y 3).
- [ ] Queda explícito que `pieces` y `cards` se sirven barajados y sin marcas de corrección (cubre criterio 2).

**Dependencias:** T8.1.1 (nombres de tablas y columnas).

**Notas:** este contrato es el que importarán sin modificar el editor (T8.2.1) y la API (T8.3.2).

##### T8.1.3 — Revisión de impacto y aprobación
- Etiquetas: tarea, qa
- Bloqueada por: T8.1.2

**Descripción de la tarea**

**Objetivo:** que el equipo apruebe el esquema con impactos sobre los flujos existentes a la vista, antes de escribir una línea de implementación.

**Qué hacer**
1. Listar el impacto sobre H3.3 (GET de actividad: proyección jugable), H3.4/H3.6 (envío y grading: dónde se compara `response` contra `solution`) y `fn_award_coins` (sin cambios esperados).
2. Verificar que ningún flujo actual depende de columnas que se eliminan (no debe haber ninguna).
3. Presentar DDL + contratos + impactos al equipo y registrar la aprobación (o los cambios pedidos) en el issue de H8.1 de Linear.
4. Solo tras aprobar, marcar H8.1 como lista y desbloquear H8.3.

**Hecho cuando**
- [ ] El checklist de impacto está completo y la aprobación está registrada (cubre criterio 4 y el criterio 2 de la historia).
- [ ] No se ejecuta ninguna migración (cubre criterio 4).

**Dependencias:** T8.1.2 (contratos finales).

**Notas:** si la aprobación pide cambios de diseño, actualizar T8.1.1/T8.1.2 antes de continuar — es el propósito del spike.

### H8.2 — Editor del profesor: preguntas tipo minijuego
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 1
- Estimación: 5
- Carga: 5·0·0
- Sprint: S1
- Rol sugerido: Front (tú)
- Bloqueada por: —

#### Descripción de la historia
**Como** profesor, **quiero** añadir preguntas de tipo minijuego a mi actividad con su configuración y solución, **para que** mis estudiantes practiquen de forma interactiva dentro del mismo cuestionario.

**Contexto:** el editor de H5.6/T5.6.2 ya acepta `type: 'minigame'` en zod pero sin UI (spec 015: "file y minigame quedan tipados en zod pero sin UI"). Esta historia añade el formulario y los builders de configuración de los 2 tipos del piloto. Se construye **contra el contrato de H8.1** (patrón de E7: las UIs de S1 trabajan sobre el contrato propuesto y se ajustan tras la aprobación si cambia).

**Alcance**
- Incluye: selector de tipo minijuego dentro del editor de preguntas; builder `ordenar_frase` (lista de piezas en orden correcto); builder `memoria` (editor de pares); validación de que no se publique un minijuego sin solución; extensión del esquema zod de `features/teacher/contrato/actividades.ts` con `config`/`solution` por tipo.
- No incluye: los 5 tipos restantes, vista previa jugable del juego, edición de un minijuego ya respondido, cambios en la publicación o en otros tipos de pregunta.

**Criterios de aceptación**
- [ ] **Escenario 1 — Crear minijuego ordenar_frase:** Dado el editor de actividad, cuando añado una pregunta `minigame` de tipo `ordenar_frase` y registro las piezas en su orden correcto, entonces la pregunta se guarda con `config`/`solution` válidos según el contrato.
- [ ] **Escenario 2 — Crear minijuego memoria:** Dado el editor, cuando añado un `minigame` de tipo `memoria` con sus pares, entonces la pregunta se guarda con el `solution.pares` completo.
- [ ] **Escenario 3 — Publicación bloqueada sin solución:** Dado un minijuego sin piezas (o sin pares), cuando intento publicar, entonces la validación me impide publicar con el mensaje exacto `"El minijuego necesita su solución"` y no pierdo lo escrito.
- [ ] **Escenario 4 — Contrato estricto:** Dado el zod del editor, cuando se envía un `kind` fuera del piloto, entonces la validación lo rechaza.
- [ ] **Escenario 5 — Coexistencia con otros tipos:** Dada una actividad con `test`, `completion` y `minigame` mezclados, cuando la guardo, entonces todos los tipos conservan su `position` ordenado.

**Reglas de negocio y datos:** la solución se envía al backend **solo** en la escritura del profesor (nunca vuelve en lectura de estudiante); `score` de la pregunta se maneja igual que en `test`/`completion`; el contrato zod extiende `PreguntaSchema` sin romper los claves exactas de la BD ya fijadas en spec 015.

**Conversación (por aclarar con el Product Owner):** ¿el profesor puede reordenar/eliminar piezas de un minijuego de una actividad ya publicada con entregas? (Supuesto: sí, como puede editar cualquier pregunta; las entregas existentes no se recalculan.)

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T8.2.1 — Extender el contrato zod del editor
- Etiquetas: tarea, frontend
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** que el contrato de `features/teacher/contrato/actividades.ts` modele `config`/`solution` por tipo de minijuego, igual que modela `options` para `test`.

**Qué hacer**
1. Añadir `MinijuegoOrdenarSchema` (`kind`, `solution: { ordered: [string, ...string[]] }` con mínimo 2 piezas) y `MinijuegoMemoriaSchema` (`kind`, `solution: { pairs: [{ left, right }] }` con mínimo 1 par).
2. Discriminar por `kind` dentro de la pregunta `minigame` con `z.discriminatedUnion`.
3. Mantener sin cambios las claves exactas de la BD (`position`, `type`, `prompt`, `score`, `expected_answer`, `options`) — spec 015.
4. Añadir tests unitarios del contrato: válido de cada tipo, inválido sin solución, inválido con `kind` fuera del piloto.

**Hecho cuando**
- [ ] El zod acepta los 2 tipos válidos y rechaza los inválidos de la regla 4 (cubre criterio 3 y 4).
- [ ] Ninguna clave existente del contrato cambia de forma (cubre criterio 5).

**Dependencias:** necesita el contrato final de T8.1.2 (ajustar nombres si la aprobación lo cambió).

**Notas:** importar sin modificar nada de spec 019 (el contrato del estudiante); esta extensión es solo del lado del profesor.

##### T8.2.2 — UI del builder de ordenar_frase
- Etiquetas: tarea, frontend
- Bloqueada por: T8.2.1

**Descripción de la tarea**

**Objetivo:** que el profesor registre las piezas de la frase/proceso en su orden correcto con una interfaz sencilla.

**Qué hacer**
1. Añadir al editor de preguntas un selector de tipo con opción `Minijuego`.
2. Al elegir `ordenar_frase`, mostrar un editor de lista: campo de texto + botón "Añadir pieza", lista numerada con eliminar.
3. Persistir en el borrador como `solution.ordered` (el orden de la lista **es** la solución).
4. Mostrar el mensaje de validación exacto del criterio 3 cuando la lista esté vacía al intentar publicar.

**Hecho cuando**
- [ ] El profesor crea una pregunta ordenar_frase completa y la validación de publicación la exige (cubre criterios 1 y 3).

**Dependencias:** T8.2.1 (esquema zod).

**Notas:** reutilizar los patrones de campo/lista ya usados por el editor de opciones de `test` (H5.6).

##### T8.2.3 — UI del builder de memoria
- Etiquetas: tarea, frontend
- Bloqueada por: T8.2.1

**Descripción de la tarea**

**Objetivo:** que el profesor registre los pares a emparejar (ej. vocabulario ES↔EN, elemento↔símbolo).

**Qué hacer**
1. Mostrar filas de pares: input `left` + input `right` + botón "Añadir par".
2. Validar que ningún lado de un par quede vacío antes de publicar.
3. Persistir como `solution.pairs`.
4. Mostrar el mismo mensaje exacto de validación si no hay pares.

**Hecho cuando**
- [ ] El profesor crea un minijuego memoria con pares y la validación lo exige (cubre criterios 2 y 3).

**Dependencias:** T8.2.1.

**Notas:** no hace falta vista previa del tablero volteado en esta historia.

##### T8.2.4 — Integración con el guardado y publicación de la actividad
- Etiquetas: tarea, frontend
- Bloqueada por: T8.2.2, T8.2.3

**Descripción de la tarea**

**Objetivo:** que la pregunta minijuego viaje completa en el payload de crear/editar actividad, con posiciones coherentes junto a `test` y `completion`.

**Qué hacer**
1. Asegurar que el serializer del editor incluya `config`/`solution` solo cuando `type === 'minigame'`.
2. Verificar el orden de `position` al guardar una actividad con tipos mezclados (criterio 5).
3. Probar el flujo completo en la vista: añadir test + minijuego, guardar, reabrir y editar el minijuego.

**Hecho cuando**
- [ ] Guardar y reabrir conserva configuración y solución (cubre criterios 1, 2 y 5).

**Dependencias:** T8.2.2, T8.2.3.

**Notas:** el backend real de H3.3 aún está en desarrollo (MVP S3); probar contra el mock del editor y re-verificar con API real cuando H3.3 cierre.

### H8.3 — API: configuración jugable y auto-calificación
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 1
- Estimación: 5
- Carga: 0·5·1
- Sprint: S2
- Rol sugerido: Backend (jhon)
- Bloqueada por: H8.1

#### Descripción de la historia
**Como** equipo EduCoins, **queremos** que la API sirva el tablero jugable sin solución y auto-califique las respuestas de minijuego, **para que** el estudiante juegue en el frontend y el puntaje sea correcto sin filtrar la respuesta.

**Contexto:** H8.1 aprueba el esquema y H8.2 crea las preguntas desde el editor. Esta historia implementa el lado servidor: persistir la configuración al crear la actividad, servir el tablero barajado al estudiante y comparar la respuesta contra `solution` dentro del grading de H3.4/H3.6, al estilo de `test`/`completion`.

**Alcance**
- Incluye: persistencia de `minigames` al crear/editar actividad; proyección jugable en el GET del estudiante (sin `solution`); comparación `response` vs `solution` en el envío de la entrega con `is_correct`/`score_earned`; rechazo de doble envío; pruebas de contrato y de scoring.
- No incluye: los 5 tipos restantes, UI de ningún tipo, streaming/tiempo real, pistas.

**Criterios de aceptación**
- [ ] **Escenario 1 — Publicar con minijuegos:** Dada una actividad con preguntas `minigame`, cuando el profesor la publica, entonces las filas `minigames` quedan creadas con su `kind`, `config` y `solution` y la unicidad `(activity_id, question_position)` se respeta.
- [ ] **Escenario 2 — Tablero sin fuga:** Dado el GET de actividad del estudiante, cuando se inspecciona la respuesta, entonces las preguntas `minigame` incluyen `pieces`/`cards` barajados y **ningún** campo de `solution` ni marcador de corrección.
- [ ] **Escenario 3 — Auto-calificación correcta:** Dada una entrega con respuesta de minijuego, cuando se envía, entonces `is_correct` y `score_earned` se calculan contra `solution` y el puntaje entra al `score` de la entrega como en `test`/`completion`.
- [ ] **Escenario 4 — Respuesta parcial inválida:** Dada una respuesta con piezas repetidas o pares incompletos, cuando se envía, entonces se marca incorrecta (0 puntos) sin error 500.
- [ ] **Escenario 5 — Doble envío:** Dada una entrega ya enviada, cuando se reenvía, entonces responde con la misma regla del flujo actual de entregas y no duplica `minigame_responses`.

**Reglas de negocio y datos:** `solution` jamás se proyecta hacia estudiante (restricción dura de la épica); el shuffle usa el RNG del servidor y es determinista por sesión de GET si T8.1.2 lo define así; `UNIQUE (submission_id, minigame_id)` evita duplicados ante reintentos maliciosos.

**Conversación (por aclarar con el Product Owner):** ninguna.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T8.3.1 — Migración e implementación de `minigames` y `minigame_responses`
- Etiquetas: tarea, backend
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** que el esquema aprobado de H8.1 exista en la BD y sea accedible desde el módulo de actividades.

**Qué hacer**
1. Ejecutar el DDL de T8.1.1 como migración de Prisma (siguiendo el patrón de migraciones del repo; **no** tocar `prisma/migrations/0_init/`).
2. Generar el cliente con los nuevos modelos.
3. Implementar el hook de creación/edición de actividad: por cada pregunta `type: 'minigame'`, persistir/upsert la fila en `minigames` con `(activity_id, question_position)`; eliminar la fila cuando la pregunta se quita o deja de ser `minigame`.

**Hecho cuando**
- [ ] Publicar una actividad crea/actualiza/borra filas `minigames` en sincronía con el JSONB (cubre criterio 1).
- [ ] Un segundo intento de duplicar `(activity_id, question_position)` falla por la restricción (cubre criterio 1).

**Dependencias:** esquema aprobado de H8.1; módulo de actividades de H3.3 (en desarrollo en el MVP S3).

**Notas:** si H3.3 aún no está listo al empezar S2, implementar el hook en el servicio que quede de referencia y dejar el punto de inserción documentado (patrón usado en MVP T2.3.3).

##### T8.3.2 — Proyección jugable en el GET del estudiante
- Etiquetas: tarea, backend
- Bloqueada por: T8.3.1

**Descripción de la tarea**

**Objetivo:** entregar al frontend el tablero listo para jugar, imposible de confundir con la solución.

**Qué hacer**
1. Extender la proyección de actividad para estudiante (la de H3.3 que proyecta sin `is_correct`/`expected_answer`): para `minigame`, añadir `minigame: { kind, ...tablero }`.
2. `ordenar_frase`: devolver `pieces` con los elementos de `solution.ordered` **re-barajados en backend**.
3. `memoria`: devolver `cards: [{ id, text }]` barajadas, generando `id` efímeros por sesión; no enviar pares ni agrupaciones.
4. Test de contrato: serializar la respuesta y assert de que no contiene la cadena de ningún `ordered` completo ni pares de solución.

**Hecho cuando**
- [ ] El GET devuelve tablero jugable y sin solución (cubre criterio 2).
- [ ] El test de no-fuga pasa para los 2 tipos (cubre criterio 2).

**Dependencias:** T8.3.1 (filas y modelos).

**Notas:** reutilizar el mismo patrón de proyección segura de H3.3 — misma capa, mismos tests.

##### T8.3.3 — Auto-calificación de respuestas de minijuego en el envío
- Etiquetas: tarea, backend
- Bloqueada por: T8.3.2

**Descripción de la tarea**

**Objetivo:** comparar la respuesta del estudiante contra `solution` en el mismo punto donde hoy se auto-califican `test`/`completion` (grading de H3.4/H3.6), y guardar el resultado.

**Qué hacer**
1. En el servicio de grading, añadir el caso `minigame`: leer `response` del `answers[]` de la entrega, cargar la fila `minigames` por `(activity_id, question_position)` y comparar.
2. `ordenar_frase`: igualdad exacta de arrays ordenados.
3. `memoria`: igualdad de conjunto de pares (orden del envío irrelevante; cada par exacto).
4. Guardar `minigame_responses` (`response`, `is_correct`, `score_earned` = `score` de la pregunta si correcto, 0 si no) y sumar al `score` de la entrega junto al resto de preguntas.
5. Respuesta malformada (piezas repetidas, pares incompletos, campos faltantes) → incorrecta con 0, nunca 500.

**Hecho cuando**
- [ ] Acierto suma exactamente el `score` de la pregunta y error suma 0 (cubre criterios 3 y 4).
- [ ] El `score` total de la entrega incluye minijuegos junto a `test`/`completion` (cubre criterio 3).

**Dependencias:** T8.3.2 (modelos y tablero servido); pipeline de grading de H3.4/H3.6.

**Notas:** la comparación corre **solo** en backend; el frontend jamás recibe `solution` para evaluar (restricción AGENTS.md §minijuegos).

##### T8.3.4 — Pruebas de la API: fuga, scoring y doble envío
- Etiquetas: tarea, qa
- Bloqueada por: T8.3.3

**Descripción de la tarea**

**Objetivo:** cerrar la historia con las garantías de seguridad y corrección que exige la épica.

**Qué hacer**
1. Test e2e del servicio: publicar actividad con 2 minijuegos → GET estudiante sin solución → enviar respuesta correcta → verificar score.
2. Caso negativo: respuesta repetida/incompleta → 0 puntos sin error.
3. Caso negativo: reenvío → la regla actual del flujo de entregas, sin duplicar `minigame_responses`.
4. Auditoría: ninguna respuesta del GET de estudiante contiene campos `solution`, `ordered` completo ni pares.

**Hecho cuando**
- [ ] Los 4 tests pasan (cubre criterios 2, 3, 4 y 5).

**Dependencias:** T8.3.3.

**Notas:** registrar los tests como parte de la suite de regresión del backend.

### H8.4 — Juegos del estudiante: ordenar_frase y memoria
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 1
- Estimación: 5
- Carga: 5·0·0
- Sprint: S3
- Rol sugerido: Front (tú), con apoyo backend puntual
- Bloqueada por: H8.2, H8.3

#### Descripción de la historia
**Como** estudiante, **quiero** resolver las preguntas minijuego jugando dentro de la actividad, **para que** demuestre lo que sé de forma interactiva y gane los puntos de la pregunta igual que en el resto del cuestionario.

**Contexto:** hoy `PreguntaCuestionario` muestra `minigame` con el aviso "se resuelve de otra forma" (spec 019, punto de sustitución). H8.2 permite al profesor crear estas preguntas y H8.3 las sirve con auto-calificación; esta historia reemplaza el aviso por los juegos reales.

**Alcance**
- Incluye: componente `JuegoMinijuego` que despacha por `kind`; juego `ordenar_frase` (interacción de orden con fallback táctil de selección secuencial); juego `memoria` (tablero de tarjetas); envío de la respuesta con protección de doble envío reutilizando el patrón de H5.8; feedback acierto/error sin exponer solución; render del `prompt` con el KaTeX saneado existente.
- No incluye: tipos fuera del piloto, pistas/desbloqueos, edición de juegos, drag-and-drop nativo como requisito (la selección secuencial es el camino mínimo cumplidor), sonidos/animaciones premium.

**Criterios de aceptación**
- [ ] **Escenario 1 — Ordenar y enviar:** Dada una pregunta `ordenar_frase` publicada, cuando el estudiante sitúa las piezas en orden y envía, entonces la respuesta se registra y ve acierto/incorrecto al instante.
- [ ] **Escenario 2 — Memoria completa:** Dada una pregunta `memoria`, cuando el estudiante empareja todas las tarjetas y envía, entonces el resultado se auto-califica en backend y ve el feedback.
- [ ] **Escenario 3 — Sin fuga de solución:** Dada la respuesta del servidor al abrir la actividad, cuando se inspecciona el payload en el navegador, entonces no contiene campos de solución ni marcadores de pares correctos.
- [ ] **Escenario 4 — Un solo envío:** Dada una respuesta ya enviada, cuando intenta responder de nuevo, entonces la UI lo impide con el mismo mensaje de protección de doble envío del quiz.
- [ ] **Escenario 5 — Puntaje correcto:** Dado el acierto del juego, cuando la entrega se auto-califica, entonces el `score` de la pregunta se suma al total como en `test`/`completion`.

**Reglas de negocio y datos:** la respuesta viaja en `answers[]` con la posición de la pregunta y `response`; la comparación contra `solution` es solo backend (H8.3); al fallar, solo se reinicia el componente del juego, no la página.

**Conversación (por aclarar con el Product Owner):** ninguna — se resolvió usar selección secuencial como fallback inicial; drag-and-drop puede añadirse después sin romper el contrato.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T8.4.1 — Componente `JuegoMinijuego` con despacho por `kind`
- Etiquetas: tarea, frontend
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** tener un punto único de entrada en el cuestionario que reemplace el aviso actual de `minigame` (spec 019).

**Qué hacer**
1. Crear `frontend/src/features/estudiante/componentes/juego-minijuego.tsx` que recibe `minigame: { kind, ... }` de la proyección de H3.3 y despacha a `OrdenarFrase` o `Memoria`.
2. Sustituir el aviso "se resuelve de otra forma" en `pregunta-cuestionario.tsx` por `<JuegoMinijuego>` cuando `type === 'minigame'` y exista `minigame` en el payload; mantener el aviso como fallback si el dato falta.
3. Centralizar aquí el estado de envío protegido contra doble envío (patrón de H5.8/T5.8.2).

**Hecho cuando**
- [ ] La pregunta minijuego renderiza un juego y no el aviso (cubre criterios 1, 2 y 4).
- [ ] Sin `minigame` en el payload cae al aviso sin romper (resiliencia).

**Dependencias:** contrato del payload de T8.3.2 (nombres de `kind` y tablero).

**Notas:** importar los tipos del contrato del estudiante de spec 019 sin romperlo; si hace falta un tipo nuevo, extender allí en versión compatible.

##### T8.4.2 — Juego `ordenar_frase`
- Etiquetas: tarea, frontend
- Bloqueada por: T8.4.1

**Descripción de la tarea**

**Objetivo:** que el estudiante reconstruya el orden de las piezas recibidas y lo envíe.

**Qué hacer**
1. Renderizar `pieces` recibidas en una lista de origen y una lista objetivo.
2. Interacción de selección secuencial (tap/clic en la pieza correcta siguiente) como camino mínimo; drag-and-drop opcional si no desborda la estimación.
3. Botón "Enviar" habilitado solo con todas las piezas colocadas.
4. Enviar `response: { ordered: string[] }` vía el flujo de envío de la pregunta.

**Hecho cuando**
- [ ] Ordenar y enviar produce acierto/incorrecto al instante (cubre criterio 1).

**Dependencias:** T8.4.1.

**Notas:** no hay solución en el cliente — el feedback viene del backend al guardar la entrega (o del grading inmediato según H3.4); no implementar comparación local contra nada.

##### T8.4.3 — Juego `memoria`
- Etiquetas: tarea, frontend
- Bloqueada por: T8.4.1

**Descripción de la tarea**

**Objetivo:** que el estudiante forme pares volteando tarjetas y envíe su selección.

**Qué hacer**
1. Renderizar `cards` como tablero de tarjetas ocultas; al tocar, voltear (máximo 2 a la vez).
2. Marcar visualmente los pares ya formados (sin revelar si son correctos antes de enviar).
3. Botón "Enviar" habilitado cuando todas las tarjetas estén emparejadas.
4. Enviar `response: { pairs: [{ leftCardId, rightCardId }] }`.

**Hecho cuando**
- [ ] Emparejar todo y enviar auto-califica en backend (cubre criterio 2).

**Dependencias:** T8.4.1.

**Notas:** el emparejamiento visual local no implica corrección local; la validación es de H8.3.

##### T8.4.4 — Verificación de integración sin fuga y puntuaje
- Etiquetas: tarea, frontend
- Bloqueada por: T8.4.2, T8.4.3

**Descripción de la tarea**

**Objetivo:** verificar los dos criterios de seguridad/puntaje que dependen del contrato cliente-servidor.

**Qué hacer**
1. Test de contrato del frontend: la fixture de actividad con minijuegos del estudiante no contiene `solution`, `ordered` completo como clave del payload ni pares de solución.
2. Probar el flujo con la API real de H8.3 (cuando esté disponible) o con el mock del contrato: acierto → score reflejado en el resultado de la entrega; error → 0.
3. Verificar doble envío bloqueado en UI.

**Hecho cuando**
- [ ] Cubre criterios 3, 4 y 5.

**Dependencias:** T8.4.2, T8.4.3; API de T8.3.3 para la verificación final.

**Notas:** si la API real de H8.3 no está lista al correr esta tarea, dejar la verificación de score anotada para la suite E2E de H8.5 (no duplicar).

### H8.5 — Suite E2E del flujo minijuego
- Etiquetas: historia, testing, hito
- Prioridad: 1
- Estimación: 5
- Carga: 0·0·5
- Sprint: S4
- Rol sugerido: TBD/QA (julian)
- Bloqueada por: H8.3, H8.4

#### Descripción de la historia
**Como** equipo EduCoins, **queremos** una suite E2E del flujo actividad-con-minijuego, **para** no romper la épica sin darnos cuenta y tener el piloto certificado de extremo a extremo.

**Contexto:** E7 cerró con H7.5 como suite E2E de su flujo; E8 sigue el mismo patrón. La suite cubre desde que el profesor publica hasta que el estudiante ve su puntaje, más los casos negativos de la épica.

**Alcance**
- Incluye: setup de datos (actividad con los 2 tipos de minijuego), flujo feliz de ambos juegos, verificación de score y monedas, doble envío, no-fuga de solución, registro como regresión.
- No incluye: tipos fuera del piloto, pruebas de carga, pruebas de los builders del editor (ya cubiertas por H8.2).

**Criterios de aceptación**
- [ ] **Escenario 1 — Flujo completo:** Dada una actividad publicada con `ordenar_frase` y `memoria`, cuando el estudiante resuelve ambas correctamente y envía, entonces la entrega tiene el score esperado y las monedas del flujo normal quedan consistentes.
- [ ] **Escenario 2 — Error acumulado:** Dado el mismo flujo con respuestas incorrectas, cuando se envía, entonces el score excluye esas preguntas y no hay regresión en el resto.
- [ ] **Escenario 3 — Doble envío bloqueado:** Dada una entrega enviada, cuando se intenta reenviar, entonces la regla vigente lo impide.
- [ ] **Escenario 4 — Sin fuga y como regresión:** Dado el tráfico capturado de la suite, entonces ninguna respuesta al estudiante contiene `solution` ni marcadores de corrección, y la suite queda registrada como regresión habitual.

**Reglas de negocio y datos:** los datos del setup usan el patrón de seed/E2E del equipo (mismas utilidades que H6.3/H7.5); el scoring verificado es el de la auto-calificación de H8.3, no un cálculo del frontend.

**Conversación (por aclarar con el Product Owner):** ninguna.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
##### T8.5.1 — Setup de datos de la suite
- Etiquetas: tarea, testing
- Bloqueada por: —

**Descripción de la tarea**

**Objetivo:** tener los datos de partida reproducibles para la suite.

**Qué hacer**
1. Definir la utilidad de setup: profesor, estudiante, clase, actividad publicada con `test` + `minigame ordenar_frase` + `minigame memoria`.
2. Reutilizar las utilidades de H6.3/H7.5 sin duplicarlas.
3. Verificar que el setup crea también las filas `minigames` (no solo el JSONB).

**Hecho cuando**
- [ ] La suite arranca en limpio con el setup (cubre criterio 1 como precondición).

**Dependencias:** esquema y grading de H8.3.

##### T8.5.2 — Flujo feliz de los dos juegos
- Etiquetas: tarea, testing
- Bloqueada por: T8.5.1

**Descripción de la tarea**

**Objetivo:** certificar el camino de acierto de extremo a extremo.

**Qué hacer**
1. Ejecutar: estudiante abre actividad → ordena `ordenar_frase` correctamente → empareja `memoria` correctamente → envía.
2. Verificar el `score` de la entrega = suma de `score` de las 3 preguntas (test + 2 juegos).
3. Verificar que el flujo de monedas posterior (H3.5/H3.6) no se rompió.

**Hecho cuando**
- [ ] El score coincide exactamente y las monedas quedan consistentes (cubre criterio 1).

**Dependencias:** T8.5.1; H8.4 para la interacción de juegos.

##### T8.5.3 — Casos negativos y registro como regresión
- Etiquetas: tarea, qa
- Bloqueada por: T8.5.2

**Descripción de la tarea**

**Objetivo:** cubrir los caminos de error de la épica y dejar la suite como regresión obligatoria.

**Qué hacer**
1. Ejecutar respuestas incorrectas → score excluye esas preguntas (criterio 2).
2. Ejecutar reenvío → regla vigente de doble envío (criterio 3).
3. Auditar el tráfico completo de la suite: ninguna respuesta al estudiante contiene `solution` ni marcadores (criterio 4).
4. Registrar la suite en el flujo de pruebas habitual del equipo (misma ubicación que H6.3/H7.5).

**Hecho cuando**
- [ ] Los negativos y la auditoría pasan (cubre criterios 2, 3 y 4).
- [ ] La suite queda registrada como regresión (cubre criterio 4).

**Dependencias:** T8.5.2.

**Notas:** si la auditoría encuentra fuga, es bloqueo de release de la épica — corregir en H8.3/H8.4 antes de cerrar.

---

## Parte IV — Plan: Épica E9 · Cierre de ficha técnica (KaTeX + responsive)

> Épica publicada en Linear (team Integrator / workspace projectsU) para cerrar los dos gaps restantes de `docs/EduCoin.md` tras el MVP.

### Resumen
- Objetivo: cumplir al 100% la ficha técnica cubriendo el editor KaTeX para enunciados del profesor (§2.2) y el responsive design mobile-first (§2.3).
- Equipo: 3 personas — Front (tú), Backend (jhon), TBD/QA (julian).
- Sprint: 1 semana, continuación inmediata de E8.
- Capacidad por carril: 6 pts front · 8 pts back · 6 pts QA por sprint.

### Sprints
| Sprint | Fechas | Meta del sprint | Historias | Carga (Front·Back·QA) |
|---|---|---|---|---|
| S12 | 7–13 dic | El profesor puede insertar ecuaciones KaTeX en los enunciados mientras la suite E2E de minijuegos cierra | H8.5, H9.1 | 3·0·5 |
| S13 | 14–20 dic | Los paneles admin, profesor y estudiante pasan la auditoría responsive | H9.2 | 5·0·2 |

### E9 — Cierre de ficha técnica (KaTeX + responsive)
- Resumen: ajustes finales para cerrar los requisitos de Dev 2 (editor KaTeX) y Dev 3 (responsive) de la ficha técnica.
- Sprints que la abarcan: S12, S13

#### Descripción de la épica
**Objetivo de negocio:** dejar el producto alineado al 100% con la ficha técnica oficial sin cambiar el flujo de negocio ya establecido.

**Alcance**
- Incluye: editor de inserción/preview de ecuaciones KaTeX en el formulario de actividad del profesor; auditoría responsive de los paneles admin, profesor y estudiante; ajustes de layouts con breakpoints Tailwind.
- No incluye: nuevos tipos de minijuego, notificaciones, WebSockets, cambios de esquema grandes.

**Usuarios involucrados:** profesor (escribe enunciados con ecuaciones), estudiante (usa la app desde cualquier dispositivo).

**Historias que la componen**
- H9.1 — Editor KaTeX para enunciados del profesor
- H9.2 — Responsive design mobile-first

**Criterio de éxito:** el profesor inserta y previsualiza ecuaciones KaTeX en enunciados; los tres paneles principales pasan una auditoría responsive sin regresiones funcionales.

**Riesgos y suposiciones:** H9.1 depende del editor de actividades del MVP (H5.6); H9.2 depende de que los paneles del MVP ya existan.

**Dependencias con otras épicas:** E5 — Panel del profesor del MVP (H5.6) y E6 — Panel del estudiante del MVP (H5.7/H5.8/H5.10).

### H9.1 — Editor KaTeX para enunciados del profesor
- Etiquetas: historia, flujo-de-trabajo
- Prioridad: 2
- Estimación: 3
- Carga: 3·0·0
- Sprint: S12
- Rol sugerido: Front (tú)
- Bloqueada por: H5.6

#### Descripción de la historia
**Como** profesor, **quiero** insertar y previsualizar ecuaciones matemáticas KaTeX en los enunciados de mis actividades, **para** escribir contenido científico sin depender de sintaxis manual.

**Contexto:** KaTeX ya está instalado en el frontend pero solo se usa para render del estudiante (H5.8). Esta historia añade el editor del lado del profesor, requisito explícito de `docs/EduCoin.md` §2.2.

**Alcance**
- Incluye: botón para insertar fórmula en el campo `prompt`, preview renderizado saneado con `trust:false`, guardado del `prompt` como texto (sin cambio de esquema).
- No incluye: editor WYSIWYG completo, soporte MathJax, cambios en el render del estudiante.

**Criterios de aceptación**
- [ ] **Escenario 1 — Insertar fórmula:** Dado el formulario de actividad, cuando el profesor usa el botón de fórmula, entonces puede escribir `$$...$$` y se guarda en el `prompt`.
- [ ] **Escenario 2 — Preview saneado:** Dado que escribe una fórmula, cuando pausa, entonces se muestra el render KaTeX con `trust:false` y sin permitir HTML arbitrario.
- [ ] **Escenario 3 — Consistencia estudiante:** Dado el `prompt` guardado con fórmulas, cuando el estudiante abre la actividad, entonces el render es idéntico al preview del profesor.
- [ ] **Escenario 4 — Sin cambio de esquema:** Dada la base de datos, cuando se guarda el `prompt`, entonces solo cambia el texto del campo; no se añaden tablas ni columnas.

**Reglas de negocio y datos:** el `prompt` sigue siendo texto plano con sintaxis KaTeX; la validación anti-XSS reutiliza la utilidad de H5.8.

**Conversación (por aclarar con el Product Owner):** ninguna.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
- **T9.1.1 — Integrar botón/editor KaTeX en el campo prompt** · frontend · Bloqueada por: —
- **T9.1.2 — Preview renderizado saneado de KaTeX** · frontend · Bloqueada por: T9.1.1
- **T9.1.3 — Validación anti-XSS y tests del editor KaTeX** · qa · Bloqueada por: T9.1.2

### H9.2 — Responsive design mobile-first
- Etiquetas: historia, ui-ux
- Prioridad: 2
- Estimación: 5
- Carga: 5·0·2
- Sprint: S13
- Rol sugerido: Front (tú), con apoyo QA
- Bloqueada por: H5.5, H5.6, H5.7, H5.8, H5.10

#### Descripción de la historia
**Como** estudiante y profesor, **quiero** que los paneles se vean y funcionen correctamente en móvil y tablet, **para** usar EduCoins desde cualquier dispositivo.

**Contexto:** El kit UI (H5.2) es accesible pero no tiene criterios responsive verificables. Esta historia cierra el requisito de `docs/EduCoin.md` §2.3.

**Alcance**
- Incluye: auditoría responsive de paneles admin, profesor y estudiante; ajustes de layouts con breakpoints Tailwind (`sm`, `md`, `lg`); menús colapsables en móvil; eliminación de scroll horizontal en formularios/tablas.
- No incluye: rediseño completo de la interfaz, nuevas funcionalidades, PWA nativa.

**Criterios de aceptación**
- [ ] **Escenario 1 — Auditoría sin regresiones:** Dada una auditoría de los tres paneles, cuando se ejecuta, entonces no hay scroll horizontal en `sm` ni funcionalidades rotas.
- [ ] **Escenario 2 — Breakpoints:** Dado el cambio de viewport, cuando pasa de `sm` a `md` a `lg`, entonces los layouts se adaptan sin solapamientos.
- [ ] **Escenario 3 — Navegación móvil:** Dado un viewport `sm`, cuando el usuario navega, entonces el menú es usable (colapsable o bottom nav).
- [ ] **Escenario 4 — Reporte:** Dada la auditoría, cuando termina, entonces queda un reporte de gaps encontrados y correcciones aplicadas.

**Reglas de negocio y datos:** ninguna; es trabajo puramente frontend/QA.

**Conversación (por aclarar con el Product Owner):** ninguna.

**Definition of Ready**
- [x] Cumple INVEST
- [x] Criterios de aceptación claros
- [x] Estimada
- [x] Dependencias identificadas
- [x] Valor claro para el usuario o el negocio

#### Tareas
- **T9.2.1 — Auditar paneles en viewports móvil/tablet** · qa · Bloqueada por: —
- **T9.2.2 — Ajustar layout responsive del panel del profesor** · frontend · Bloqueada por: T9.2.1
- **T9.2.3 — Ajustar layout responsive del panel del estudiante** · frontend · Bloqueada por: T9.2.1
- **T9.2.4 — Ajustar layout responsive del panel de admin** · frontend · Bloqueada por: T9.2.1
- **T9.2.5 — Verificación final responsive** · qa · Bloqueada por: T9.2.2, T9.2.3, T9.2.4
