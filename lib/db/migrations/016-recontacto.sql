-- Recontacto de clientes: cada cuántos meses conviene volver a hacer un servicio (ej.: suspensión cada 6 meses)
-- y "ya le escribí" para no insistir. Con eso Inicio muestra a quién escribirle por WhatsApp.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/016-recontacto.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

-- NULL = usar el valor sugerido según el nombre del servicio; 0 = no recordar nunca este servicio.
ALTER TABLE services ADD COLUMN IF NOT EXISTS followup_months integer;
DO $$ BEGIN
  ALTER TABLE services ADD CONSTRAINT services_followup_months_check CHECK (followup_months IS NULL OR followup_months BETWEEN 0 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS followup_snoozes (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  client_id integer NOT NULL REFERENCES clients(id),
  until_on date NOT NULL,               -- no volver a sugerirlo hasta esta fecha
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
CREATE INDEX IF NOT EXISTS followup_snoozes_workshop_idx ON followup_snoozes (workshop_id);

ALTER TABLE followup_snoozes ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_snoozes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON followup_snoozes;
CREATE POLICY tenant_isolation ON followup_snoozes USING (app_bypass() OR workshop_id = current_workshop_id())
  WITH CHECK (app_bypass() OR workshop_id = current_workshop_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taller_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON followup_snoozes TO taller_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
  END IF;
END $$;

COMMIT;
