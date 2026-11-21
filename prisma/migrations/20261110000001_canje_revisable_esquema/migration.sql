-- Canje revisable (H7.2 / T7.2.1) — esquema del flujo de resolución.
-- Contrato aprobado: docs/propuesta_canje_revisable.md §2 (DDL) y §5.
-- Los valores del enum (pending/approved/rejected/delivered) ya fueron
-- confirmados por la migración anterior (ver §2.5.1).

-- ---------------------------------------------------------------------
-- §2.2 Columnas de resolución y coherencia
--   · resolved_by: profesor que resuelve (FK a users); que sea el profesor
--     de la clase es regla de la aplicación (docs/guard_pertenencia.md).
--   · resolved_at: instante de la resolución (TIMESTAMPTZ).
--   · Compatibilidad: 'completed'/'reversed' (legados del MVP) no pertenecen
--     al conjunto auditado y sus resolved_* son NULL → las filas existentes
--     satisfacen ambos CHECK (§4.3).
-- ---------------------------------------------------------------------
ALTER TABLE redemptions
  ADD COLUMN resolved_by BIGINT REFERENCES users(id),
  ADD COLUMN resolved_at TIMESTAMPTZ;

-- Un canje resuelto DEBE traer auditoría completa…
ALTER TABLE redemptions
  ADD CONSTRAINT ck_redemption_resolved_audit
  CHECK ( status NOT IN ('approved','rejected','delivered')
          OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL) );

-- …y un pendiente NO debe tener auditoría de resolución.
ALTER TABLE redemptions
  ADD CONSTRAINT ck_redemption_pending_clean
  CHECK ( status <> 'pending'
          OR (resolved_by IS NULL AND resolved_at IS NULL) );

-- ---------------------------------------------------------------------
-- §2.3 Índice parcial de la cola de pendientes del profesor (H7.2/H7.4),
-- mismo patrón que uq_movement_* (§11 del esquema).
-- ---------------------------------------------------------------------
CREATE INDEX idx_redemptions_pending
  ON redemptions (redeemed_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- §2.4 Trigger de reversión al rechazar (monedas + stock, misma transacción).
-- Decisión: EXTENDER fn_reverse_redemption (una sola fuente de reversión)
-- conservando intacto el camino heredado 'reversed' del MVP.
-- El trigger sigue siendo trg_redemptions_reverse (AFTER UPDATE OF status).
-- Nota de implementación (§2.4, hallazgo spec 025): el trigger es AFTER
-- UPDATE, donde asignar a NEW no persiste → la APP escribe resolved_by/
-- resolved_at (en un solo UPDATE) y el trigger solo toca monedas y stock.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_reverse_redemption() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Camino heredado del MVP (anulación del estudiante): SIN CAMBIOS
    IF NEW.status = 'reversed' AND OLD.status <> 'reversed' THEN
        NEW.reversed_at := COALESCE(NEW.reversed_at, now());
        INSERT INTO coin_movements (enrollment_id, type, quantity, redemption_id, description)
        VALUES (NEW.enrollment_id, 'reversal', NEW.cost_coins, NEW.id, 'Redemption reversed');
        UPDATE redeemable_items SET stock = stock + 1
         WHERE id = NEW.item_id AND stock IS NOT NULL;

    -- Camino nuevo: SOLO pending → rejected
    --   · OLD.status = 'pending' es el guard de transición (nunca dos veces)
    --   · uq_movement_reversal (único parcial) aborta ante un segundo intento
    ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
        INSERT INTO coin_movements (enrollment_id, type, quantity, redemption_id, description)
        VALUES (NEW.enrollment_id, 'reversal', NEW.cost_coins, NEW.id, 'Redemption rejected');
        UPDATE redeemable_items SET stock = stock + 1
         WHERE id = NEW.item_id AND stock IS NOT NULL;
    END IF;
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- §2.6 Configuración de aprobación automática por ítem (decisión PO):
--   · FALSE (default): el canje queda 'pending' y espera al profesor.
--   · TRUE: la API, en la misma transacción de la solicitud, ejecuta
--     pending → approved (resolved_by = profesor de la clase).
-- 'delivered' nunca es automático (§2.6).
-- ---------------------------------------------------------------------
ALTER TABLE redeemable_items
  ADD COLUMN auto_approve BOOLEAN NOT NULL DEFAULT FALSE;
