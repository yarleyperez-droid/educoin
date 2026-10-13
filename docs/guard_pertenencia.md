# Guard de pertenencia de recursos (`@PerteneceA`)

> **Para quién es este documento:** cualquier desarrollador que agregue
> endpoints nuevos a la API. Explica cómo funciona la verificación de
> pertenencia (un profesor solo puede tocar **sus** clases; un estudiante
> solo **sus** inscripciones/entregas/canjes) y cómo declararla en un
> endpoint para que la verificación ocurra automáticamente.
>
> **Archivos de referencia:**
> `src/common/decorators/pertenece-a.decorator.ts` (etiqueta),
> `src/common/guards/pertenencia.guard.ts` (guard global),
> `src/modules/autorizacion/` (reglas + Prisma).

---

## 1. Qué hace

Cuando un endpoint declara `@PerteneceA(...)`, **antes de que el handler
corra** la API verifica que el recurso de la URL pertenezca al usuario
autenticado, según su rol. Si el recurso no existe, si pertenece a otro
usuario o si su rol no puede poseer ese tipo de recurso, la petición
termina en **404** con el mismo mensaje que usa el resto de la API para
"no encontrado":

```json
{ "statusCode": 404, "message": "El registro solicitado no fue encontrado.", "error": "Not Found" }
```

Se responde 404 (y no 403) a propósito: no revela si el recurso existe ni
de quién es (evita enumeración de recursos, patrón recomendado contra
IDOR). El rol **admin** es global y pasa siempre sin consultar la BD.

## 2. Las tres piezas (y por qué)

| Pieza | Archivo | Responsabilidad | ¿Consulta la BD? |
|---|---|---|---|
| `@PerteneceA(tipo, parametro)` | `common/decorators/pertenece-a.decorator.ts` | **Etiqueta declarativa**: escribe metadata en la ruta ("este endpoint exige pertenencia de un recurso de tipo X cuyo id viaja en el parámetro Y"). No ejecuta nada. | ❌ |
| `PertenenciaGuard` | `common/guards/pertenencia.guard.ts` | **Ejecutor global** (tercer `APP_GUARD`): en cada petición lee la metadata, extrae el id del parámetro de ruta y el usuario del token, y **delega** en el service. Lanza el 404 si corresponde. | ❌ |
| `AutorizacionService` | `modules/autorizacion/autorizacion.service.ts` | **Las reglas de negocio + Prisma**: único dueño de las consultas de pertenencia. Reglas por recurso y por rol (tabla §4). | ✅ |

La separación respeta la regla del proyecto (AGENTS.md §8): *Prisma solo
se usa desde los Services*. El guard vive en la capa HTTP y jamás toca la
BD: toda consulta de pertenencia pasa por `AutorizacionService`.

## 3. Cadena de guards por petición

```
PUT /api/v1/classes/5
  1. JwtAuthGuard     → valida el token (firma y caducidad) y deja el usuario en request.user
  2. RolesGuard       → compara el rol contra @Roles(...) si la ruta lo declara
  3. PertenenciaGuard → lee @PerteneceA('clase', 'id')
      · sin la etiqueta → true inmediato (costo cero)
      · con la etiqueta → AutorizacionService.verificarPertenencia('clase', '5', usuario)
          ├─ pertenece  → el handler corre
          └─ ajeno/no existe → 404 "El registro solicitado no fue encontrado."
```

`@Publico()` (login, refresh, logout, healthcheck) corta en el paso 1,
así que el guard de pertenencia nunca corre sin usuario autenticado.

## 4. Reglas por recurso y rol

Los 6 tipos con regla implementada (nombres de dominio en español;
columnas reales de la BD entre paréntesis):

| Tipo en `@PerteneceA` | Tabla real | teacher | student | admin |
|---|---|---|---|---|
| `'clase'` | `classes` | suya (`classes.teacher_id = usuario.id`) | nunca | ✓ |
| `'inscripcion'` | `enrollments` | la clase de la inscripción es suya (`enrollments → classes.teacher_id`) | suya (`enrollments.student_id`) | ✓ |
| `'actividad'` | `activities` | la clase de la actividad es suya (`activities → classes.teacher_id`) | nunca | ✓ |
| `'entrega'` | `submissions` | la clase de la inscripción de la entrega es suya (`submissions → enrollments → classes.teacher_id`) | suya vía inscripción (`submissions.enrollments.student_id`) | ✓ |
| `'item'` | `redeemable_items` | la clase del ítem es suya (`redeemable_items → classes.teacher_id`) | nunca | ✓ |
| `'canje'` | `redemptions` | la clase de la inscripción del canje es suya (`redemptions → enrollments → classes.teacher_id`) | suyo vía inscripción (`redemptions.enrollments.student_id`) | ✓ |

