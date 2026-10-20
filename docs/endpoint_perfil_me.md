# Endpoint de perfil propio: `PATCH /api/v1/users/me`

> **Para quién es este documento:** cualquier desarrollador que mantenga
> la API o el frontend de EduCoins. Documenta el endpoint de
> auto-gestión del perfil, el registro de sesiones en memoria que lo
> respalda (y que afecta a TODA la API) y las decisiones de seguridad
> que lo definen.
>
> **Archivos de referencia:**
> `src/modules/users/dto/actualizar-perfil.dto.ts` (contrato de entrada),
> `src/modules/users/users.service.ts` (`actualizarPerfil`),
> `src/modules/users/users.controller.ts` (ruta `me`),
> `src/modules/auth/sesiones-activas.service.ts` (registro de sesiones),
> `src/common/guards/jwt-auth.guard.ts` (exigencia de sesión viva),
> `src/modules/auth/auth.service.ts` (jti, rotación, logout),
> `test/users-me.e2e-spec.ts` (flujo completo en e2e).

---

## 1. Qué hace

Cualquier usuario autenticado (admin, teacher o student) edita **su
propio** perfil. El objetivo nunca viaja en la petición: sale
**exclusivamente del id del JWT**, así que la pertenencia es
estructural — un usuario no puede editar a otro y IDOR es imposible
(AGENTS.md §9.7). La excepción del admin (gestionar cuentas ajenas)
sigue siendo el endpoint existente `PATCH /users/:id`, que hoy solo
cambia `activa`.

Hay **dos flujos** con distinta exigencia de identidad:

| | Campos genéricos | Campos de credenciales |
|---|---|---|
| Campos | `nombre`, `apellido`, `especialidad` | `usuario`, `correo`, `contrasenaNueva` |
| Token de acceso | Cualquiera válido con sesión viva | Además **reciente**: emitido hace < 5 min (`SEGUNDOS_FRESCURA_TOKEN`) — "como si acabaras de iniciar sesión" |
| Identificación en el body | `contrasena` (la actual, obligatoria) | `contrasena` **+** `correoActual` — pareja correo+contraseña, igual que el login |
| Efecto secundario | Ninguno: la sesión sigue viva | **Se cierran TODAS las sesiones del usuario** (todos los dispositivos) + la respuesta expira la cookie de refresh → re-login forzado con las credenciales nuevas |

`rol` y `organizacionId` **no se pueden cambiar aquí nunca**: el DTO
los rechaza con un mensaje específico (solo el admin los gestiona) y
el service, además, jamás los mapea al UPDATE — doble barrera.
Los campos inexistentes en la entidad (`biografia`, `is_active`, …)
los rechaza el `ValidationPipe` global (`whitelist` +
`forbidNonWhitelisted`, `src/app.setup.ts`): el DTO ES la allow-list.

## 2. Contrato de la petición

`PATCH /api/v1/users/me` con `Authorization: Bearer <accessToken>`:

| Campo | Obligatorio | Validación | Significado |
|---|---|---|---|
| `contrasena` | **Siempre** | string 8–128 | Contraseña ACTUAL: confirma que quien edita es el dueño de la sesión y no quien la robó. Se verifica con argon2 contra `users.password_hash`. |
| `nombre` | No | patrón `PATRON_NOMBRE`, ≤ 100 | Nombre propio; ausente = no se toca |
| `apellido` | No | patrón `PATRON_NOMBRE`, ≤ 150 | Apellido; ausente = no se toca |
| `especialidad` | No | string no vacío ≤ 150, o `null` | Solo `teacher` (si no → 400). Un string la cambia; **`null` la limpia**; ausente = no se toca |
| `correoActual` | Solo con credenciales | email ≤ 254 | Correo ACTUAL de la cuenta: identificación completa para cambiar credenciales (comparación insensible a mayúsculas, CITEXT) |
| `usuario` | No | patrón `PATRON_USERNAME` | Username NUEVO (CITEXT UNIQUE → duplicado en otra cuenta = 409) |
| `correo` | No | email ≤ 254 | Correo NUEVO (CITEXT UNIQUE → duplicado en otra cuenta = 409) |
| `contrasenaNueva` | No | string 8–128 (rango del login) | Contraseña NUEVA: se guarda como hash argon2 y además pone `must_change_password = false` (cierra el flujo del primer inicio que exige la BD) |
| `rol` | **Prohibido** | validador custom → 400 | *"El rol solo puede modificarlo un administrador."* |
| `organizacionId` | **Prohibido** | validador custom → 400 | *"La organización solo puede modificarla un administrador."* |
| cualquier otro campo | — | rechazo del whitelist → 400 | p. ej. `biografia`: *"property biografia should not exist"* |

Notas de la validación:

- Un PATCH que solo trae `contrasena` (nada que actualizar) responde
  400 `MENSAJE_ACTUALIZACION_PERFIL_VACIA`.
