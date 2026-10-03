# EduCoins — Backlog Post-MVP

> **⚠️ Nada de lo que aparece en este documento existe en la base de datos actual.**
> Son funcionalidades **planificadas / propuestas** que se dejaron fuera del MVP de testeo
> (esquema real: `db/001_schema.sql` — 9 tablas) pero que **no se descartan**.
>
> **Regla para agentes y equipo:** antes de implementar cualquier ítem de aquí,
> proponer el cambio de esquema (SQL + especificación + diagrama) y esperar aprobación.
> No referirse a estas tablas/columnas/funciones como si ya existieran (AGENTS.md §10, punto 2).
>
> Cada ítem indica: **Origen** · **Impacto en la BD** · **Prioridad**.

---

## 1. Decisiones abiertas (bloquean el arranque del backend)

### 1.1 Stack tecnológico
- **Qué:** confirmar TypeScript + NestJS + Next.js + Prisma (propuesto en AGENTS.md §2).
- **Origen:** propuesta del equipo; el PDF permite libre elección.
- **Impacto:** sin `package.json` ni andamiaje en el repo; todo el backend depende de esto.
- **Prioridad:** 🔴 Alta — primer paso antes de codificar.

### 1.2 Forma del repo (plano vs monorepo)
- **Qué:** mantener el repo plano (actual) o migrar a monorepo:
  `apps/api/` (NestJS) + `apps/web/` (Next.js) + `packages/shared/`.
- **Origen:** propuesta del equipo (describida originalmente en AGENTS.md §4).
- **Impacto:** reorganización de carpetas, paths, tooling; README y AGENTS §4 se actualizan.
- **Prioridad:** 🟡 Media — definir junto con el stack.

---

## 2. Sistema de modalidades de actividad (automática / manual)

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

---

## 3. Tabla `preguntas` independiente (hoy es JSONB)

- **Qué:** sacar `activities.questions` de la columna JSONB a una tabla `questions`
  (+ `options` si se necesita), para puntuación por pregunta, reordenar, editar sin reescribir el array
  y mantener historial de versión.
- **Origen:** diseño original del modelo (pre-MVP); postergada para simplificar el MVP.
- **Impacto:** tabla `questions` con `UNIQUE(activities_id, position)`,
  FK desde respuestas, posible `answers` también tabular; ajustar `fn_award_coins`/calificación.
- **Prioridad:** 🟡 Media — necesaria cuando se requiera analítica por pregunta.

---

## 4. Minijuegos (requisito del PDF — Dev 3)

- **Qué:** soporte real de minijuegos (`ordenar_frase`, `crucigrama`, `sopa_letras`, `emparejar`,
  `memoria`, `arrastrar_soltar`, `adivina_palabra`) con configuración y solución guardadas,
  y registro de la respuesta del estudiante.
- **Origen:** **PDF** (Dev 3: "Lógica de minijuegos en frontend (ordenar palabras, memoria)"; actividades de tipo minijuego).
- **Estado:** en el MVP, `activities.questions[].type = 'minigame'` es solo un marcador;
  **no hay tablas de configuración ni solución**.
- **Impacto en la BD:**
  - Tabla `minijuegos` (`actividad_id`, `tipo_minijuego` ENUM con los 7 tipos,
    `configuracion JSONB`, `solucion JSONB`).
  - Tabla `respuestas_minijuego` (`entrega_id`, `minijuego_id`, `respuesta JSONB`,
    `es_correcta`, `puntaje_obtenido`).
  - La **solución nunca sale al frontend**; la comparación ocurre en el backend.
- **Prioridad:** 🔴 Alta — es requisito explícito del PDF para la demo final.

---

## 5. Canje con aprobación del profesor (hoy instantáneo)

- **Qué:** flujo de canje revisable: `pendiente → aprobado | rechazado → entregado`,
  con reversión automática (monedas + stock) al rechazar.
- **Origen:** diseño original (regla "resuelve los canjes" del rol profesor).
- **Estado MVP:** canje **instantáneo** (`redemption_status: completed | reversed`) —
  elegido para simplificar el testeo.
- **Impacto:** ampliar `redemption_status` con `pending | approved | rejected | delivered`,
  trigger de reversión al `rejected`, campo `resolved_by`/`resolved_at`.
- **Prioridad:** 🟡 Media.

---

## 6. Tablas y objetos del diseño original (pre-MVP)

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

---

## 7. Decisiones técnicas pendientes (también en AGENTS §2)

- **Almacenamiento de archivos:** disco local / S3 / Supabase Storage.
  La BD solo guarda la ruta (`submissions.answers[].files[].path`).
- **Librería de UI/CSS** (Tailwind, shadcn…).
- **Gestor de paquetes:** pnpm (regla global) salvo decisión del equipo.
- **Despliegue.**

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
| 2026-10-02 | Creación del backlog al corregir `AGENTS.md`: contenido obsoleto/inventado movido aquí en lugar de borrarse; el esquema MVP real (9 tablas, inglés) quedó como única fuente de verdad en `db/001_schema.sql`. |
