-- Datos para transferir (nombre, RUT, banco, cuenta, correo): se muestran en el link del cliente cuando hay saldo
-- por pagar y se agregan al mensaje de cobro por WhatsApp.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/014-datos-transferencia.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE workshop_settings ADD COLUMN IF NOT EXISTS payment_info text;

COMMIT;
