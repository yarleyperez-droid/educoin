-- =====================================================================
-- EduCoins · 001_schema.sql
-- ---------------------------------------------------------------------
-- DOCSTRING / PROPÓSITO:
--   Crea el esquema completo (MVP) de la base de datos relacional de la
--   plataforma educativa gamificada EduCoins en PostgreSQL 14+.
--
-- ALCANCE (MVP de testeo — 9 tablas, 10 enums, 15 FKs simples):
--   Multi-tenant (organizaciones) · usuarios con 3 roles · clases con
--   código de unión · inscripciones con contadores de monedas por clase
--   · actividades autocontenidas (preguntas en JSONB) · entregas con
--   respuestas en JSONB · catálogo de ítems canjeables · canje
--   instantáneo · libro mayor de auditoría de monedas.
--
-- USO:
--   psql -U <usuario> -d plataforma_educativa -f db/001_schema.sql
--   (todo se ejecuta dentro de una sola transacción BEGIN/COMMIT)
--
-- CONVENCIONES:
--   · Nombres de tablas/columnas en inglés, snake_case, tablas en plural
--   · PK: BIGINT GENERATED ALWAYS AS IDENTITY
--   · Fechas: TIMESTAMPTZ DEFAULT now()
--   · username/email: CITEXT (unicidad insensible a mayúsculas)
--   · Estados y roles: tipos ENUM de PostgreSQL
--   · Contraseñas: solo hash (bcrypt/argon2); nunca texto plano
--
-- VER TAMBIÉN: docs/plataforma_educativa_bd.md (especificación completa)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Extensiones
-- ---------------------------------------------------------------------
-- citext : unicidad de usuario/correo sin distinguir mayúsculas
-- pg_trgm: búsqueda aproximada de clases por nombre (índice GIN)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 2. Tipos ENUM (10)
-- ---------------------------------------------------------------------
CREATE TYPE organization_type AS ENUM ('school', 'university', 'other');
CREATE TYPE user_role         AS ENUM ('admin', 'teacher', 'student');
CREATE TYPE class_status      AS ENUM ('active', 'archived');
CREATE TYPE enrollment_status AS ENUM ('active', 'withdrawn', 'blocked');
CREATE TYPE activity_status   AS ENUM ('draft', 'published', 'deleted');
CREATE TYPE submission_status AS ENUM ('in_progress', 'submitted', 'graded', 'rejected');
CREATE TYPE item_type         AS ENUM ('grade_bonus', 'fun_activity');
CREATE TYPE item_status       AS ENUM ('active', 'inactive', 'deleted');
CREATE TYPE redemption_status AS ENUM ('completed', 'reversed');
CREATE TYPE movement_type     AS ENUM ('earning', 'spending', 'reversal', 'adjustment');

-- ---------------------------------------------------------------------
-- 3. organizations — escuelas/universidades (multi-tenant)
--    Solo las registra el administrador.
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(200) NOT NULL UNIQUE,
    type       organization_type NOT NULL,
    city       VARCHAR(100),
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. users — supertipo de los 3 roles (admin, teacher, student)
--    Regla: solo los admins pueden no tener organización.
--    Las contraseñas llegan ya hasheadas desde la aplicación.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id      BIGINT REFERENCES organizations(id),
    role                 user_role NOT NULL,
    username             CITEXT NOT NULL UNIQUE,
    email                CITEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    first_name           VARCHAR(100) NOT NULL,
    last_name            VARCHAR(150) NOT NULL,
    specialty            VARCHAR(150),          -- opcional, solo teachers
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    last_login           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_users_org CHECK (role = 'admin' OR organization_id IS NOT NULL)
);
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_role         ON users(role);

