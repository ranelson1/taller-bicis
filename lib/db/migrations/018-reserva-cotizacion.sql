-- La reserva también es la cotización previa: servicios y cobros acordados por WhatsApp antes de que llegue la bici.
-- Al llegar el cliente, Nuevo trabajo parte con esos ítems.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/018-reserva-cotizacion.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS quote_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
