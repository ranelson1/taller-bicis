-- Ficha de ajustes de la bicicleta (presión, rebote y compresión de horquilla y shock, apertura de palancas…):
-- se guarda en la bici, el cliente la ve al retirar y queda como punto de partida del siguiente servicio.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/015-ajustes-bici.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE bicycles ADD COLUMN IF NOT EXISTS setup_notes text;
ALTER TABLE bicycles ADD COLUMN IF NOT EXISTS setup_updated_at timestamp;

COMMIT;