-- ---------------------------------------------------------------------
-- 5. classes — clases creadas por un profesor, con código de unión
--    Nombre único sin distinguir mayúsculas + búsqueda por trigrama.
-- ---------------------------------------------------------------------
CREATE TABLE classes (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id  BIGINT NOT NULL REFERENCES users(id),
    name        VARCHAR(150) NOT NULL,
    code        VARCHAR(12) NOT NULL UNIQUE
                DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
    status      class_status NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_classes_name      ON classes (lower(name));
CREATE INDEX        idx_classes_name_trgm ON classes USING gin (name gin_trgm_ops);
CREATE INDEX        idx_classes_teacher   ON classes(teacher_id);

-- ---------------------------------------------------------------------
-- 6. enrollments — inscripción estudiante↔clase + contadores de monedas
--    · coins_earned  : histórico ganado en esta clase (base del ranking)
--    · coins_spent   : gastado en canjes
--    · coins_available: columna GENERADA (earned - spent), nunca negativa
--    El saldo se actualiza automáticamente vía trigger apply_movement.
-- ---------------------------------------------------------------------
CREATE TABLE enrollments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id         BIGINT NOT NULL REFERENCES classes(id),
    student_id       BIGINT NOT NULL REFERENCES users(id),
    status           enrollment_status NOT NULL DEFAULT 'active',
    coins_earned     INT NOT NULL DEFAULT 0 CHECK (coins_earned >= 0),
    coins_spent      INT NOT NULL DEFAULT 0 CHECK (coins_spent >= 0),
    coins_available  INT GENERATED ALWAYS AS (coins_earned - coins_spent) STORED,
    enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_enrollment            UNIQUE (class_id, student_id),
    CONSTRAINT ck_enrollment_no_negative CHECK (coins_spent <= coins_earned)
);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);

-- ---------------------------------------------------------------------
-- 7. activities — cuestionarios/retos con recompensa en monedas
--    · questions: JSONB autocontenido
--      [{position, type: test|completion|file|minigame, prompt,
--        score, expected_answer, options: [{text, is_correct}]}]
--    · Borrado lógico: status = 'deleted' + deleted_at
-- ---------------------------------------------------------------------
CREATE TABLE activities (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id       BIGINT NOT NULL REFERENCES classes(id),
    title          VARCHAR(200) NOT NULL,
    description    TEXT,
    reward_coins   INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
    status         activity_status NOT NULL DEFAULT 'draft',
    questions      JSONB NOT NULL DEFAULT '[]'
                   CHECK (jsonb_typeof(questions) = 'array'),
    published_at   TIMESTAMPTZ,
    closes_at      TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT ck_activity_dates CHECK (
        closes_at IS NULL OR published_at IS NULL OR closes_at > published_at
    )
);
CREATE INDEX idx_activities_class_status ON activities(class_id, status);

-- ---------------------------------------------------------------------
-- 8. submissions — una entrega por estudiante y actividad
--    · answers: JSONB autocontenido
--      [{question_position, text, option, files: [{path, mime, bytes}],
--        is_correct, score}]
--    · Coherencia clase↔actividad↔inscripción: trigger validate_submission
--    · Al calificar (status='graded') se otorgan las monedas una sola vez
--      (trigger award_coins + índice único parcial en coin_movements)
-- ---------------------------------------------------------------------
CREATE TABLE submissions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id    BIGINT NOT NULL REFERENCES activities(id),
    enrollment_id  BIGINT NOT NULL REFERENCES enrollments(id),
    status         submission_status NOT NULL DEFAULT 'in_progress',
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at   TIMESTAMPTZ,
    graded_at      TIMESTAMPTZ,
    score          NUMERIC(6,2),
    coins_awarded  INT NOT NULL DEFAULT 0 CHECK (coins_awarded >= 0),
    graded_by      BIGINT REFERENCES users(id),
    feedback       TEXT,
    answers        JSONB NOT NULL DEFAULT '[]'
                   CHECK (jsonb_typeof(answers) = 'array'),
    CONSTRAINT uq_submission UNIQUE (activity_id, enrollment_id)
);
CREATE INDEX idx_submissions_enrollment ON submissions(enrollment_id);

