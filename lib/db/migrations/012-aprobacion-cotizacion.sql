-- Aprobación opcional de la cotización: el cliente puede aprobarla desde su link (o el taller registrarla)
-- y queda la fecha y quién fue. No bloquea el trabajo: es solo un registro.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/012-aprobacion-cotizacion.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS quote_approved_at timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS quote_approved_by text; -- client | staff

COMMIT;
