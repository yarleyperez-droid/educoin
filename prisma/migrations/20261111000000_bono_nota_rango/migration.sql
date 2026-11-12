-- Bonos de nota acotados al rango 0.1–0.5 décimas (H10.1 / T10.1.1).
-- Antes: grade_points solo exigía > 0 (CHECK inline sin nombre, que
-- PostgreSQL nombró `redeemable_items_grade_points_check`), así que un
-- artículo podía otorgar hasta 99.99 décimas. Ahora cada artículo de
-- tipo grade_bonus equivale a entre 0.1 y 0.5 décimas de nota.
--
-- El CHECK sigue admitiendo NULL (lo usan los fun_activity) y actúa
-- como red de seguridad ante escrituras fuera de la API (CA 4 de H10.1);
-- la validación amable (422) vive en el service (evaluarItemPorTipo).

ALTER TABLE "redeemable_items" DROP CONSTRAINT IF EXISTS "redeemable_items_grade_points_check";

ALTER TABLE "redeemable_items"
    ADD CONSTRAINT "ck_item_grade_points_rango"
    CHECK ("grade_points" IS NULL OR ("grade_points" >= 0.1 AND "grade_points" <= 0.5));
