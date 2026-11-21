-- Monedas proporcionales al puntaje.
-- Antes: fn_award_coins otorgaba activities.reward_coins completo al pasar
-- a 'graded', sin mirar submissions.score. Ahora reward_coins es el MÁXIMO
-- y se paga en proporción al puntaje obtenido sobre el total de la actividad.

-- Puntaje total de una actividad = suma de questions[].score.
-- IMMUTABLE para poder usarse dentro del trigger.
CREATE OR REPLACE FUNCTION fn_activity_total_points(p_questions JSONB)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(SUM((pregunta->>'score')::numeric), 0)
    FROM jsonb_array_elements(p_questions) AS pregunta
$$;

CREATE OR REPLACE FUNCTION fn_award_coins() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_reward INT;
    v_total  NUMERIC;
    v_coins  INT;
BEGIN
    IF NEW.status = 'graded' AND OLD.status <> 'graded' THEN
        SELECT reward_coins, fn_activity_total_points(questions)
          INTO v_reward, v_total
          FROM activities WHERE id = NEW.activity_id;

        v_reward := COALESCE(v_reward, 0);

        IF NEW.score IS NOT NULL AND COALESCE(v_total, 0) > 0 THEN
            v_coins := ROUND(v_reward * NEW.score / v_total)::int;
        ELSE
            -- Sin puntaje o sin total: se conserva el contrato anterior.
            v_coins := v_reward;
        END IF;

        -- Red de seguridad: nunca negativo ni por encima del máximo.
        v_coins := GREATEST(0, LEAST(v_coins, v_reward));

        NEW.coins_awarded := v_coins;
        NEW.graded_at     := COALESCE(NEW.graded_at, now());
        IF v_coins > 0 THEN
            INSERT INTO coin_movements (enrollment_id, type, quantity, submission_id, description)
            VALUES (NEW.enrollment_id, 'earning', v_coins, NEW.id, 'Activity reward');
        END IF;
    END IF;
    RETURN NEW;
END $$;
