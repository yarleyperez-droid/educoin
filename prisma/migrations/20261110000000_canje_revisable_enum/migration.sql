-- Canje revisable (H7.2 / T7.2.1) — ampliación del enum redemption_status.
--
-- Migración SEPARADA a propósito (docs/propuesta_canje_revisable.md §2.5.1):
-- Prisma envuelve cada migración en una transacción y los valores nuevos de
-- un enum no pueden USARSE en la transacción que los crea (PostgreSQL lanza
-- `unsafe use of new value of enum type`). Por eso aquí SOLO se amplía el
-- tipo; las columnas, CHECKs, índice y el trigger van en la migración
-- siguiente, ya con los valores confirmados.
--
-- El orden importa: 'pending' … 'delivered' entran ANTES de 'completed'
-- para que ORDER BY status refleje la máquina de estados (§2.1).
ALTER TYPE redemption_status ADD VALUE IF NOT EXISTS 'pending'   BEFORE 'completed';
ALTER TYPE redemption_status ADD VALUE IF NOT EXISTS 'approved'  BEFORE 'completed';
ALTER TYPE redemption_status ADD VALUE IF NOT EXISTS 'rejected'  BEFORE 'completed';
ALTER TYPE redemption_status ADD VALUE IF NOT EXISTS 'delivered' BEFORE 'completed';
