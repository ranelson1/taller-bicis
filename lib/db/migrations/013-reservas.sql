-- Reservas: un espacio apartado en el taller para una bici que va a llegar (acordado por WhatsApp), sin consumir
-- número de OT. Cuando llega el cliente se convierte en un trabajo normal (Nuevo trabajo) y la reserva queda enlazada.
-- Cuentan en la carga del taller para dar fechas de ingreso y entrega realistas desde la cotización.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/013-reservas.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

CREATE TABLE IF NOT EXISTS reservations (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  client_id integer REFERENCES clients(id),
  client_name text NOT NULL,
  client_phone text,
  bicycle_text text,                 -- "Trek Marlin 7 azul" (todavía no es una bici registrada)
  note text,                         -- lo acordado con el cliente
  service_id integer REFERENCES services(id),
  estimated_hours numeric(6, 2),
  expected_on date NOT NULL,         -- día en que llega la bici
  expected_time text,                -- "10:30" (opcional)
  status text NOT NULL DEFAULT 'reserved',   -- reserved | arrived | cancelled | no_show
  work_case_id integer,
  work_order_id integer,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE reservations ADD CONSTRAINT reservations_status_check CHECK (status IN ('reserved', 'arrived', 'cancelled', 'no_show'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS reservations_workshop_idx ON reservations (workshop_id);
CREATE INDEX IF NOT EXISTS reservations_open_idx ON reservations (expected_on) WHERE status = 'reserved';

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reservations;
CREATE POLICY tenant_isolation ON reservations USING (app_bypass() OR workshop_id = current_workshop_id())
  WITH CHECK (app_bypass() OR workshop_id = current_workshop_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taller_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON reservations TO taller_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
  END IF;
END $$;

COMMIT;