- El pre-check de duplicados se **auto-excluye** (`NOT: { id: propio }`):
  reenviar tu propio username/correo sin cambiarlo no es un 409. La BD
  sigue de red de seguridad con P2002 → 409 vía el filtro global.
- `updated_at` jamás se escribe (trigger `fn_set_updated_at`), y el
  UPDATE solo lleva los campos presentes (Prisma ignora `undefined`).

## 3. Respuesta

```json
{
  "mensaje": "Perfil actualizado con éxito.",
  "sesionCerrada": false,
  "usuario": {
    "id": "12", "usuario": "prof.ejemplo", "correo": "prof@x.test",
    "rol": "teacher", "nombre": "Ana", "apellido": "López",
    "especialidad": "Mathematics", "organizacionId": "1",
    "debeCambiarContrasena": true, "activo": true, "creadoEn": "2026-…"
  }
}
```

- Cambio genérico → `mensaje` = `MENSAJE_PERFIL_ACTUALIZADO` y
  `sesionCerrada: false`.
- Cambio de credenciales → `mensaje` =
  `MENSAJE_CREDENCIALES_ACTUALIZADAS` y `sesionCerrada: true`; esa MISMA
  respuesta trae `Set-Cookie` que expira la cookie de refresh. El
  cliente debe descartar sus tokens y volver al login.
- `password_hash` y `last_login` jamás salen (el select de Prisma ni
  los lee, salvo el hash que `actualizarPerfil` usa solo para verificar).

## 4. Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 | Perfil actualizado (con `sesionCerrada` según el flujo) |
| 400 | Validación del DTO (formatos, prohibidos, campos inexistentes, cuerpo sin cambios, credencial sin `correoActual`) |
| 401 | Sin token / token malformado (guard); token con sesión revocada o previa al registro (`MENSAJE_SESION_CERRADA`); token no reciente al cambiar credenciales (`MENSAJE_TOKEN_NO_FRESCO`); usuario desactivado (re-verificado en BD) |
| 403 | Contraseña actual incorrecta; `correoActual` que no coincide (`MENSAJE_IDENTIFICACION_ERRONEA`, único para no revelar cuál falló) |
| 409 | `usuario`/`correo` nuevos ya existen en OTRA cuenta (CITEXT, insensible a mayúsculas) |

## 5. El registro de sesiones (`SesionesActivasService`)

Nuevo proveedor en `AuthModule` (exportado): mapa en memoria
`userId → Set<jti>`. Cada token (access **y** refresh) viaja ahora con
un `jti` único (`crypto.randomUUID()`) generado al firmarlo.

| Operación | Quién la llama | Efecto |
|---|---|---|
| `registrar(id, …jtis)` | `AuthService.login` (login y refresh) | Deja vivos los tokens recién emitidos |
| `esValida(id, jti)` | `JwtAuthGuard` (cada petición) y `AuthService.refrescar` | Un token firmado con sesión muerta → 401 `MENSAJE_SESION_CERRADA` |
| `consumir(id, jti)` | `refrescar` (rotación) y `cerrarSesion` (logout) | Mata UNA sesión: el refresh es de **uso único** y el logout ahora revoca de verdad |
| `revocarUsuario(id)` | `UsersService.actualizarPerfil` (solo rama credenciales) | Mata TODAS las sesiones del usuario en todos los dispositivos |

Consecuencias diseñadas (decisión del equipo, **sin tocar la BD**):

1. **Reinicio del servidor** (deploy o watch de `start:dev`): el mapa
   se vacía → TODAS las sesiones existentes quedan muertas → re-login
   general; el registro se repuebla con cada inicio de sesión. Los
   tokens previos a este cambio tampoco sirven (no traen `jti`:
   fail-closed en el guard).
2. **Rotación real de refresh**: usar una cookie de refresh dos veces
   (p. ej. dos pestañas) → la segunda recibe 401; cada canje registra el
   par nuevo.
3. **Logout real**: `POST /auth/logout` consume el `jti` del refresh de
   la cookie antes de expirarla — un refresh robado ya no sirve tras el
   logout del dueño.
4. El access token de una sesión revocada muere **al instante** en
   cualquier endpoint (no hay que esperar sus ≤ 15 min de vida).

Coste: una búsqueda O(1) en memoria por petición (el guard sigue sin
consultar la BD). Las entradas de access tokens caducados quedan
huérfanas en el mapa: son cadenas minúsculas y esos tokens ya no pasan
la verificación de `exp` — jamás autorizan nada.

## 6. Decisiones de seguridad y su justificación

1. **Contraseña actual en todos los cambios.** Un atacante que robó un
   access token no puede editar el perfil sin la contraseña. La
   verificación es argon2 contra el hash de la BD; un hash corrupto se
   trata como contraseña incorrecta (403), no como 500.
