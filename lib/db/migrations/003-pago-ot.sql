-- Método y monto del pago de la OT (la fecha ya está en paid_at, migración 002).
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/003-pago-ot.sql
BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS payment_method_id integer REFERENCES payment_methods(id),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12, 2);

COMMIT;
