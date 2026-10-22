-- Fecha de pago de la OT (distinta del término y de la entrega).
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/002-fechas-ot.sql
BEGIN;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS paid_at timestamp;

COMMIT;
