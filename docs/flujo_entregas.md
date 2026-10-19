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
> **Fecha:** 2026-10-18 · **Endpoints activos:** `GET`, `PUT` y `POST`
> `/api/v1/activities/:id/submissions` (rol `student`), `POST`
> `/api/v1/activities/:id/submissions/archivos` (subida multipart,
> rol `student`) y `GET`
> `/api/v1/activities/:id/submissions/:entregaId/archivos/:posicion/:indice`
> (descarga autorizada, roles `student`/`teacher`).

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
                 submitted ──(POST calificar: profesor dueño)──▶ graded | rejected
                              graded ──✗ 409: jamás se recalifica (el UPDATE
                              filtra por status='submitted': sin doble pago)
                 rejected ──(futuro: reenvío del estudiante)──▶ submitted
```

- **Una sola fila por estudiante y actividad** (`uq_submission` sobre
  `activity_id + enrollment_id`): el borrador y la entrega final son LA
  MISMA FILA que transiciona de estado. No hay "dos entregas".
- `submitted/graded/rejected` **jamás regresan a `in_progress`**: PUT
  responde 409 (regla del equipo: no se puede volver de "submitted" a
  "draft").
- **La calificación es unilateral y no se repite**: el UPDATE de
  `POST .../calificar` exige `status='submitted'` en el `where` — una
  entrega `graded`/`rejected` (o un borrador) responde 409 sin tocar la
  fila, así el trigger `fn_award_coins` no puede otorgar dos veces las
  monedas de la misma entrega.

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

### 3.1 Cola de calificación del profesor

`GET /api/v1/activities/:id/submissions/queue` — TODAS las entregas de SU
actividad, para calificarlas. Exige rol `teacher` (`@Roles('teacher')`:
student/admin → 403) y la regla `actividad` (`@PerteneceA('actividad', 'id')`
+ re-verificación en el Service): la clase de la actividad es suya — un
profesor ajeno (o un id inexistente) recibe el 404 estándar
anti-enumeración.

- **Query**: paginación estándar `?page=1&limit=20` (tope 50) y filtro
  opcional `?estado` del enum real (`in_progress | submitted | graded |
  rejected`). El caso principal es `?estado=submitted`: las que esperan la
  revisión del profesor.
- **Respuesta**: sobre estándar de listados `{ data, meta { total, page,
  limit } }`. Cada fila es un resumen con los datos del estudiante (join
  `enrollments → users`: para calificar hay que saber quién entregó):
  `id`, `estudiante { id, usuario, nombre, apellido }`, `estado`,
  `entregadoEn` (null en borrador), `puntaje` (null hasta calificar),
  `monedasOtorgadas`. **Sin `answers`**: el listado es un resumen (mismo
  criterio que el de actividades); el contenido está en la vista de
  revisión (§3.2).
- **Orden**: FIFO — `submitted_at` ascendente (los NULL al final): una cola
  de calificación atiende primero lo más antiguo.

### 3.2 Revisión y calificación del profesor

Los dos exigen rol `teacher` y la MISMA regla `actividad` que la cola
(solo el dueño de la clase de la actividad; un profesor ajeno recibe el
404 estándar). El Service exige además que la entrega pertenezca a ESA
actividad (una entrega existente de otra actividad da el mismo 404).

| Método y ruta | Qué hace | Éxito | Errores propios |
|---|---|---|---|
| `GET /activities/:id/submissions/:entregaId` | **Vista de revisión**: la fila de la cola MÁS `answers` (veredicto por respuesta), `feedback` y `calificadoEn` (graded_at). Es la única vista que expone answers a alguien distinto del estudiante dueño (§9.5): el dueño de la actividad es quien califica. | `200` con `EntregaDetalleProfesorDto` | `404` inexistente / de otra actividad / ajena |
| `POST /activities/:id/submissions/:entregaId/calificar` | **Transición definitiva**: `submitted → graded` (con puntaje) o `→ rejected` (sin él). El backend escribe SOLO `status`/`score`/`feedback`/`graded_by` (del token); las monedas y `graded_at` las acredita el trigger `fn_award_coins` en → graded, y la respuesta re-lee la fila tal como quedó. | `200 { mensaje, entrega }` | `400` condicional del puntaje · `409` ya no está `submitted` · `422` puntaje fuera de 0..total |

**Body** (`CalificarEntregaDto`): `decision: 'graded' | 'rejected'`,
`puntaje?` (hasta 2 decimales; OBLIGATORIO con `graded`, PROHIBIDO con
`rejected` — el score queda null y el estudiante reenviará) y `feedback?`
(hasta 2000 chars, la retroalimentación que el estudiante verá en su
`GET /activities/:id/submissions`).

**Anti-recalificación (regla del equipo)**: el UPDATE es atómico y filtra
por `status='submitted'` — recalificar una `graded` (o tocar un borrador)
queda sin efecto y responde 409: el `status` no se reescribe y el trigger
**no puede otorgar dos veces** las monedas de la misma entrega.

**Rango del puntaje**: `0..total`, donde total es la suma de los `score`
de las preguntas de la actividad (422 con mensaje amigable). Ojo con la
regla de la BD: el trigger acredita TODAS las monedas de la actividad en
la transición a `graded`, sin mirar el puntaje — rechazar es la única
forma de no otorgarlas.

### 3.3 Subida de archivos (preguntas `file`)

`POST /api/v1/activities/:id/submissions/archivos` — multipart/form-data
con el campo de texto `question_position` (la pregunta `file` que recibe
los archivos) y hasta **3 archivos** en el campo `archivos`. Exige rol
`student` + `actividadVisible` (misma puerta que PUT/POST).

| Validación | Rechazo | Regla |
|---|---|---|
| Pregunta inexistente / que no es `file` / sin archivos | `400` | La posición debe ser de una pregunta `file` de la actividad. |
| **MIME real** | `415` | Solo `application/pdf`, `image/jpeg`, `image/png`, decidido por **magic bytes** del contenido — nunca por la extensión ni el Content-Type del cliente (AGENTS.md §9.6). Un texto renombrado `.pdf` no pasa. |
| **Tamaño** | `413` | `UPLOAD_MAX_BYTES` (10 MB por defecto). Multer corta la petición (tope global desde `ConfigService`) y el filtro de ruta traduce su 413 al mensaje en español; el Service re-valida (validación doble). |
| Actividad cerrada | `422` | Misma regla que PUT/POST (`closes_at`). |
| Entrega ya enviada | `409` | Se revisa ANTES de escribir en disco: no quedan archivos huérfanos. |

- **Éxito `201`**: `{ mensaje, entrega }` con el borrador actualizado —
  la subida **REEMPLAZA** los archivos de esa pregunta (idempotente) y
  **conserva** las demás respuestas del borrador.
- **Nombre INTERNO**: el archivo se guarda en disco (almacén local
  `UPLOAD_DIR`, gitignored) como `{actividadId}/{inscripcionId}/{uuid}.{ext}`
  — el nombre original del estudiante **jamás** se persiste (ni en disco
  ni en la BD; AGENTS.md §9.6).
- **En la BD solo la metadata**: `answers[].files[]` con
  `{ path, mime, bytes }` (docs/plataforma_educativa_bd.md §6) — la ruta
  relativa al almacén, nunca el contenido.
- Los archivos ya subidos se referencian desde PUT/POST en las
  respuestas de preguntas `file` (§4): el Service re-verifica cada
  referencia (prefijo de la propia inscripción + existencia + coherencia
  mime/bytes) antes de guardar.

### 3.4 Descarga autorizada

`GET /api/v1/activities/:id/submissions/:entregaId/archivos/:posicion/:indice`
— descarga del archivo `:indice` (desde 0) de la pregunta `:posicion`
(desde 1) de UNA entrega. Exige **pertenencia `'entrega'`**
(`@PerteneceA('entrega', 'entregaId')` + re-verificación en el Service):
solo el **estudiante dueño** y el **profesor de la clase** (AGENTS.md
§9.6); admin → 403, cualquier otro → el 404 estándar anti-enumeración.

- La ruta del disco **nunca viaja en la URL**: se deriva de la propia
  fila (`answers` de ESA entrega, ESA pregunta, ESE índice) → imposible
  path traversal o suplantación de rutas.
- El Service exige además que la entrega pertenezca a la actividad de
  la ruta (misma regla que la vista de revisión).
- Respuesta: el contenido con `Content-Type` del MIME real y
  `Content-Disposition: attachment` con el **nombre interno**
  (`uuid.ext`).

## 4. El JSONB `answers` y su validación con zod

Estructura documentada (`docs/plataforma_educativa_bd.md` §6). Lo que el
estudiante envía es lo que se guarda, más el veredicto SOLO al enviar:

```jsonc
// BORRADOR (in_progress): tal cual lo envió el estudiante
[
  { "question_position": 1, "option": "3" },
  { "question_position": 2, "text": "6" },
  { "question_position": 3, "files": [{ "path": "7/1/uuid.pdf", "mime": "application/pdf", "bytes": 12345 }] }
]

