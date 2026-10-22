-- Horario del taller por día y colación (se descuenta de la capacidad para estimar el término).
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/006-horario-taller.sql
BEGIN;

ALTER TABLE workshop_settings
  ADD COLUMN IF NOT EXISTS schedule jsonb,
  ADD COLUMN IF NOT EXISTS lunch_start text,
  ADD COLUMN IF NOT EXISTS lunch_end text;

COMMIT;
