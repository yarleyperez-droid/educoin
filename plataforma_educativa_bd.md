# Base de datos PostgreSQL – Plataforma Educativa Gamificada

> Documento de instrucciones para que un **agente de IA** cree la base de datos en PostgreSQL.
> El diagrama equivalente está en `plataforma_educativa.dbml` (extensión **dbdiagram** de VS Code).

---

## 1. Objetivo

Crear el esquema relacional de una plataforma educativa donde:

- El **administrador** registra organizaciones (escuelas/universidades) y crea usuarios (profesores y estudiantes) con usuario y contraseña generados.
- Los **profesores** pertenecen a una organización, crean **clases**, **actividades** (cuestionarios con recompensa en monedas), **ítems canjeables** y definen la **equivalencia monedas → nota**.
- Los **estudiantes** buscan clases por **código o nombre**, se inscriben, resuelven actividades, ganan monedas (por clase y global) y las canjean por puntos extra de nota o actividades lúdicas.
- Existe un **ranking global** de estudiantes según las monedas obtenidas en todas las clases.

## 2. Instrucciones para el agente

1. Usa **PostgreSQL 14 o superior**.
2. Crea una base de datos llamada `plataforma_educativa` (codificación UTF8).
3. Ejecuta el script de la **sección 5** en el orden indicado, dentro de una sola transacción (`BEGIN; ... COMMIT;`).
4. Guarda el script como `db/001_schema.sql` y los datos de prueba de la sección 6 como `db/002_seed.sql`.
5. Ejecuta las consultas de verificación de la sección 7 y reporta el resultado.
6. No modifiques nombres de tablas ni columnas sin consultarlo: están alineados con el DBML.
7. **Nunca** guardes contraseñas en texto plano: el campo es `password_hash` (bcrypt/argon2 generado por la aplicación).

## 3. Convenciones

| Aspecto | Convención |
|---|---|
| Nombres | `snake_case`, en español, tablas en plural |
| Claves primarias | `BIGINT GENERATED ALWAYS AS IDENTITY` |
| Fechas | `TIMESTAMPTZ` con `DEFAULT now()` |
| Correo y usuario | `CITEXT` (únicos sin distinguir mayúsculas) |
| Estados | Tipos `ENUM` de PostgreSQL |
| Borrado | Lógico en actividades (`estado = 'eliminado'`) |
| Integridad | Claves foráneas compuestas para garantizar coherencia entre clase, profesor, actividad, ítem e inscripción |

## 4. Reglas de negocio que el esquema debe garantizar

| # | Regla | Mecanismo |
|---|---|---|
| 1 | Usuario y correo únicos | `UNIQUE` sobre `CITEXT` |
| 2 | Cada usuario tiene un único rol y su tabla de perfil coincide con ese rol | FK compuesta `(usuario_id, rol)` + `CHECK` |
| 3 | Profesor y estudiante siempre pertenecen a una organización | `CHECK` en `usuarios` |
| 4 | El nombre de la clase es único (sin distinguir mayúsculas) y el código también | Índice único sobre `lower(nombre)` y `UNIQUE(codigo)` |
| 5 | Búsqueda rápida de clases por nombre o código | Índice `pg_trgm` (GIN) |
| 6 | Un estudiante solo se inscribe en clases de su misma organización | Trigger `fn_validar_inscripcion` |
| 7 | Una actividad pertenece a una clase y al profesor dueño de esa clase | FK compuesta `(clase_id, profesor_id)` |
| 8 | Estados de actividad: `privado`, `publico`, `eliminado` | `ENUM estado_actividad` |
| 9 | Tipos de pregunta: `completar`, `test`, `interpretacion`, `archivo` | `ENUM tipo_pregunta` |
| 10 | Archivos permitidos: PDF, JPG, PNG | `CHECK` sobre `mime_type` |
| 11 | Solo se puede entregar una actividad **pública** y estando inscrito | Trigger `fn_validar_entrega` |
| 12 | Un estudiante tiene una sola entrega por actividad | `UNIQUE(actividad_id, inscripcion_id)` |
| 13 | Al calificar la entrega, se otorgan las monedas de la actividad (una sola vez) | Trigger `fn_otorgar_monedas` + índice único parcial |
| 14 | Cada clase tiene su propio contador de monedas; el global es la suma | Columnas en `inscripciones` + vista `vista_monedas_estudiante` |
| 15 | El saldo nunca es negativo | `CHECK (monedas_gastadas <= monedas_ganadas)` |
| 16 | Los ítems y canjes solo se relacionan con la misma clase | FK compuestas con `clase_id` |
| 17 | El ranking se basa en **monedas ganadas** (gastarlas no baja la posición) | Vistas `ranking_global` y `ranking_por_clase` |
| 18 | Cada cambio de monedas queda auditado | Tabla `movimientos_monedas` + trigger `fn_aplicar_movimiento` |