// ENVIADA (submitted/graded): el backend añade el veredicto por respuesta
[
  { "question_position": 1, "option": "3", "is_correct": true,  "score": 5 },
  { "question_position": 2, "text": "6",    "is_correct": true,  "score": 5 },
  { "question_position": 3, "files": [ … ], "is_correct": null,   "score": null }
]
```

Validación en `dto/respuestas.schema.ts` (zod, antes de tocar la BD — la BD
solo exige que sea un arreglo JSON):

1. **Estructura (`validarRespuestas`)**: cada respuesta referencia una
   `question_position` existente de la actividad, sin repetir posición, y
   por tipo de pregunta: `test` exige `option` (texto de una opción real de
   la pregunta), `completion`/`minigame` exigen `text`, `file` exige
   `files` — referencias a archivos YA SUBIDOS (solo la metadata que
   devolvió el endpoint de subida; puede ser `[]` para desadjuntar). Los
   objetos de zod descartan claves desconocidas: `is_correct` y `score`
   del cliente **jamás** se guardan (el veredicto lo calcula el backend),
   y los archivos en preguntas no-file se rechazan con 400.
2. **Archivos (`archivoSchema` + `ArchivosService.verificar`)**: `path`
   con el formato interno generado por el servidor
   (`{actividad}/{inscripción}/{uuid}.{ext}`), `mime` de los tres
   permitidos y `bytes` entero positivo. El Service re-valida cada
   referencia contra el disco: prefijo de la PROPIA inscripción
   (anti-IDOR), existencia y coherencia mime/bytes con lo guardado.
3. **Completitud al ENVIAR (`exigirCompletitud`)**: no puede faltar ninguna
   respuesta — toda pregunta de la actividad debe estar respondida,
   **excepto `file`** (regla del equipo mantenida: aunque ya se pueden
   responder con archivos subidos, exigirlas es decisión del profesor al
   calificar). El 400 lista las posiciones faltantes.
4. **Borrador**: admite respuestas parciales e incluso `[]` (recién abre la
   actividad). El mínimo real lo decide el flujo, no el esquema.

## 5. Auto-calificación y monedas (umbral del 80%)

`auto-calificacion.ts` (funciones puras, sin BD):

- `test` → copia el `is_correct` de la opción elegida; `completion` →
  compara `text` contra `expected_answer` normalizado (trim + sin
  mayúsculas); `minigame` → queda `is_correct/score` en `null` (calificación
  manual; los minijuegos no existen aún, `docs/post_mvp.md`); `file` →
  también `null`/`null`: la subida validó MIME y tamaño del contenido,
  pero la corrección de un archivo la hace el profesor (calificación
  manual, como minigame).
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
  resultado — mirar no es entregar. La SUBIDA de archivos también responde
  422 (subir es parte de entregar); la descarga no — ver el archivo ya
  entregado no lo cambia.
- **Archivos (§9.6)**:
  - **MIME real por magic bytes** (`validar-archivo.ts`): la extensión y el
    Content-Type del cliente no se consultan; un `.pdf` de texto no pasa
    (415) y un JPEG renombrado se guarda como JPEG.
  - **Nombre interno**: en disco `{actividadId}/{inscripcionId}/{uuid}.{ext}`
    — el nombre original del estudiante jamás se persiste; en la BD solo la
    metadata `{ path, mime, bytes }` del JSONB.
  - **Anti-IDOR de las referencias**: el prefijo
    `{actividadId}/{inscripcionId}/` ES la propiedad del archivo — un
    archivo subido a una actividad no se puede referenciar desde otra (400)
    aunque su UUID se conociera; la verificación corre en cada PUT/POST que
    lo referencia.
  - **Descarga derivada de la BD**: la ruta del disco nunca viaja en la URL
    (posición + índice); la pertenencia `'entrega'` deja pasar solo al
    estudiante dueño y al profesor de la clase, y cualquier combinación
    inválida responde el 404 estándar anti-enumeración.
  - **Almacén local** (`UPLOAD_DIR`, gitignored) con re-validación de
    formato/existencia/consistencia al leer y un tope `UPLOAD_MAX_BYTES`
    aplicado por multer (DoS de la petición) y por el Service (regla de
    negocio con mensaje en español).

## 7. Implementación: decisiones clave

| Decisión | Motivo |
|---|---|
| Borrador = MISMA fila (`in_progress`), no una tabla nueva | `uq_submission` garantiza 1 entrega por estudiante; `started_at`/`submitted_at` ya modelan abrir vs. enviar. |
| PUT con `updateMany` filtrando `status='in_progress'` + `create` con re-intento en P2002 | El UPDATE condicional es atómico: un envío concurrente nunca puede ser pisado por un autosave (imposible sobreescribir respuestas de una entrega ya enviada). El re-intento absorbe la carrera entre dos autosaves simultáneos. El bloque vive en `persistirBorrador()`, compartido con la subida de archivos. |
| POST en `$transaction` interactiva con `findUnique` → update-del-borrador o create + update a `graded` | El estado se decide con la fila bloqueada por la transacción; `fn_award_coins` solo dispara en UPDATE de status, hence el paso intermedio `submitted`. |
| `cargarContexto()` compartido por los métodos del estudiante | Una sola implementación de la regla `actividadVisible` + inscripción derivada (segunda capa, AGENTS.md §8); el cierre se aplica solo donde toca. |
| Evaluación como funciones puras (`auto-calificacion.ts`) | Testeable sin BD; el service solo orquesta. |
| Subida con endpoint dedicado (multipart) + referencias en PUT/POST | El borrador y los archivos no se pisan: se sube UNA vez por pregunta (reemplazo idempotente) y las referencias viajan en las respuestas como metadata ya validada. El 409 de "ya enviada" se revisa ANTES de escribir en disco: sin huérfanos. |
| MIME por magic bytes en funciones puras (`validar-archivo.ts`) + almacén como servicio aparte (`archivos.service.ts`) | Testeable sin BD; multer queda solo como protección de la petición (tope + MemoryStorage), la regla de negocio vive en el Service con mensajes en español; el disco y la config quedan aislados en `ArchivosService`. |
| Ruta interna `{actividadId}/{inscripcionId}/{uuid}.{ext}` | El prefijo es la PROPIEDAD del archivo: la verificación anti-IDOR de las referencias es comparar el prefijo — sin tabla extra de archivos y sin registrar propiedad en ningún lado. |
| Descarga por `:posicion/:indice` con ruta derivada de la BD | La ruta del disco jamás viaja en la URL: no hay path traversal posible ni rutas adivinables; la autorización es la regla `'entrega'` del guard de pertenencia. |
| Mensajes exportados como constantes | Las pruebas comparten el texto exacto (`MENSAJE_BORRADOR_GUARDADO`, `MENSAJE_ENTREGA_YA_ENVIADA`, `MENSAJE_ENTREGA_DUPLICADA`, `MENSAJE_MIME_INVALIDO`, `MENSAJE_ARCHIVO_DEMASIADO_GRANDE`, …). |

**Archivos del módulo** (`src/modules/submissions/`):
`submissions.controller.ts` (8 rutas) · `submissions.service.ts`
(`guardarBorrador`/`adjuntarArchivos`/`miEntrega`/`entregar`/`cola`/`detalle`/`descargarArchivo`/`calificar`) ·
`archivos.service.ts` (almacén en disco: guardar/verificar/leer) ·
`validar-archivo.ts` (magic bytes, ruta interna y mensajes, funciones puras) ·
`auto-calificacion.ts` (evaluación pura) · `dto/respuestas.schema.ts`
(zod, con `archivoSchema` para `files`) · `dto/crear-entrega.dto.ts` ·
`dto/guardar-borrador.dto.ts` · `dto/adjuntar-archivo.dto.ts` (multipart) ·
`dto/listar-entregas.dto.ts` (query de la cola) ·
`dto/calificar-entrega.dto.ts` (decisión graded/rejected + puntaje +
feedback) · `dto/entrega-respuesta.dto.ts`. El filtro
`common/filters/archivo-demasiado-grande.filter.ts` traduce el 413 de
multer al mensaje de la plataforma (solo en la ruta de subida).

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

# 6) El profesor abre su cola de calificación: las pendientes, página a página
curl -X GET "/api/v1/activities/7/submissions/queue?estado=submitted&page=1&limit=20" \
  -H "Authorization: Bearer <token-profesor>"
# → 200 { "data": [ { "id": "21", "estudiante": { … }, "estado": "submitted",
#            "entregadoEn": "…", "puntaje": null, "monedasOtorgadas": 0 }, … ],
#          "meta": { "total": 3, "page": 1, "limit": 20 } }
#    (sin ?estado: todas; actividad ajena o inexistente: 404 estándar)

# 7) El profesor REVISA una entrega: respuestas con veredicto, estudiante y feedback
curl -X GET "/api/v1/activities/7/submissions/21" -H "Authorization: Bearer <token-profesor>"
# → 200 { "id": "21", "estudiante": { … }, "estado": "submitted", "calificadoEn": null,
#          "puntaje": null, "monedasOtorgadas": 0, "feedback": null, "respuestas": [ … ] }

# 8) El profesor CALIFICA (aprobar) — las monedas las acredita el trigger
curl -X POST "/api/v1/activities/7/submissions/21/calificar" \
  -H "Authorization: Bearer <token-profesor>" -H "Content-Type: application/json" \
  -d '{"decision": "graded", "puntaje": 7.5, "feedback": "Bien en general; revisa el ejercicio 1."}'
# → 200 { "mensaje": "Entrega calificada: …", "entrega": { "estado": "graded",
#          "puntaje": 7.5, "monedasOtorgadas": 120, "calificadoEn": "…", … } }

# 9) El profesor RECHAZA — sin puntaje, sin monedas (el trigger solo paga en graded)
curl -X POST "/api/v1/activities/7/submissions/21/calificar" \
  -H "Authorization: Bearer <token-profesor>" -H "Content-Type: application/json" \
  -d '{"decision": "rejected", "feedback": "Reenvía la actividad corregida."}'

# 10) El estudiante ve la calificación y el feedback (GET /activities/7/submissions)
#     → { "estado": "graded", "puntaje": 7.5, "monedasOtorgadas": 120, "feedback": "Bien en…" }

# 11) Cualquier recalificación posterior
# → 409 { "message": "La entrega ya no está pendiente de calificación: …" }

# 12) El estudiante SUBE el PDF de una pregunta file (multipart) — el
#     archivo se guarda con nombre interno; la respuesta devuelve la
#     metadata que luego viaja en las respuestas del borrador.
curl -X POST /api/v1/activities/7/submissions/archivos \
  -H "Authorization: Bearer <token-estudiante>" \
  -F question_position=3 -F "archivos=@mi-informe.pdf"
# → 201 { "mensaje": "Archivos adjuntados: …", "entrega": { "estado": "in_progress",
#          "respuestas": [ …, { "question_position": 3,
#            "files": [{ "path": "7/1/1f0c…-….pdf", "mime": "application/pdf", "bytes": 12345 }] }] } }
#    Un texto renombrado .pdf → 415; >10 MB → 413; otra pregunta → 400.

# 13) El estudiante ENVÍA con el archivo referenciado (files = la metadata
#     del paso anterior); la pregunta file queda sin veredicto (manual).
curl -X POST /api/v1/activities/7/submissions -H "Authorization: Bearer <token-estudiante>" \
  -H "Content-Type: application/json" \
  -d '{"respuestas": [{"question_position": 3, "files": [{ "path": "7/1/1f0c…-….pdf", "mime": "application/pdf", "bytes": 12345 }]}]}'

# 14) El profesor DESCARGA el archivo 0 de la pregunta 3 de la entrega 21
curl -OJ "http://localhost:3000/api/v1/activities/7/submissions/21/archivos/3/0" \
  -H "Authorization: Bearer <token-profesor>"
# → 200 application/pdf, Content-Disposition: attachment; filename="1f0c…-….pdf"
#    (otro estudiante: 404; admin: 403; índice sin archivo: 404)
```

