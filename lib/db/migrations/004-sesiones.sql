-- Sesiones de login en Postgres (connect-pg-simple): sobreviven a reinicios de la API.
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/004-sesiones.sql
BEGIN;

CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);

COMMIT;