## 5. Script de creación (`db/001_schema.sql`)

```sql
-- =====================================================================
-- PLATAFORMA EDUCATIVA GAMIFICADA - PostgreSQL 14+
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 5.1 Extensiones
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 5.2 Tipos ENUM
-- ---------------------------------------------------------------------
CREATE TYPE rol_usuario        AS ENUM ('administrador', 'profesor', 'estudiante');
CREATE TYPE tipo_organizacion  AS ENUM ('escuela', 'universidad', 'otro');
CREATE TYPE estado_clase       AS ENUM ('activa', 'archivada');
CREATE TYPE estado_inscripcion AS ENUM ('activa', 'retirada', 'bloqueada');
CREATE TYPE estado_actividad   AS ENUM ('privado', 'publico', 'eliminado');
CREATE TYPE tipo_pregunta      AS ENUM ('completar', 'test', 'interpretacion', 'archivo');
CREATE TYPE estado_entrega     AS ENUM ('en_progreso', 'enviada', 'calificada');
CREATE TYPE tipo_item          AS ENUM ('nota_extra', 'actividad_ludica');
CREATE TYPE estado_item        AS ENUM ('activo', 'inactivo', 'eliminado');
CREATE TYPE estado_canje       AS ENUM ('pendiente', 'aprobado', 'rechazado', 'entregado');
CREATE TYPE tipo_movimiento    AS ENUM ('ganancia', 'canje', 'reversion', 'ajuste');

-- ---------------------------------------------------------------------
-- 5.3 Organizaciones y usuarios
-- ---------------------------------------------------------------------
CREATE TABLE organizaciones (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(200) NOT NULL UNIQUE,
    tipo        tipo_organizacion NOT NULL,
    ciudad      VARCHAR(100),
    pais        VARCHAR(100),
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por  BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organizacion_id       BIGINT REFERENCES organizaciones(id),
    rol                   rol_usuario NOT NULL,
    username              CITEXT NOT NULL UNIQUE,
    email                 CITEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    debe_cambiar_password BOOLEAN NOT NULL DEFAULT TRUE,
    nombre                VARCHAR(100) NOT NULL,
    apellidos             VARCHAR(150) NOT NULL,
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso         TIMESTAMPTZ,
    creado_por            BIGINT REFERENCES usuarios(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_usuarios_id_rol UNIQUE (id, rol),
    CONSTRAINT ck_usuarios_org CHECK (rol = 'administrador' OR organizacion_id IS NOT NULL)
);
CREATE INDEX idx_usuarios_organizacion ON usuarios(organizacion_id);
CREATE INDEX idx_usuarios_rol ON usuarios(rol);

-- La FK circular se agrega después de crear usuarios
ALTER TABLE organizaciones
    ADD CONSTRAINT fk_organizaciones_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios(id);

CREATE TABLE administradores (
    usuario_id    BIGINT PRIMARY KEY,
    rol           rol_usuario NOT NULL DEFAULT 'administrador' CHECK (rol = 'administrador'),
    es_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (usuario_id, rol) REFERENCES usuarios(id, rol) ON DELETE CASCADE
);

CREATE TABLE profesores (
    usuario_id   BIGINT PRIMARY KEY,
    rol          rol_usuario NOT NULL DEFAULT 'profesor' CHECK (rol = 'profesor'),
    especialidad VARCHAR(150),
    departamento VARCHAR(150),
    FOREIGN KEY (usuario_id, rol) REFERENCES usuarios(id, rol) ON DELETE CASCADE
);

CREATE TABLE estudiantes (
    usuario_id         BIGINT PRIMARY KEY,
    rol                rol_usuario NOT NULL DEFAULT 'estudiante' CHECK (rol = 'estudiante'),
    grado              VARCHAR(50) NOT NULL,
    codigo_estudiantil VARCHAR(50) UNIQUE,
    FOREIGN KEY (usuario_id, rol) REFERENCES usuarios(id, rol) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 5.4 Clases e inscripciones
-- ---------------------------------------------------------------------
CREATE TABLE clases (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profesor_id BIGINT NOT NULL REFERENCES profesores(usuario_id),
    nombre      VARCHAR(150) NOT NULL,
    codigo      VARCHAR(12) NOT NULL UNIQUE
                DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    descripcion TEXT,
    estado      estado_clase NOT NULL DEFAULT 'activa',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_clases_id_profesor UNIQUE (id, profesor_id)
);
CREATE UNIQUE INDEX uq_clases_nombre ON clases (lower(nombre));
CREATE INDEX idx_clases_nombre_trgm ON clases USING gin (nombre gin_trgm_ops);
CREATE INDEX idx_clases_profesor ON clases(profesor_id);

CREATE TABLE inscripciones (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase_id            BIGINT NOT NULL REFERENCES clases(id),
    estudiante_id       BIGINT NOT NULL REFERENCES estudiantes(usuario_id),
    estado              estado_inscripcion NOT NULL DEFAULT 'activa',
    monedas_ganadas     INT NOT NULL DEFAULT 0 CHECK (monedas_ganadas >= 0),
    monedas_gastadas    INT NOT NULL DEFAULT 0 CHECK (monedas_gastadas >= 0),
    monedas_disponibles INT GENERATED ALWAYS AS (monedas_ganadas - monedas_gastadas) STORED,
    fecha_inscripcion   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inscripcion UNIQUE (clase_id, estudiante_id),
    CONSTRAINT uq_inscripciones_id_clase UNIQUE (id, clase_id),
    CONSTRAINT ck_saldo_no_negativo CHECK (monedas_gastadas <= monedas_ganadas)
);
CREATE INDEX idx_inscripciones_estudiante ON inscripciones(estudiante_id);

-- ---------------------------------------------------------------------
-- 5.5 Equivalencias, ítems canjeables y canjes
-- ---------------------------------------------------------------------
CREATE TABLE equivalencias_nota (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase_id          BIGINT NOT NULL REFERENCES clases(id),
    monedas_requeridas INT NOT NULL CHECK (monedas_requeridas > 0),
    puntos_nota       NUMERIC(4,2) NOT NULL CHECK (puntos_nota > 0),
    descripcion       VARCHAR(200),
    activa            BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_equiv_clase_monedas UNIQUE (clase_id, monedas_requeridas),
    CONSTRAINT uq_equiv_id_clase UNIQUE (id, clase_id)
);

CREATE TABLE items_canjeables (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase_id       BIGINT NOT NULL,
    profesor_id    BIGINT NOT NULL,
    nombre         VARCHAR(150) NOT NULL,
    descripcion    TEXT,
    tipo           tipo_item NOT NULL,
    costo_monedas  INT NOT NULL CHECK (costo_monedas > 0),
    equivalencia_id BIGINT,
    stock          INT CHECK (stock IS NULL OR stock >= 0),
    estado         estado_item NOT NULL DEFAULT 'activo',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_items_clase_nombre UNIQUE (clase_id, nombre),
    CONSTRAINT uq_items_id_clase UNIQUE (id, clase_id),
    CONSTRAINT fk_items_clase_profesor FOREIGN KEY (clase_id, profesor_id)
        REFERENCES clases(id, profesor_id) ON UPDATE CASCADE,
    CONSTRAINT fk_items_equivalencia FOREIGN KEY (equivalencia_id, clase_id)
        REFERENCES equivalencias_nota(id, clase_id),
    CONSTRAINT ck_item_nota_extra CHECK (tipo <> 'nota_extra' OR equivalencia_id IS NOT NULL)
);

CREATE TABLE canjes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase_id         BIGINT NOT NULL,
    inscripcion_id   BIGINT NOT NULL,
    item_id          BIGINT NOT NULL,
    costo_monedas    INT NOT NULL CHECK (costo_monedas > 0),
    puntos_nota      NUMERIC(4,2),
    estado           estado_canje NOT NULL DEFAULT 'pendiente',
    fecha_canje      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resuelto_por     BIGINT REFERENCES profesores(usuario_id),
    fecha_resolucion TIMESTAMPTZ,
    observaciones    TEXT,
    FOREIGN KEY (inscripcion_id, clase_id) REFERENCES inscripciones(id, clase_id),
    FOREIGN KEY (item_id, clase_id)        REFERENCES items_canjeables(id, clase_id)
);
CREATE INDEX idx_canjes_inscripcion ON canjes(inscripcion_id);
CREATE INDEX idx_canjes_item ON canjes(item_id);

-- ---------------------------------------------------------------------
-- 5.6 Actividades, preguntas y opciones
-- ---------------------------------------------------------------------
CREATE TABLE actividades (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clase_id          BIGINT NOT NULL,
    profesor_id       BIGINT NOT NULL,
    titulo            VARCHAR(200) NOT NULL,
    descripcion       TEXT,
    recompensa_monedas INT NOT NULL DEFAULT 0 CHECK (recompensa_monedas >= 0),
    estado            estado_actividad NOT NULL DEFAULT 'privado',
    fecha_publicacion TIMESTAMPTZ,
    fecha_cierre      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT uq_actividades_id_clase UNIQUE (id, clase_id),
    CONSTRAINT fk_actividad_clase_profesor FOREIGN KEY (clase_id, profesor_id)
        REFERENCES clases(id, profesor_id) ON UPDATE CASCADE,
    CONSTRAINT ck_actividad_fechas CHECK (fecha_cierre IS NULL OR fecha_publicacion IS NULL
                                          OR fecha_cierre > fecha_publicacion)
);
CREATE INDEX idx_actividades_clase_estado ON actividades(clase_id, estado);

CREATE TABLE preguntas (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actividad_id             BIGINT NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
    tipo                     tipo_pregunta NOT NULL,
    enunciado                TEXT NOT NULL,
    orden                    SMALLINT NOT NULL,
    puntaje                  NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (puntaje >= 0),
    respuesta_esperada       TEXT,
    tipos_archivo_permitidos TEXT[] DEFAULT ARRAY['pdf','jpg','png'],
    CONSTRAINT uq_pregunta_orden UNIQUE (actividad_id, orden)
);

CREATE TABLE opciones_pregunta (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pregunta_id BIGINT NOT NULL REFERENCES preguntas(id) ON DELETE CASCADE,
    texto       TEXT NOT NULL,
    es_correcta BOOLEAN NOT NULL DEFAULT FALSE,
    orden       SMALLINT NOT NULL,
    CONSTRAINT uq_opcion_orden UNIQUE (pregunta_id, orden)
);

-- ---------------------------------------------------------------------
-- 5.7 Entregas y respuestas
-- ---------------------------------------------------------------------
CREATE TABLE entregas (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actividad_id       BIGINT NOT NULL,
    clase_id           BIGINT NOT NULL,
    inscripcion_id     BIGINT NOT NULL,
    estado             estado_entrega NOT NULL DEFAULT 'en_progreso',
    fecha_inicio       TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_envio        TIMESTAMPTZ,
    fecha_calificacion TIMESTAMPTZ,
    puntaje_obtenido   NUMERIC(6,2),
    monedas_otorgadas  INT NOT NULL DEFAULT 0 CHECK (monedas_otorgadas >= 0),
    calificado_por     BIGINT REFERENCES usuarios(id),
    retroalimentacion  TEXT,
    CONSTRAINT uq_entrega UNIQUE (actividad_id, inscripcion_id),
    FOREIGN KEY (actividad_id, clase_id)   REFERENCES actividades(id, clase_id),
    FOREIGN KEY (inscripcion_id, clase_id) REFERENCES inscripciones(id, clase_id)
);
CREATE INDEX idx_entregas_inscripcion ON entregas(inscripcion_id);

CREATE TABLE respuestas (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entrega_id        BIGINT NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
    pregunta_id       BIGINT NOT NULL REFERENCES preguntas(id),
    opcion_id         BIGINT REFERENCES opciones_pregunta(id),
    texto_respuesta   TEXT,
    es_correcta       BOOLEAN,
    puntaje_obtenido  NUMERIC(5,2),
    retroalimentacion TEXT,
    CONSTRAINT uq_respuesta UNIQUE (entrega_id, pregunta_id)
);

CREATE TABLE archivos_respuesta (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    respuesta_id         BIGINT NOT NULL REFERENCES respuestas(id) ON DELETE CASCADE,
    nombre_original      VARCHAR(255) NOT NULL,
    ruta_almacenamiento  TEXT NOT NULL,
    mime_type            VARCHAR(100) NOT NULL
                         CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    tamano_bytes         BIGINT NOT NULL CHECK (tamano_bytes > 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5.8 Libro mayor de monedas
-- ---------------------------------------------------------------------
CREATE TABLE movimientos_monedas (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inscripcion_id BIGINT NOT NULL REFERENCES inscripciones(id),
    tipo           tipo_movimiento NOT NULL,
    cantidad       INT NOT NULL CHECK (cantidad <> 0),
    entrega_id     BIGINT REFERENCES entregas(id),
    canje_id       BIGINT REFERENCES canjes(id),
    descripcion    VARCHAR(255),
    creado_por     BIGINT REFERENCES usuarios(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_movimiento_coherente CHECK (
        (tipo = 'ganancia'  AND cantidad > 0 AND entrega_id IS NOT NULL) OR
        (tipo = 'canje'     AND cantidad < 0 AND canje_id   IS NOT NULL) OR
        (tipo = 'reversion' AND cantidad > 0 AND canje_id   IS NOT NULL) OR
        (tipo = 'ajuste')
    )
);
CREATE INDEX idx_mov_inscripcion ON movimientos_monedas(inscripcion_id, created_at);
CREATE UNIQUE INDEX uq_mov_ganancia_entrega ON movimientos_monedas(entrega_id) WHERE tipo = 'ganancia';
CREATE UNIQUE INDEX uq_mov_canje      ON movimientos_monedas(canje_id) WHERE tipo = 'canje';
CREATE UNIQUE INDEX uq_mov_reversion  ON movimientos_monedas(canje_id) WHERE tipo = 'reversion';

-- ---------------------------------------------------------------------
-- 5.9 Funciones y triggers
-- ---------------------------------------------------------------------

-- updated_at automático
CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['organizaciones','usuarios','clases','items_canjeables','actividades']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t, t);
    END LOOP;
END $$;

-- Estudiante y clase deben ser de la misma organización
CREATE OR REPLACE FUNCTION fn_validar_inscripcion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_org_estudiante BIGINT;
    v_org_clase      BIGINT;
BEGIN
    SELECT organizacion_id INTO v_org_estudiante FROM usuarios WHERE id = NEW.estudiante_id;
    SELECT u.organizacion_id INTO v_org_clase
      FROM clases c JOIN usuarios u ON u.id = c.profesor_id
     WHERE c.id = NEW.clase_id;

    IF v_org_estudiante IS DISTINCT FROM v_org_clase THEN
        RAISE EXCEPTION 'El estudiante y la clase pertenecen a organizaciones distintas';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_inscripciones_validar
BEFORE INSERT ON inscripciones
FOR EACH ROW EXECUTE FUNCTION fn_validar_inscripcion();

-- Solo se entrega una actividad pública y con inscripción activa
CREATE OR REPLACE FUNCTION fn_validar_entrega() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM actividades
                    WHERE id = NEW.actividad_id AND estado = 'publico'
                      AND (fecha_cierre IS NULL OR fecha_cierre > now())) THEN
        RAISE EXCEPTION 'La actividad no está publicada o ya cerró';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM inscripciones
                    WHERE id = NEW.inscripcion_id AND estado = 'activa') THEN
        RAISE EXCEPTION 'La inscripción no está activa';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_entregas_validar
BEFORE INSERT ON entregas
FOR EACH ROW EXECUTE FUNCTION fn_validar_entrega();

-- Al calificar, otorga la recompensa de la actividad
CREATE OR REPLACE FUNCTION fn_otorgar_monedas() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_recompensa INT;
BEGIN
    IF NEW.estado = 'calificada' AND OLD.estado <> 'calificada' THEN
        SELECT recompensa_monedas INTO v_recompensa FROM actividades WHERE id = NEW.actividad_id;
        NEW.monedas_otorgadas  := v_recompensa;
        NEW.fecha_calificacion := COALESCE(NEW.fecha_calificacion, now());
        IF v_recompensa > 0 THEN
            INSERT INTO movimientos_monedas (inscripcion_id, tipo, cantidad, entrega_id, descripcion)
            VALUES (NEW.inscripcion_id, 'ganancia', v_recompensa, NEW.id, 'Recompensa por actividad');
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_entregas_otorgar_monedas
BEFORE UPDATE OF estado ON entregas
FOR EACH ROW EXECUTE FUNCTION fn_otorgar_monedas();

-- Cada movimiento actualiza los contadores de la clase
CREATE OR REPLACE FUNCTION fn_aplicar_movimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE inscripciones
       SET monedas_ganadas  = monedas_ganadas  + CASE WHEN NEW.tipo IN ('ganancia','ajuste')
                                                      THEN NEW.cantidad ELSE 0 END,
           monedas_gastadas = monedas_gastadas + CASE WHEN NEW.tipo IN ('canje','reversion')
                                                      THEN -NEW.cantidad ELSE 0 END
     WHERE id = NEW.inscripcion_id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_movimientos_aplicar
AFTER INSERT ON movimientos_monedas
FOR EACH ROW EXECUTE FUNCTION fn_aplicar_movimiento();

-- Canje: valida ítem/stock y congela costo y equivalencia
CREATE OR REPLACE FUNCTION fn_preparar_canje() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_item items_canjeables%ROWTYPE;
BEGIN
    SELECT * INTO v_item FROM items_canjeables WHERE id = NEW.item_id FOR UPDATE;
    IF v_item.estado <> 'activo' THEN
        RAISE EXCEPTION 'El ítem no está disponible';
    END IF;
    IF v_item.stock IS NOT NULL THEN
        IF v_item.stock <= 0 THEN
            RAISE EXCEPTION 'El ítem no tiene stock';
        END IF;
        UPDATE items_canjeables SET stock = stock - 1 WHERE id = v_item.id;
    END IF;
    NEW.costo_monedas := v_item.costo_monedas;
    NEW.puntos_nota   := (SELECT puntos_nota FROM equivalencias_nota WHERE id = v_item.equivalencia_id);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_canjes_preparar
BEFORE INSERT ON canjes
FOR EACH ROW EXECUTE FUNCTION fn_preparar_canje();

-- Canje: descuenta monedas (si no alcanzan, falla ck_saldo_no_negativo)
CREATE OR REPLACE FUNCTION fn_registrar_canje() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO movimientos_monedas (inscripcion_id, tipo, cantidad, canje_id, descripcion)
    VALUES (NEW.inscripcion_id, 'canje', -NEW.costo_monedas, NEW.id, 'Canje de ítem');
    RETURN NEW;
END $$;

CREATE TRIGGER trg_canjes_registrar
AFTER INSERT ON canjes
FOR EACH ROW EXECUTE FUNCTION fn_registrar_canje();

-- Canje rechazado: devuelve monedas y stock
CREATE OR REPLACE FUNCTION fn_revertir_canje() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado = 'rechazado' AND OLD.estado <> 'rechazado' THEN
        INSERT INTO movimientos_monedas (inscripcion_id, tipo, cantidad, canje_id, descripcion)
        VALUES (NEW.inscripcion_id, 'reversion', NEW.costo_monedas, NEW.id, 'Canje rechazado');
        UPDATE items_canjeables SET stock = stock + 1
         WHERE id = NEW.item_id AND stock IS NOT NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_canjes_revertir
AFTER UPDATE OF estado ON canjes
FOR EACH ROW EXECUTE FUNCTION fn_revertir_canje();

-- ---------------------------------------------------------------------
-- 5.10 Vistas
-- ---------------------------------------------------------------------

-- Contador global de monedas por estudiante
CREATE VIEW vista_monedas_estudiante AS
SELECT estudiante_id,
       SUM(monedas_ganadas)     AS total_ganadas,
       SUM(monedas_gastadas)    AS total_gastadas,
       SUM(monedas_disponibles) AS total_disponibles
FROM inscripciones
GROUP BY estudiante_id;

-- Ranking global (todas las organizaciones)
CREATE VIEW ranking_global AS
SELECT RANK() OVER (ORDER BY COALESCE(v.total_ganadas, 0) DESC) AS posicion,
       u.id              AS estudiante_id,
       u.nombre,
       u.apellidos,
       u.organizacion_id,
       COALESCE(v.total_ganadas, 0)     AS monedas_ganadas,
       COALESCE(v.total_disponibles, 0) AS monedas_disponibles
FROM estudiantes e
JOIN usuarios u ON u.id = e.usuario_id AND u.activo
LEFT JOIN vista_monedas_estudiante v ON v.estudiante_id = e.usuario_id;

-- Ranking por clase
CREATE VIEW ranking_por_clase AS
SELECT i.clase_id,
       RANK() OVER (PARTITION BY i.clase_id ORDER BY i.monedas_ganadas DESC) AS posicion,
       u.id AS estudiante_id,
       u.nombre,
       u.apellidos,
       i.monedas_ganadas,
       i.monedas_disponibles
FROM inscripciones i
JOIN usuarios u ON u.id = i.estudiante_id
WHERE i.estado = 'activa';

-- Historial de actividades realizadas por estudiante
CREATE VIEW vista_historial_actividades AS
SELECT i.estudiante_id,
       c.id AS clase_id,
       c.nombre AS clase,
       a.id AS actividad_id,
       a.titulo,
       en.estado,
       en.puntaje_obtenido,
       en.monedas_otorgadas,
       en.fecha_envio
FROM entregas en
JOIN inscripciones i ON i.id = en.inscripcion_id
JOIN actividades a   ON a.id = en.actividad_id
JOIN clases c        ON c.id = en.clase_id;

-- Historial de ítems canjeados por estudiante
CREATE VIEW vista_historial_canjes AS
SELECT i.estudiante_id,
       c.clase_id,
       it.nombre AS item,
       it.tipo,
       c.costo_monedas,
       c.puntos_nota,
       c.estado,
       c.fecha_canje
FROM canjes c
JOIN inscripciones i  ON i.id  = c.inscripcion_id
JOIN items_canjeables it ON it.id = c.item_id;

-- Listado de estudiantes que realizaron una actividad
CREATE VIEW vista_realizaron_actividad AS
SELECT en.actividad_id,
       u.id AS estudiante_id,
       u.nombre,
       u.apellidos,
       en.estado,
       en.puntaje_obtenido,
       en.fecha_envio
FROM entregas en
JOIN inscripciones i ON i.id = en.inscripcion_id
JOIN usuarios u      ON u.id = i.estudiante_id;

COMMIT;
```