2. **"La contraseña no viaja en texto plano".** Viaja en el body
   protegido por HTTPS en producción — exactamente igual que el login
   existente (`IniciarSesionDto`), el estándar de la industria. Jamás
   se persiste, se registra en logs ni se devuelve (Nest no loguea
   bodies). Hashear en el cliente antes de enviar **no** añade
   seguridad real (el hash se volvería la contraseña) y rompería la
   consistencia con el login; los protocolos de desafío-respuesta
   (SRP) quedan fuera del MVP.
3. **Token reciente para credenciales ("sudo mode").** El JWT ya trae
   `iat`; el service exige ≤ `SEGUNDOS_FRESCURA_TOKEN` (300 s) y falla
   cerrado si falta. Así, cambiar credenciales exige **acabar de
   iniciar sesión**, además de la pareja `correoActual`+`contrasena`.
4. **Cierre total tras cambiar credenciales.** Las sesiones de todos
   los dispositivos mueren al instante (§5) y la respuesta expira la
   cookie: las credenciales viejas (y cualquier sesión iniciada con
   ellas) dejan de servir de inmediato.
5. **`must_change_password = false` al cambiar contraseña.** Es el
   cierre del flujo del primer inicio que la BD exigía desde el alta:
   antes de este endpoint no existía ninguna vía de cambio de
   contraseña.
6. **rol/organización intocables.** Doble barrera: mensaje 400
   específico en el DTO + el service jamás los mapea al `data` del
   UPDATE. Aunque alguien bypaseara la validación, no hay camino por
   el que el campo llegue a la BD.
7. **Pertenencia estructural.** `/me` no recibe id del cliente; el
   objetivo sale del token verificado. El admin edita otras cuentas
   por `PATCH /users/:id` (hoy solo `activa`).

## 7. Orden de la ruta en el controller

`@Patch('me')` está declarado **antes** de `@Patch(':id')` en
`UsersController`: Express casa las rutas en orden de declaración y
`':id'` capturaría la cadena `'me'`. Sin `@Roles(...)`, `RolesGuard`
solo exige estar autenticado.

## 8. Pruebas

- **Unitarias** (`users.service.spec.ts`, `auth.service.spec.ts`,
  `jwt-auth.guard.spec.ts`): happy paths de ambos flujos, contraseña
  incorrecta/hash corrupto → 403, token no fresco/sin `iat` → 401,
  `correoActual` ausente → 400 / no coincide → 403, duplicados
  auto-excluidos → 409, `especialidad` de estudiante → 400, `null`
  limpia / ausente no se toca, hash argon2 + `must_change_password`
  en el UPDATE, registro/consumo/revocación de sesiones, refresh de
  uso único, logout consume la sesión.
- **E2e** (`test/users-me.e2e-spec.ts`, BD real con seed): edición
  genérica verificada en `GET /auth/perfil`; rechazos de `rol`,
  `organizacionId` y `biografia`; flujo completo de credenciales —
  token fresco + identificación → 200 con `Set-Cookie` de expiración,
  el token viejo responde 401 de sesión cerrada, la cookie vieja no
  canjea sesión, y el re-login con las credenciales nuevas funciona y
  ya no exige cambio de contraseña; logout consume el refresh del
  admin. Presupuesto exacto del rate limit: **5 logins**.
- **Regresión:** la suite e2e existente sigue en verde porque todo flujo
  loguea de verdad (el registro se puebla solo) y los tokens artesanales
  de `guards-globales.e2e-spec.ts` fallan en la firma, antes del check
  de sesión.

## 9. Limitaciones conocidas / comportamiento aceptado

- El registro es **por instancia y en memoria**: no se comparte entre
  réplicas y se pierde al reiniciar (→ re-login general, diseñado así).
  Si en el futuro se quiere persistencia de la revocación sin forzar
  re-login tras cada reinicio, la vía es una columna
  `sessions_invalidated_at` en `users` consultada en `refrescar` (ya
  lee el usuario) — requiere aprobación de cambio de esquema.
- El JWT en curso conserva el `username` viejo hasta expirar; es
  inofensivo porque la autorización usa `id`/`role`/`organizacionId`,
  que no cambian en este endpoint.
- La ventana de frescura (5 min) es una constante del service
  (`SEGUNDOS_FRESCURA_TOKEN`); si el equipo quiere hacerla configurable,
  debería viajar como variable de entorno validada al arrancar.

## 10. Fuera de alcance (posibles siguientes pasos)

- Que el **admin** edite `rol`/`organización`/campos genéricos de
  cuentas ajenas (extender `PATCH /users/:id`, hoy solo `activa`).
- Cualquier campo nuevo de la tabla `users` (p. ej. biografía) exigiría
  su propio plan; hoy no existe en el esquema (`db/001_schema.sql`).
