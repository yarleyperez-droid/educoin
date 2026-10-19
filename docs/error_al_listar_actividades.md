# Error al listar las actividades de una clase (e2e preexistente)

> **Estado:** abierto · **Detectado:** 2026-10-18, al verificar la cola de
> entregas del profesor · **Tipo:** prueba frágil por acumulación de datos
> en la BD de desarrollo · **No lo causa la cola** (`GET
> /activities/:id/submissions/queue`): falla igual en el árbol limpio
> (verificado con `git stash`, §3).

## 1. El error

`pnpm test:e2e` tiene UNA prueba rota en `test/activities.e2e-spec.ts`
(ciclo de vida del profesor):

> **`GET lista las actividades de su clase como { data, meta } sin
> preguntas por fila`** (línea 208)

La prueba pide la página 1 del listado del profesor con el tope máximo:

```ts
// test/activities.e2e-spec.ts:210
.get('/api/v1/classes/1/activities?limit=50')
```

y afirma que la actividad del seed está en el resultado:

```ts
// test/activities.e2e-spec.ts:224
expect(ids).toContain('1'); // la actividad 1 del seed ('Challenge 1: Equations')
```

Falla porque la página 1 (las 50 más nuevas por `created_at desc`) ya no
incluye la actividad `1` — la más antigua de la clase:

```
expect(received).toContain(expected) // indexOf

Expected value: "1"
Received array: ["97", "96", "95", "93", "92", "91", "90", "88", "87", "85", …]
```

Resultado de la spec: **1 failed, 30 passed (31)**. El resto del suite
completo pasa: 185/186 e2e y 289/289 unitarias.

## 2. Causa raíz

Cadena de decisiones correctas por separado que juntas vuelven frágil el
assert:

1. **Los e2e crean actividades nuevas por corrida** (títulos sellados con
   `Date.now()` para no chocar entre corridas) y las borran **LÓGICAMENTE**
   en `afterAll` (`status='deleted'` + `deleted_at`) — por diseño del
   proyecto (AGENTS.md §6: jamás DELETE físico desde el flujo de negocio).
2. **El listado del profesor sin `?estado` incluye TODOS los estados**
   (también `deleted`) — también por diseño: el dueño ve sus eliminadas
   (`ActivitiesService.listar` filtra por clase, no por estado).
3. **La BD de desarrollo persiste entre corridas**, así que los `deleted`
   de cada e2e se acumulan para siempre.
4. La página 1 se llena con las más nuevas; el seed es la MÁS VIEJA de la
   clase, así que es la primera en caer fuera.

**Números reales de la BD al detectarlo (2026-10-18):**

| Dato | Valor |
|---|---|
| Actividades en la clase 1 | **95** |
| └ `published` (el seed, id 1) | 1 |
| └ `deleted` (residuos `E2E …` de corridas anteriores) | **94** |
| Página 1 de `?limit=50` (`created_at desc`) | ids 97…~48 |
| Posición del seed (id 1) | página 2 (posición ~51) |
| Residuos que genera HOY cada corrida del e2e completo | ~15 (8 de `activities.e2e-spec` + 7 de `submissions.e2e-spec`) |

Es decir: el fallo aparece cuando la clase 1 supera las 50 filas (≈ 4
corridas del suite completo desde una BD recién sembrada) y **nunca se
recupera solo** — cada corrida suma más.

## 3. Evidencia de que es preexistente

Verificado empíricamente con `git stash`:

1. `git stash push -u -m "cola-entregas-wip"` → árbol limpio, sin los
   cambios de la cola de entregas.
2. `node --experimental-vm-modules ./node_modules/jest/bin/jest.js
   --config ./test/jest-e2e.json test/activities.e2e-spec.ts`
   → **FAIL: 1 failed, 30 passed** (idéntico).
3. `git stash pop` → cambios restaurados.

La cola de entregas solo agrega **+1 actividad por corrida**
(`idActividadCola`) a la acumulación; el umbral de las 50 filas ya estaba
superado (94 residuos). El fallo habría aparecido igual dentro de pocas
corridas, con o sin la feature nueva.

## 4. Impacto

- **Solo rompe ese assert**; ninguna otra prueba, ni la API, ni la cola de
  entregas se ven afectadas (49/49 de las specs de submissions y
  pertenencia, 289/289 unitarias).