## 6. Datos de prueba (`db/002_seed.sql`)

> Los `password_hash` son marcadores de posición. La aplicación debe generar hashes reales.

```sql
BEGIN;

-- Administrador
INSERT INTO usuarios (rol, username, email, password_hash, nombre, apellidos)
VALUES ('administrador', 'admin', 'admin@plataforma.edu', 'HASH_ADMIN', 'Admin', 'General');
INSERT INTO administradores (usuario_id) SELECT id FROM usuarios WHERE username = 'admin';

-- Organización
INSERT INTO organizaciones (nombre, tipo, ciudad, pais, creado_por)
SELECT 'Colegio Demo', 'escuela', 'Buga', 'Colombia', id FROM usuarios WHERE username = 'admin';

-- Profesor
INSERT INTO usuarios (organizacion_id, rol, username, email, password_hash, nombre, apellidos, creado_por)
SELECT o.id, 'profesor', 'prof.lopez', 'lopez@demo.edu', 'HASH_PROF', 'Ana', 'López', a.id
FROM organizaciones o, usuarios a WHERE o.nombre = 'Colegio Demo' AND a.username = 'admin';
INSERT INTO profesores (usuario_id) SELECT id FROM usuarios WHERE username = 'prof.lopez';

-- Estudiantes
INSERT INTO usuarios (organizacion_id, rol, username, email, password_hash, nombre, apellidos, creado_por)
SELECT o.id, 'estudiante', x.username, x.email, 'HASH_EST', x.nombre, x.apellidos, a.id
FROM organizaciones o, usuarios a,
     (VALUES ('est.perez', 'perez@demo.edu', 'Juan', 'Pérez'),
             ('est.gomez', 'gomez@demo.edu', 'María', 'Gómez')) AS x(username, email, nombre, apellidos)
WHERE o.nombre = 'Colegio Demo' AND a.username = 'admin';
INSERT INTO estudiantes (usuario_id, grado)
SELECT id, '10°' FROM usuarios WHERE rol = 'estudiante';

-- Clase, equivalencia e ítems
INSERT INTO clases (profesor_id, nombre, descripcion)
SELECT id, 'Matemáticas 10A', 'Álgebra y trigonometría' FROM usuarios WHERE username = 'prof.lopez';

INSERT INTO equivalencias_nota (clase_id, monedas_requeridas, puntos_nota, descripcion)
SELECT id, 100, 0.50, '100 monedas = 0.5 puntos en un parcial' FROM clases WHERE nombre = 'Matemáticas 10A';

INSERT INTO items_canjeables (clase_id, profesor_id, nombre, tipo, costo_monedas, equivalencia_id, stock)
SELECT c.id, c.profesor_id, '+0.5 en el parcial', 'nota_extra', 100, e.id, NULL
FROM clases c JOIN equivalencias_nota e ON e.clase_id = c.id WHERE c.nombre = 'Matemáticas 10A';

INSERT INTO items_canjeables (clase_id, profesor_id, nombre, tipo, costo_monedas, stock)
SELECT id, profesor_id, 'Juego de trivia en clase', 'actividad_ludica', 50, 5
FROM clases WHERE nombre = 'Matemáticas 10A';

-- Inscripciones
INSERT INTO inscripciones (clase_id, estudiante_id)
SELECT c.id, u.id FROM clases c, usuarios u WHERE u.rol = 'estudiante';

-- Actividad pública con pregunta tipo test
INSERT INTO actividades (clase_id, profesor_id, titulo, descripcion, recompensa_monedas, estado, fecha_publicacion)
SELECT id, profesor_id, 'Reto 1: Ecuaciones', 'Resuelve las ecuaciones', 120, 'publico', now()
FROM clases WHERE nombre = 'Matemáticas 10A';

INSERT INTO preguntas (actividad_id, tipo, enunciado, orden, puntaje)
SELECT id, 'test', '¿Cuánto es x en 2x + 4 = 10?', 1, 5 FROM actividades WHERE titulo = 'Reto 1: Ecuaciones';

INSERT INTO opciones_pregunta (pregunta_id, texto, es_correcta, orden)
SELECT p.id, o.texto, o.ok, o.ord
FROM preguntas p,
     (VALUES ('2', FALSE, 1), ('3', TRUE, 2), ('4', FALSE, 3)) AS o(texto, ok, ord)
WHERE p.orden = 1;

COMMIT;
```

