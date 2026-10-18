# Flujo de entregas — borrador, retomada, envío y auto-calificación

> Documento de **referencia** del módulo `src/modules/submissions/`: cómo
> funciona el ciclo completo de una entrega desde el punto de vista del
> estudiante, qué reglas lo gobiernan y cómo está implementado.
>
> **Fuentes de verdad** (si algo contradice este documento, gana la fuente):
> 1. `db/001_schema.sql` — esquema real: `submissions`, enum
>    `submission_status`, `uq_submission`, triggers `fn_validate_submission`
>    y `fn_award_coins`.
> 2. `.opencode/agents/AGENTS.md` — §6 (la lógica crítica vive en la BD),
>    §9.5 (no filtrar lo correcto), §11 (flujo de referencia).
> 3. `docs/plataforma_educativa_bd.md` — estructura JSONB (§6) y reglas 11-13.
>
> **Fecha:** 2026-10-17 · **Endpoints activos:** `GET`, `PUT` y `POST`
> `/api/v1/activities/:id/submissions` (rol `student`).

---

## 1. Mapeo de estados: lo que dice el negocio vs. la BD real

`docs/contexto_mvp.md` §2.8 describe los estados de entrega como
`draft → submitted → graded|rejected|resubmitted`. El enum REAL de la BD
(`submission_status`, máxima autoridad) es:

```
in_progress | submitted | graded | rejected
```

El mapeo acordado por el equipo (sin migrar el esquema):

| Negocio (contexto_mvp) | BD real | Nota |
|---|---|---|
| **draft** | `in_progress` | Es incluso el DEFAULT de `submissions.status`; `started_at` marca cuándo se abrió y `submitted_at` sigue NULL hasta enviar. |
| **resubmitted** | reutiliza `submitted` | Cuando exista el endpoint del profesor, reenviar tras `rejected` será una transición `rejected → submitted` con las respuestas corregidas. |

Todo el backend expone los valores reales del enum. Agregar valores nuevos
al enum exigiría una migración aprobada (AGENTS.md §10.7) y hoy no aporta
nada: la semántica queda cubierta.

## 2. Máquina de estados

```
                  PUT (autosave, por cada cambio/respuesta)
                      │ crea o actualiza el borrador
                      ▼
               ┌──────────────┐   POST enviar (completitud + evaluación)
  (sin fila) ──▶│  in_progress │──────────────────────────▶ submitted
               │  (borrador)  │                                 │
               └──────────────┘                                 │ ▼
                                                                   umbral ≥80% y
                      PUT/POST ▶ 409 (nunca baja de estado)      todo test/completion
                                                                   └▶ graded
                                                                      (fn_award_coins
                                                                       acredita monedas 1 vez)
                 submitted ──(futuro: profesor)──▶ graded | rejected
                 rejected ──(futuro: reenvío del estudiante)──▶ submitted
```

- **Una sola fila por estudiante y actividad** (`uq_submission` sobre
  `activity_id + enrollment_id`): el borrador y la entrega final son LA
  MISMA FILA que transiciona de estado. No hay "dos entregas".
- `submitted/graded/rejected` **jamás regresan a `in_progress`**: PUT
  responde 409 (regla del equipo: no se puede volver de "submitted" a
  "draft").

## 3. Endpoints

Los tres exigen rol `student` (`@Roles('student')`: teacher/admin → 403) y la
regla `actividadVisible` (`@PerteneceA('actividadVisible', 'id')` +
re-verificación en el Service): actividad `published` + inscripción ACTIVA
del estudiante en la clase de la actividad. La **inscripción nunca viaja en
la petición**: se deriva del token (la inscripción activa del estudiante en
la clase), así que no hay id ajeno que suplantar (IDOR) y un no inscrito
recibe el 404 estándar anti-enumeración antes de llegar al handler.

| Método y ruta | Qué hace | Éxito | Errores propios |
|---|---|---|---|
| `PUT /activities/:id/submissions` | **Autosave del borrador**: crea la fila como `in_progress` (si no existe) o reemplaza sus `answers`. Respuestas parciales o vacías (`[]`). | `200 { mensaje, entrega }` | `409` ya enviada (MENSAJE_ENTREGA_YA_ENVIADA) · `400` estructura · `422` cerrada |
| `GET /activities/:id/submissions` | **Mi entrega**: el borrador tal cual (retomada) o el resultado enviado/calificado. | `200` con el DTO según estado | `404` si no existe ninguna (todavía no abrió la actividad) |
| `POST /activities/:id/submissions` | **Envío definitivo**: valida estructura + completitud, cierra el borrador (`in_progress → submitted`) o crea la entrega directa, y auto-califica si se alcanza el umbral. | `201 { mensaje, entrega }` | `400` estructura/completitud · `409` duplicada · `422` cerrada |