- `pnpm test:e2e` queda en rojo → **ruido en CI**: puede enmascarar
  fallos reales nuevos.
- **Empeora con cada corrida**: no se recupera solo.

## 5. Qué conlleva solucionarlo

### Opción A — Re-sembrar la BD de desarrollo (paliativo, NO duradero)

Volver a `001_schema.sql` + `002_seed.sql`. **Conlleva:**

- **Recuperar los hashes de contraseña**: el seed trae placeholders
  (`'HASH_PROF'`, `'HASH_EST'`); los usuarios reales tienen hashes argon2
  aplicados FUERA del repositorio (los e2e inician sesión con
  `Admin123!` / `Prof123!` / `Estudiante123!`). Sin re-aplicarlos, TODOS los
  e2e fallan con 401 en el login.
- **Perder la cuenta real `alejandro`** (id 49, teacher, creada en la demo
  en vivo) y cualquier dato de desarrollo no sembrado.
- **El fallo regresa en ~4 corridas** del suite completo (≈15 residuos por
  corrida). Solo sirve como reset inmediato, no como solución.

### Opción B — Hacer la prueba tolerante a la acumulación (duradera, recomendada)

Cambio pequeño en `test/activities.e2e-spec.ts` (~5 líneas) que mantiene
la intención de la prueba (el listado funciona como `{ data, meta }`):

- Conservar `expect(ids).toContain(idActividad)` — la actividad que la
  propia spec acaba de crear SIEMPRE está en la página 1.
- Reemplazar `expect(ids).toContain('1')` por cualquiera de:
  - buscar el seed en la **página 2** (`?page=2&limit=50`), o
  - un helper que **recorra las páginas** hasta encontrar el id 1
    (`meta.total` ya viaja para saber cuántas hay), o
  - listar con `?estado=published` (el seed es la única `published`
    permanente de la clase 1) y verificar el `1` ahí.

**Conlleva:** nada de API ni de BD; solo el test deja de asumir que "la
clase 1 siempre tiene ≤50 actividades". Es la única opción que arregla el
rojo HOY y a futuro.

### Opción C — Higiene post-corrida de los residuos e2e

Borrado **físico** en `afterAll` de las actividades que cada spec creó
(precedente: `test/users-alejandro.e2e-spec.ts` borra físicamente su
fixture). **Conlleva:**

- Borrar primero las **entregas** que las referencian (FK `NoAction`), que
  hoy se conservan a propósito como "historial" del `afterAll` de
  submissions.
- `afterAll` más complejos y frágiles en todas las specs que crean
  actividades. No vale la pena si se aplica B.

### Opción D — Excluir `deleted` del listado por defecto (descartada)

Cambiaría el **contrato de la API** (hoy el dueño ve sus eliminadas a
deliberadas). Es una decisión de negocio del equipo, no un fix de prueba:
no usar esto para arreglar un test.

## 6. Recomendación

1. **Ahora:** aplicar la **Opción B** (test tolerante) → el suite vuelve a
   verde sin tocar la API ni la BD.
2. **Opcional / higiene:** re-sembrar la BD (Opción A) sabiendo sus
   caveats (hashes, `alejandro`, re-acumulación) para mantener la BD dev
   legible — pero no es requisito para el verde.

## 7. Cómo reproducirlo

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config ./test/jest-e2e.json test/activities.e2e-spec.ts
# → 1 failed, 30 passed
```

Estado de la BD (lo que infla la página 1):

```sql
SELECT status, count(*) FROM activities WHERE class_id = 1 GROUP BY status;
--  published |     1   ← el seed (id 1)
--  deleted   |    94   ← residuos 'E2E …' de corridas anteriores

SELECT count(*) FROM activities WHERE class_id = 1;   -- 95 > 50
```

## 8. Anexo: contexto del hallazgo

- Detectado al correr el suite e2e completo después de implementar la
  **cola de entregas del profesor** (2026-10-18).
- Las 49 pruebas de las specs afectadas por la cola pasan
  (`submissions.e2e-spec.ts` 36/36, `pertenencia.e2e-spec.ts` 13/13) y las
  289 unitarias también — el único rojo es este fallo preexistente.
- `docs/flujo_entregas.md` §10 sigue listando como pendiente la
  **calificación del profesor** (`submitted → graded/rejected`), que
  operará sobre las entregas que la cola lista.