## 9. Pruebas

- **Unitarias** (`submissions.service.spec.ts`, `auto-calificacion.spec.ts`,
  `dto/respuestas.schema.spec.ts`): veredicto por tipo, normalización,
  puntaje/umbral (borde exacto 4/5 = 80%), creación/actualización de
  borrador, 409 anti-downgrade, completitud (posiciones faltantes, exención
  de file), cierre de borrador en transacción, carreras (P2002 con
  re-intento), GET por estado; cola del profesor (where con/sin `?estado`,
  skip/take de la página, MISMO where en el count, FIFO por `submitted_at`
  asc, mapeo BigInt→string y Decimal→number con los datos del estudiante,
  404 de id no numérico); vista de revisión (where exige
  entrega↔actividad, mapeo del detalle, 404s); calificación (UPDATE atómico
  solo sobre `submitted` con `score`/`feedback`/`graded_by` del token y
  SIN `graded_at`/monedas — trigger, respuesta desde la re-lectura,
  `rejected` sin score, condicionales 400 del puntaje, 422 fuera de
  0..total, **409 al recalificar con `status='submitted'` en el where**,
  409 a un borrador, 404s).
- **Unitarias de archivos** (`validar-archivo.spec.ts`,
  `archivos.service.spec.ts` con disco real en directorio temporal,
  `test/archivo-demasiado-grande.filter.spec.ts`): magic bytes (PDF/JPG/PNG
  reales vs. texto, ejecutable renombrado, vacío), formato y traversal de
  la ruta interna, nombre UUID por MIME, roundtrip guardar→verificar→leer,
  **400 de la referencia ajena (anti-IDOR)**, inexistente e inconsistencia
  mime/bytes, límites de config, y la traducción del 413 de multer. En
  `submissions.service.spec.ts`: subida feliz (metadata en answers y
  nombre interno), merge conservando las demás respuestas, reemplazo por
  pregunta, 415/413/422/409/400 sin escribir en disco, verificación de
  referencias en PUT y POST, descarga (regla `'entrega'`, where
  entrega↔actividad, 404s de posición/índice/almacén y de ids no
  numéricos).