Rechazos compartidos (precedencia): `404` no inscrito / actividad
draft/deleted/inexistente → `422` actividad cerrada (solo en PUT/POST: VER
la propia entrega no es entregar) → `400` respuestas → `409` estado. La BD
sigue siendo la red de seguridad final: `fn_validate_submission` (422) en el
INSERT y `uq_submission` (P2002 → 409) ante carreras.

## 4. El JSONB `answers` y su validación con zod

Estructura documentada (`docs/plataforma_educativa_bd.md` §6). Lo que el
estudiante envía es lo que se guarda, más el veredicto SOLO al enviar:

```jsonc
// BORRADOR (in_progress): tal cual lo envió el estudiante
[
  { "question_position": 1, "option": "3" },
  { "question_position": 2, "text": "6" }
]

// ENVIADA (submitted/graded): el backend añade el veredicto por respuesta
[
  { "question_position": 1, "option": "3", "is_correct": true,  "score": 5 },
  { "question_position": 2, "text": "6",    "is_correct": true,  "score": 5 }
]
```

Validación en `dto/respuestas.schema.ts` (zod, antes de tocar la BD — la BD
solo exige que sea un arreglo JSON):

1. **Estructura (`validarRespuestas`)**: cada respuesta referencia una
   `question_position` existente de la actividad, sin repetir posición, y
   por tipo de pregunta: `test` exige `option` (texto de una opción real de
   la pregunta), `completion`/`minigame` exigen `text`, `file` se rechaza
   (subida de archivos pendiente). Los objetos de zod descartan claves
   desconocidas: `is_correct`, `score` y `files` del cliente **jamás** se
   guardan (el veredicto lo calcula el backend).
2. **Completitud al ENVIAR (`exigirCompletitud`)**: no puede faltar ninguna
   respuesta — toda pregunta de la actividad debe estar respondida,
   **excepto `file`** (hoy no se puede responder; esa parte la califica el
   profesor). El 400 lista las posiciones faltantes.
3. **Borrador**: admite respuestas parciales e incluso `[]` (recién abre la
   actividad). El mínimo real lo decide el flujo, no el esquema.

## 5. Auto-calificación y monedas (umbral del 80%)

`auto-calificacion.ts` (funciones puras, sin BD):

- `test` → copia el `is_correct` de la opción elegida; `completion` →
  compara `text` contra `expected_answer` normalizado (trim + sin
  mayúsculas); `minigame` → queda `is_correct/score` en `null` (calificación
  manual; los minijuegos no existen aún, `docs/post_mvp.md`).
- `puntaje` = suma de los scores obtenidos (correcta → el puntaje de la
  pregunta; fallada → 0).
- **Umbral (regla del equipo)**: la entrega solo pasa a `graded` si TODA la
  actividad quedó respondida, todas las preguntas son `test`/`completion` y
  las correctas cubren al menos el **80%** del total
  (`correctas × 100 ≥ total × 80`, comparación entera sin flotantes).
- **Monedas**: SIEMPRE son cosa de la BD. `fn_award_coins` es un trigger
  `BEFORE UPDATE OF status`: otorga `reward_coins` una sola vez, setea
  `coins_awarded`/`graded_at` e inserta el movimiento `earning`. Como el
  trigger no dispara en INSERT, el envío auto-calificado es una
  **transacción**: `in_progress|nueva → submitted` y después
  `submitted → graded` (dos UPDATEs; el segundo dispara el trigger). El
  backend jamás escribe monedas, contadores ni movimientos (AGENTS.md §6).
- Bajo el umbral o con preguntas manuales → queda `submitted` con la
  evaluación parcial guardada (`score` NULL) para que el profesor decida.

## 6. Seguridad aplicada

- **Anti-IDOR**: inscripción derivada del token; ningún id del cliente.
- **§9.5**: mientras el estudiante resuelve (borrador), la API jamás incluye
  `is_correct`, `expected_answer` ni qué opción era la correcta — el borrador
  se guarda y se devuelve SIN veredicto. La retroalimentación solo existe
  DESPUÉS de enviar, y como la entrega es única por actividad, no permite
  reintentar hasta acertar.
- **DTOs por estado** (`dto/entrega-respuesta.dto.ts`): el borrador
  (`EntregaBorradorRespuestaDto`) no miente con nulos — `entregadoEn: null`,
  `puntaje: null`, respuestas sin veredicto; la enviada
  (`EntregaRespuestaDto`) lleva el resultado.
- **Actividad cerrada**: PUT/POST responden 422 (`closes_at` pasado, misma
  regla que `fn_validate_submission`); GET sigue mostrando la entrega y su
  resultado — mirar no es entregar.

## 7. Implementación: decisiones clave