## 7. Verificación

Ejecuta estas pruebas y confirma el resultado esperado.

```sql
-- 1) Crear y calificar una entrega -> debe otorgar 120 monedas
INSERT INTO entregas (actividad_id, clase_id, inscripcion_id)
SELECT a.id, a.clase_id, i.id
FROM actividades a
JOIN inscripciones i ON i.clase_id = a.clase_id
JOIN usuarios u ON u.id = i.estudiante_id AND u.username = 'est.perez';

UPDATE entregas SET estado = 'calificada', puntaje_obtenido = 5;

-- 2) Saldo por clase del estudiante (esperado: ganadas 120, disponibles 120)
SELECT * FROM inscripciones i
JOIN usuarios u ON u.id = i.estudiante_id WHERE u.username = 'est.perez';

-- 3) Canjear el ítem "Juego de trivia" (50 monedas) -> disponibles 70
INSERT INTO canjes (clase_id, inscripcion_id, item_id)
SELECT i.clase_id, i.id, it.id
FROM inscripciones i
JOIN usuarios u ON u.id = i.estudiante_id AND u.username = 'est.perez'
JOIN items_canjeables it ON it.clase_id = i.clase_id AND it.nombre = 'Juego de trivia en clase';

-- 4) Ranking global (esperado: Juan Pérez en posición 1 con 120 monedas ganadas)
SELECT * FROM ranking_global ORDER BY posicion;

-- 5) Debe FALLAR: nombre de clase duplicado (sin distinguir mayúsculas)
INSERT INTO clases (profesor_id, nombre)
SELECT id, 'MATEMÁTICAS 10a' FROM usuarios WHERE username = 'prof.lopez';

-- 6) Debe FALLAR: canjear sin saldo suficiente (est.gomez tiene 0 monedas)
INSERT INTO canjes (clase_id, inscripcion_id, item_id)
SELECT i.clase_id, i.id, it.id
FROM inscripciones i
JOIN usuarios u ON u.id = i.estudiante_id AND u.username = 'est.gomez'
JOIN items_canjeables it ON it.clase_id = i.clase_id AND it.nombre = 'Juego de trivia en clase';

-- 7) Búsqueda de clase por nombre o código
SELECT id, nombre, codigo FROM clases
WHERE nombre ILIKE '%matem%' OR codigo = upper('CODIGO_AQUI');
```

## 8. Entregables esperados del agente

- [ ] `db/001_schema.sql` ejecutado sin errores
- [ ] `db/002_seed.sql` ejecutado sin errores
- [ ] Reporte de la sección 7 (las pruebas 5 y 6 deben fallar con error)
- [ ] Lista de tablas (`\dt`), vistas (`\dv`) y triggers creados

## 9. Notas y posibles mejoras

- **Contraseñas:** la aplicación (no la base de datos) debe generar y hashear la contraseña inicial; `debe_cambiar_password = TRUE` fuerza el cambio en el primer ingreso.
- **Varios intentos por actividad:** elimina `uq_entrega` y agrega una columna `numero_intento`.
- **Recompensa condicionada a nota mínima:** agrega `porcentaje_minimo` en `actividades` y valida en `fn_otorgar_monedas`.
- **Ranking por organización:** agrega `PARTITION BY organizacion_id` en una vista derivada de `ranking_global`.
- **Seguridad:** considera Row Level Security (RLS) para que cada profesor solo vea sus clases y cada estudiante solo sus datos.
- **Archivos:** la tabla solo guarda la ruta; los archivos deben almacenarse en un servicio externo (S3, Supabase Storage, disco del servidor).