- **E2E** (`test/submissions.e2e-spec.ts`, BD real con el seed): ciclo
  completo por corrida — `404` sin entrega → PUT parcial → GET retoma →
  PUT `[]` → PUT completo → **POST → graded con `coins_earned` exactamente
  +120** (delta verificado en `enrollments`) → GET resultado → PUT/POST
  posteriores → 409 sin doble pago; umbral al 50% y minigame → `submitted`
  sin monedas; actividad solo-file → enviable sin respuestas, pendiente del
  profesor; 401/403/404/400/422 en las tres rutas. Cola del profesor:
  FIFO con entregas de DOS estudiantes de la misma actividad, `?estado`
  (submitted/graded), paginación `?limit=1` en dos páginas, cola vacía de
  una actividad propia, 403 de student/admin, 401 sin token y el MISMO
  404 para actividad inexistente y de otro profesor (anti-enumeración).
  Calificación: borrador → 409; envío al 50% → `submitted`; vista de
  revisión con veredictos; **graded con delta `coins_earned` +120 al
  calificar (trigger)**; el estudiante VE puntaje + feedback; **recalificar
  → 409 sin doble pago**; `rejected` sin puntaje ni monedas; la cola ya no
  lista pendientes (`?estado` graded/rejected por separado); 403/401/404
  (inexistente, de otra actividad, de otro profesor)/400/422.
