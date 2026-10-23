-- Historial de mantención de la bicicleta, compartible por link (sin login): el dueño lo muestra al vender
-- o al llevar la bici a otro taller. El token es secreto; se puede dejar de compartir en cualquier momento.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/017-historial-bici.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE bicycles ADD COLUMN IF NOT EXISTS history_token text;
CREATE UNIQUE INDEX IF NOT EXISTS bicycles_history_token_unique ON bicycles (history_token) WHERE history_token IS NOT NULL;

COMMIT;