-- ---------------------------------------------------------------------
-- 9. redeemable_items — catálogo de recompensas canjeables por clase
--    · grade_bonus    : exige grade_points (puntos de nota acreditados)
--    · fun_activity   : actividad lúdica, no aporta puntos de nota
--    · stock NULL = ilimitado
--    · El profesor se deduce de la clase (teacher_id); no se duplica.
-- ---------------------------------------------------------------------
CREATE TABLE redeemable_items (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id     BIGINT NOT NULL REFERENCES classes(id),
    name         VARCHAR(150) NOT NULL,
    description  TEXT,
    type         item_type NOT NULL,
    cost_coins   INT NOT NULL CHECK (cost_coins > 0),
    grade_points NUMERIC(4,2) CHECK (grade_points IS NULL OR grade_points > 0),
    stock        INT CHECK (stock IS NULL OR stock >= 0),
    status       item_status NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_item_class_name   UNIQUE (class_id, name),
    CONSTRAINT ck_item_needs_points CHECK (type <> 'grade_bonus' OR grade_points IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 10. redemptions — canje instantáneo (sin flujo de aprobación)
--     · cost_coins/grade_points: copia congelada del ítem al canjear
--     · Trigger execute_redemption : valida stock, lo descuenta y congela
--     · Trigger register_redemption: registra el movimiento de gasto
--     · Trigger reverse_redemption : al pasar a 'reversed' devuelve
--       monedas y stock
-- ---------------------------------------------------------------------
CREATE TABLE redemptions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id  BIGINT NOT NULL REFERENCES enrollments(id),
    item_id        BIGINT NOT NULL REFERENCES redeemable_items(id),
    cost_coins     INT NOT NULL CHECK (cost_coins > 0),
    grade_points   NUMERIC(4,2),
    status         redemption_status NOT NULL DEFAULT 'completed',
    redeemed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_at    TIMESTAMPTZ,
    notes          TEXT
);
CREATE INDEX idx_redemptions_enrollment ON redemptions(enrollment_id);
CREATE INDEX idx_redemptions_item       ON redemptions(item_id);

-- ---------------------------------------------------------------------
-- 11. coin_movements — libro mayor: auditoría de cada moneda
--     · earning  : +quantity, ligado a una submission (1 por entrega)
--     · spending : -quantity, ligado a una redemption  (1 por canje)
--     · reversal : +quantity, devuelve un canje rechazado/revertido
--     · adjustment: corrección manual del administrador/profesor
--     Un trigger (apply_movement) sincroniza los contadores de
--     enrollments con cada movimiento insertado.
-- ---------------------------------------------------------------------
CREATE TABLE coin_movements (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id  BIGINT NOT NULL REFERENCES enrollments(id),
    type           movement_type NOT NULL,
    quantity       INT NOT NULL CHECK (quantity <> 0),
    submission_id  BIGINT REFERENCES submissions(id),
    redemption_id  BIGINT REFERENCES redemptions(id),
    description    VARCHAR(255),
    created_by     BIGINT REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_movement_coherent CHECK (
        (type = 'earning'   AND quantity > 0 AND submission_id IS NOT NULL) OR
        (type = 'spending'  AND quantity < 0 AND redemption_id IS NOT NULL) OR
        (type = 'reversal'  AND quantity > 0 AND redemption_id IS NOT NULL) OR
        (type = 'adjustment')
    )
);
CREATE INDEX idx_movements_enrollment ON coin_movements(enrollment_id, created_at);
CREATE UNIQUE INDEX uq_movement_earning   ON coin_movements(submission_id) WHERE type = 'earning';
CREATE UNIQUE INDEX uq_movement_spending  ON coin_movements(redemption_id) WHERE type = 'spending';
CREATE UNIQUE INDEX uq_movement_reversal  ON coin_movements(redemption_id) WHERE type = 'reversal';

-- ---------------------------------------------------------------------
-- 12. Funciones y triggers
-- ---------------------------------------------------------------------

-- 12.1 updated_at automático (organizaciones, users, classes, activities, items)
CREATE OR REPLACE FUNCTION fn_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['organizations','users','classes','activities','redeemable_items']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t, t);
    END LOOP;