- **E2E de archivos** (`test/submissions-archivos.e2e-spec.ts`, BD real):
  ciclo completo por corrida — subir PDF → 201 con borrador y **ruta
  interna (el nombre original no aparece)** → GET retoma los files →
  reemplazo por pregunta ([JPG, PNG]) **conservando la respuesta test** →
  PUT los preserva → **POST envía sin monedas** (file es manual) → 409 al
  subir/editar después de enviar → el profesor VE los files en la
  revisión → **descarga con contenido íntegro byte a byte**
  (profesor y estudiante dueño). Negativos: texto y PDF falso → **415**,
  10 MB+1 → **413 con el mensaje en español**, >3 archivos → 400,
  pregunta no-file / inexistente / sin archivos / sin question_position →
  400, referencia a archivo de OTRA actividad → **400 anti-IDOR**,
  cerrada → 422, draft/no inscrito/inexistente → 404, 401/403, y en la
  descarga: otro estudiante inscrito → 404, admin → 403, ids no numéricos
  → 404. El `afterAll` borra FÍSICAMENTE los bytes subidos por la corrida
  (higiene de disco; las filas de BD se conservan por diseño).
- **Pertenencia** (`test/pertenencia.e2e-spec.ts`): la regla `actividad`
  (la puerta de la cola, la revisión y la calificación) contra la BD real —
  dueño 200, estudiante 404, inexistente 404. La regla `'entrega'` (puerta
  de la descarga) está cubierta en `autorizacion.service.spec.ts`.

## 10. Pendiente (fuera de este flujo)

- **Reenvío del estudiante** (`rejected → submitted`, el "resubmitted" del
  negocio): la calificación (§3.2) ya cubre `submitted → graded | rejected`
  con `feedback`/`graded_by`; lo que falta es que el estudiante pueda
  REINTENTAR una entrega `rejected` (hoy el POST responde 409 para toda
  entrega ya existente). Con ese endpoint se cierra el ciclo de revisión.
- **Higiene del almacén**: los archivos de borradores jamás enviados (o de
  entregas de actividades eliminadas) quedan en disco; una tarea de
  limpieza periódica es post-MVP (los e2e limpian lo suyo en `afterAll`).
- Minijuegos reales (`docs/post_mvp.md`).