Los "nunca" del rol student (clase, actividad, item) son de modelo:
esos recursos no tienen dueño estudiante; ni consultan la BD.

## 5. Cómo usarlo en un endpoint nuevo

```ts
@Roles('teacher')            // solo profesores (403 para otros roles)
@PerteneceA('clase', 'id')   // y además: la clase :id debe ser SUYA
@Put(':id')
actualizar(@Param('id') id: string): Promise<ClaseRespuestaDto> {
  return this.classesService.actualizar(id); // el guard ya garantó la pertenencia
}
```

- **Primer argumento**: el tipo de recurso (unión tipada `TipoRecurso`;
  un valor no registrado falla en compile-time).
- **Segundo argumento**: el nombre **exacto** del parámetro de ruta donde
  viaja el id (`@Param('id')`, `@Param('inscripcionId')`, etc.).
- Los ids viajan como string en la API y se convierten a BigInt dentro
  del service (regla §7 de AGENTS.md: BigInt no se serializa a JSON).
- Combina con `@Roles(...)`: primero el rol corta a los ajenos al rol
  (403), después la pertenencia corta a los dueños equivocados (404).

## 6. Uso desde los Services (segunda capa)

`AutorizacionService` es inyectable en cualquier Service para flujos que
no pasan por HTTP o que necesitan re-verificar en cascada — exactamente
la "verificación de pertenencia en cada Service" que exige AGENTS.md §8,
con **una sola implementación** de las reglas:

```ts
// submissions.service.ts — calificar una entrega del profesor
async calificar(id: string, usuario: UsuarioAutenticado): Promise<...> {
  await this.autorizacion.verificarPertenencia('entrega', id, usuario);
  // a partir de aquí la entrega es suya: calificar...
}
```

Si la verificación falla, la misma `NotFoundException` (404) puede
dejarse propagar: el filtro global la traduce igual que en la capa HTTP.

## 7. Cómo extenderlo (nuevos tipos de recurso)

1. Agrega el literal a `TipoRecurso` en `pertenece-a.decorator.ts`.
2. Agrega el `case` con su regla en `AutorizacionService.ejecutarRegla()`
   (una sola consulta `findFirst` con filtro por relación, si es posible).
3. Agrega la fila a la tabla del §4 de este documento.
4. Agrega tests unitarios de la regla en `autorizacion.service.spec.ts`
   (dueño ✓, ajeno → 404, rol sin derecho → 404 sin consultar BD).

## 8. Pruebas asociadas

- **Unitarias**: `src/common/guards/pertenencia.guard.spec.ts` (delegación,
  401 sin usuario, 404 sin parámetro) y
  `src/modules/autorizacion/autorizacion.service.spec.ts` (las 6 reglas +
  casos transversales: admin bypass, id no numérico, tipo desconocido).
- **E2E**: `test/pertenencia.e2e-spec.ts` — ejercita el guard completo
  contra la BD real con los datos del seed usando un controlador de
  prueba que vive solo dentro de la spec (no es API de producción):
  profesor → su clase 200; estudiante → clase 404; admin → 200;
  inscripción propia 200 vs. la de otro estudiante 404; ítems del
  profesor; entregas inexistentes 404.

## 9. Decisiones registradas

- Recurso ajeno → **404** (anti-enumeración), mismo mensaje que P2025.
- **Admin pasa siempre** (rol global, sin recursos propios).
- Arrancamos con las **6 reglas del MVP**; los tipos se listan en
  `TIPOS_RECURSO` y un tipo no registrado responde 404 (nunca "deja pasar").
- La pertenencia verifica **existencia + propiedad en una sola consulta**
  `findFirst` con filtro de relación; la BD sigue siendo la red de
  seguridad final (triggers de organización/inscripción, AGENTS.md §6).