END $$;

-- 12.2 El estudiante y el profesor de la clase deben compartir organización
CREATE OR REPLACE FUNCTION fn_validate_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_student_org BIGINT;
    v_teacher_org BIGINT;
BEGIN
    SELECT organization_id INTO v_student_org
      FROM users WHERE id = NEW.student_id;

    SELECT u.organization_id INTO v_teacher_org
      FROM classes c JOIN users u ON u.id = c.teacher_id
     WHERE c.id = NEW.class_id;

    IF v_student_org IS DISTINCT FROM v_teacher_org THEN
        RAISE EXCEPTION 'student and class teacher belong to different organizations';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_enrollments_validate
BEFORE INSERT ON enrollments
FOR EACH ROW EXECUTE FUNCTION fn_validate_enrollment();

-- 12.3 Solo se entrega una actividad PUBLICADA, vigente, y estando
--      inscrito (activamente) en la MISMA clase
CREATE OR REPLACE FUNCTION fn_validate_submission() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_activity_class BIGINT;
    v_activity_status activity_status;
    v_closes_at      TIMESTAMPTZ;
    v_enrollment     RECORD;
BEGIN
    SELECT class_id, status, closes_at
      INTO v_activity_class, v_activity_status, v_closes_at
      FROM activities WHERE id = NEW.activity_id;

    IF v_activity_status <> 'published'
       OR (v_closes_at IS NOT NULL AND v_closes_at <= now()) THEN
        RAISE EXCEPTION 'the activity is not published or already closed';
    END IF;

    SELECT class_id, status INTO v_enrollment
      FROM enrollments WHERE id = NEW.enrollment_id;

    IF v_enrollment.status <> 'active' THEN
        RAISE EXCEPTION 'the enrollment is not active';
    END IF;

    IF v_enrollment.class_id IS DISTINCT FROM v_activity_class THEN
        RAISE EXCEPTION 'enrollment and activity do not belong to the same class';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_submissions_validate
BEFORE INSERT ON submissions
FOR EACH ROW EXECUTE FUNCTION fn_validate_submission();

-- 12.4 Al calificar la entrega se otorgan las monedas de la actividad
--      (una sola vez: el índice único parcial uq_movement_earning lo garantiza)
CREATE OR REPLACE FUNCTION fn_award_coins() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_reward INT;
BEGIN
    IF NEW.status = 'graded' AND OLD.status <> 'graded' THEN
        SELECT reward_coins INTO v_reward FROM activities WHERE id = NEW.activity_id;
        NEW.coins_awarded := COALESCE(v_reward, 0);
        NEW.graded_at     := COALESCE(NEW.graded_at, now());
        IF COALESCE(v_reward, 0) > 0 THEN
            INSERT INTO coin_movements (enrollment_id, type, quantity, submission_id, description)
            VALUES (NEW.enrollment_id, 'earning', v_reward, NEW.id, 'Activity reward');
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_submissions_award_coins
BEFORE UPDATE OF status ON submissions
FOR EACH ROW EXECUTE FUNCTION fn_award_coins();

-- 12.5 Cada movimiento actualiza los contadores de la inscripción
CREATE OR REPLACE FUNCTION fn_apply_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE enrollments
       SET coins_earned = coins_earned + CASE
               WHEN NEW.type IN ('earning', 'adjustment') THEN NEW.quantity ELSE 0 END,
           coins_spent  = coins_spent + CASE
               WHEN NEW.type IN ('spending', 'reversal') THEN -NEW.quantity ELSE 0 END
     WHERE id = NEW.enrollment_id;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_movements_apply
AFTER INSERT ON coin_movements
FOR EACH ROW EXECUTE FUNCTION fn_apply_movement();

-- 12.6 Canje: valida ítem/stock y congela costo y puntos de nota
CREATE OR REPLACE FUNCTION fn_execute_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_item  RECORD;
    v_class BIGINT;
