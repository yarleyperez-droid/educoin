-- =====================================================================
-- EduCoins · 002_seed.sql
-- ---------------------------------------------------------------------
-- DOCSTRING / PROPÓSITO:
--   Carga el conjunto mínimo de datos de prueba para recorrer todo el
--   ciclo del MVP: admin → organización → profesor → estudiantes →
--   clase → inscripciones → actividad publicada con preguntas →
--   ítems canjeables.
--
-- USO (después de 001_schema.sql):
--   psql -U <usuario> -d plataforma_educativa -f db/002_seed.sql
--
-- NOTAS:
--   · Los password_hash son marcadores de posición ('HASH_*').
--     La aplicación real debe generar hashes bcrypt/argon2.
--   · Todas las semillas respetan los triggers: los estudiantes y el
--     profesor pertenecen a la misma organización que la clase.
--   · Después de ejecutar este archivo, aplicar las pruebas de la
--     sección §7 de docs/plataforma_educativa_bd.md.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Administrador global (sin organización, permitido por ck_users_org)
-- ---------------------------------------------------------------------
INSERT INTO users (role, username, email, password_hash, first_name, last_name)
VALUES ('admin', 'admin', 'admin@educoins.test', 'HASH_ADMIN', 'Ada', 'Admin');

-- ---------------------------------------------------------------------
-- 2. Organización (multi-tenant)
-- ---------------------------------------------------------------------
INSERT INTO organizations (name, type, city)
VALUES ('Colegio Demo', 'school', 'Buga');

-- ---------------------------------------------------------------------
-- 3. Profesor de la organización
-- ---------------------------------------------------------------------
INSERT INTO users (organization_id, role, username, email, password_hash,
                   first_name, last_name, specialty, must_change_password)
SELECT o.id, 'teacher', 'prof.lopez', 'lopez@educoins.test', 'HASH_PROF',
       'Ana', 'López', 'Mathematics', TRUE
FROM organizations o
WHERE o.name = 'Colegio Demo';

-- ---------------------------------------------------------------------
-- 4. Estudiantes de la organización
-- ---------------------------------------------------------------------
INSERT INTO users (organization_id, role, username, email, password_hash,
                   first_name, last_name, must_change_password)
SELECT o.id, 'student', x.username, x.email, 'HASH_EST',
       x.first_name, x.last_name, TRUE
FROM organizations o
CROSS JOIN (VALUES ('est.perez',  'perez@educoins.test',  'Juan',   'Pérez'),
                   ('est.gomez',  'gomez@educoins.test',  'María',  'Gómez')) AS x(username, email, first_name, last_name)
WHERE o.name = 'Colegio Demo';

-- ---------------------------------------------------------------------
-- 5. Clase (el código se autogenera con el DEFAULT de classes.code)
-- ---------------------------------------------------------------------
INSERT INTO classes (teacher_id, name)
SELECT u.id, 'Mathematics 10A'
FROM users u WHERE u.username = 'prof.lopez';

-- ---------------------------------------------------------------------
-- 6. Inscripciones (trigger fn_validate_enrollment verifica organización)
-- ---------------------------------------------------------------------
INSERT INTO enrollments (class_id, student_id)
SELECT c.id, u.id
FROM classes c
CROSS JOIN users u
WHERE c.name = 'Mathematics 10A'
  AND u.role = 'student'
  AND u.is_active;

-- ---------------------------------------------------------------------
-- 7. Actividad PUBLICADA con preguntas embebidas (JSONB)
--    · type 'test': auto-calificable por options[].is_correct
--    · Recompensa: 120 monedas al calificar la entrega
-- ---------------------------------------------------------------------
INSERT INTO activities (class_id, title, description, reward_coins,
                        status, published_at, questions)
SELECT c.id,
       'Challenge 1: Equations',
       'Solve the following linear equation',
       120,
       'published',
       now(),
       '[
         {
           "position": 1,
           "type": "test",
           "prompt": "What is x in 2x + 4 = 10?",
           "score": 5,
           "options": [
             {"text": "2", "is_correct": false},
             {"text": "3", "is_correct": true},
             {"text": "4", "is_correct": false}
           ]
         },
         {
           "position": 2,
           "type": "completion",
           "prompt": "Complete: the solution of x + 1 = 5 is x = ___",
           "score": 5,
           "expected_answer": "4"
         }
       ]'::jsonb
FROM classes c
WHERE c.name = 'Mathematics 10A';

-- ---------------------------------------------------------------------
-- 8. Ítems canjeables
--    · grade_bonus  : exige grade_points (0.50 por 100 monedas)
--    · fun_activity : solo cuesta monedas, con stock limitado
-- ---------------------------------------------------------------------
INSERT INTO redeemable_items (class_id, name, description, type,
                              cost_coins, grade_points, stock)
SELECT c.id,
       '+0.5 on the midterm',
       'Redeem 100 coins for 0.50 grade points',
       'grade_bonus',
       100,
       0.50,
       NULL
FROM classes c WHERE c.name = 'Mathematics 10A';

INSERT INTO redeemable_items (class_id, name, description, type,
                              cost_coins, grade_points, stock)
SELECT c.id,
       'Trivia game in class',
       'Fun minigame session during class',
       'fun_activity',
       50,
       NULL,
       5
FROM classes c WHERE c.name = 'Mathematics 10A';

COMMIT;