| Decisión | Motivo |
|---|---|
| Borrador = MISMA fila (`in_progress`), no una tabla nueva | `uq_submission` garantiza 1 entrega por estudiante; `started_at`/`submitted_at` ya modelan abrir vs. enviar. |
| PUT con `updateMany` filtrando `status='in_progress'` + `create` con re-intento en P2002 | El UPDATE condicional es atómico: un envío concurrente nunca puede ser pisado por un autosave (imposible sobreescribir respuestas de una entrega ya enviada). El re-intento absorbe la carrera entre dos autosaves simultáneos. |
| POST en `$transaction` interactiva con `findUnique` → update-del-borrador o create + update a `graded` | El estado se decide con la fila bloqueada por la transacción; `fn_award_coins` solo dispara en UPDATE de status, hence el paso intermedio `submitted`. |
| `cargarContexto()` compartido por los tres métodos | Una sola implementación de la regla `actividadVisible` + inscripción derivada (segunda capa, AGENTS.md §8); el cierre se aplica solo donde toca. |
| Evaluación como funciones puras (`auto-calificacion.ts`) | Testeable sin BD; el service solo orquesta. |
| Mensajes exportados como constantes | Las pruebas comparten el texto exacto (`MENSAJE_BORRADOR_GUARDADO`, `MENSAJE_ENTREGA_YA_ENVIADA`, `MENSAJE_ENTREGA_DUPLICADA`, …). |

**Archivos del módulo** (`src/modules/submissions/`):
`submissions.controller.ts` (3 rutas) · `submissions.service.ts`
(`guardarBorrador`/`miEntrega`/`entregar`) · `auto-calificacion.ts`
(evaluación pura) · `dto/respuestas.schema.ts` (zod) ·
`dto/crear-entrega.dto.ts` · `dto/guardar-borrador.dto.ts` ·
`dto/entrega-respuesta.dto.ts`.

## 8. Ejemplos de uso

```bash
# 1) Autosave del borrador (recién abre la actividad, aún sin responder)
curl -X PUT /api/v1/activities/7/submissions -H "Authorization: Bearer <token-estudiante>" \
  -H "Content-Type: application/json" -d '{"respuestas": []}'
# → 200 { "mensaje": "Borrador guardado…", "entrega": { "estado": "in_progress", "entregadoEn": null, … } }

# 2) Retomar: al volver a entrar, el frontend pregunta por su entrega
curl /api/v1/activities/7/submissions -H "Authorization: Bearer <token-estudiante>"
# → 200 con el borrador tal cual (o 404 si nunca la abrió)

# 3) Autosave con lo que lleva respondido
curl -X PUT /api/v1/activities/7/submissions -H "Authorization: Bearer <token-estudiante>" \
  -H "Content-Type: application/json" \
  -d '{"respuestas": [{"question_position": 1, "option": "3"}]}'

# 4) Envío definitivo (completitud exigida)
curl -X POST /api/v1/activities/7/submissions -H "Authorization: Bearer <token-estudiante>" \
  -H "Content-Type: application/json" \
  -d '{"respuestas": [{"question_position": 1, "option": "3"}, {"question_position": 2, "text": "6"}]}'
# → 201 estado 'graded' (umbral alcanzado) con puntaje, monedas y veredictos por respuesta

# 5) Cualquier PUT posterior
# → 409 { "message": "La actividad ya fue enviada: no puede volver al estado de borrador ni editarse." }
```

## 9. Pruebas

- **Unitarias** (`submissions.service.spec.ts`, `auto-calificacion.spec.ts`,
  `dto/respuestas.schema.spec.ts`): veredicto por tipo, normalización,
  puntaje/umbral (borde exacto 4/5 = 80%), creación/actualización de
  borrador, 409 anti-downgrade, completitud (posiciones faltantes, exención
  de file), cierre de borrador en transacción, carreras (P2002 con
  re-intento), GET por estado.
- **E2E** (`test/submissions.e2e-spec.ts`, BD real con el seed): ciclo
  completo por corrida — `404` sin entrega → PUT parcial → GET retoma →
  PUT `[]` → PUT completo → **POST → graded con `coins_earned` exactamente
  +120** (delta verificado en `enrollments`) → GET resultado → PUT/POST
  posteriores → 409 sin doble pago; umbral al 50% y minigame → `submitted`
  sin monedas; actividad solo-file → enviable sin respuestas, pendiente del
  profesor; 401/403/404/400/422 en las tres rutas.

## 10. Pendiente (fuera de este flujo)

- **Calificación del profesor** (`submitted → graded/rejected` con
  `feedback`/`graded_by`): ahí nace el camino `rejected` y con él el reenvío
  del estudiante (`rejected → submitted`, el "resubmitted" del negocio).
- Subida de archivos para preguntas `file` (almacenamiento sin decidir,
  AGENTS.md §2) y minijuegos reales (`docs/post_mvp.md`).