BEGIN
    SELECT class_id, cost_coins, grade_points, status, stock
      INTO v_item
      FROM redeemable_items WHERE id = NEW.item_id FOR UPDATE;

    SELECT class_id INTO v_class FROM enrollments WHERE id = NEW.enrollment_id;
    IF v_class IS DISTINCT FROM v_item.class_id THEN
        RAISE EXCEPTION 'enrollment and item do not belong to the same class';
    END IF;

    IF v_item.status <> 'active' THEN
        RAISE EXCEPTION 'the item is not available';
    END IF;

    IF v_item.stock IS NOT NULL THEN
        IF v_item.stock <= 0 THEN
            RAISE EXCEPTION 'the item is out of stock';
        END IF;
        UPDATE redeemable_items SET stock = stock - 1 WHERE id = NEW.item_id;
    END IF;

    NEW.cost_coins   := v_item.cost_coins;
    NEW.grade_points := v_item.grade_points;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_redemptions_execute
BEFORE INSERT ON redemptions
FOR EACH ROW EXECUTE FUNCTION fn_execute_redemption();

-- 12.7 Canje registrado: descuenta las monedas (si no alcanzan, falla
--      ck_enrollment_no_negative y toda la operación se revierte)
CREATE OR REPLACE FUNCTION fn_register_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO coin_movements (enrollment_id, type, quantity, redemption_id, description)
    VALUES (NEW.enrollment_id, 'spending', -NEW.cost_coins, NEW.id, 'Item redemption');
    RETURN NEW;
END $$;

CREATE TRIGGER trg_redemptions_register
AFTER INSERT ON redemptions
FOR EACH ROW EXECUTE FUNCTION fn_register_redemption();

-- 12.8 Canje revertido: devuelve monedas y stock
CREATE OR REPLACE FUNCTION fn_reverse_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'reversed' AND OLD.status <> 'reversed' THEN
        NEW.reversed_at := COALESCE(NEW.reversed_at, now());
        INSERT INTO coin_movements (enrollment_id, type, quantity, redemption_id, description)
        VALUES (NEW.enrollment_id, 'reversal', NEW.cost_coins, NEW.id, 'Redemption reversed');
        UPDATE redeemable_items SET stock = stock + 1
         WHERE id = NEW.item_id AND stock IS NOT NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_redemptions_reverse
AFTER UPDATE OF status ON redemptions
FOR EACH ROW EXECUTE FUNCTION fn_reverse_redemption();

-- ---------------------------------------------------------------------
-- 13. Vistas (3) — base de rankings y billetera en tiempo real
-- ---------------------------------------------------------------------

-- 13.1 Totales globales de monedas por estudiante (todas las clases)
CREATE VIEW student_coins AS
SELECT e.student_id,
       SUM(e.coins_earned)     AS total_earned,
       SUM(e.coins_spent)      AS total_spent,
       SUM(e.coins_available)  AS total_available
FROM enrollments e
GROUP BY e.student_id;

-- 13.2 Ranking global: por monedas GANADAS (gastar no baja la posición)
CREATE VIEW global_ranking AS
SELECT RANK() OVER (ORDER BY COALESCE(s.total_earned, 0) DESC) AS position,
       u.id                AS student_id,
       u.first_name,
       u.last_name,
       u.organization_id,
       COALESCE(s.total_earned, 0)    AS coins_earned,
       COALESCE(s.total_available, 0) AS coins_available
FROM users u
LEFT JOIN student_coins s ON s.student_id = u.id
WHERE u.role = 'student' AND u.is_active;

-- 13.3 Ranking por clase (solo inscripciones activas)
CREATE VIEW class_ranking AS
SELECT e.class_id,
       RANK() OVER (PARTITION BY e.class_id ORDER BY e.coins_earned DESC) AS position,
       u.id AS student_id,
       u.first_name,
       u.last_name,
       e.coins_earned,
       e.coins_available
FROM enrollments e
JOIN users u ON u.id = e.student_id
WHERE e.status = 'active';

COMMIT;
