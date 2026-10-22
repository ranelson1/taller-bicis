-- Varios talleres en una misma app. Cada fila pertenece a un taller (workshop_id) y
-- Row Level Security hace que cada conexión vea y escriba solo las filas de su taller.
--
-- Cómo funciona:
--   * La API fija por conexión `app.workshop_id` (taller del usuario logueado).
--   * Las políticas solo dejan ver/escribir filas de ese taller; sin taller fijado no se ve nada.
--   * `app.bypass = on` salta el filtro: solo para login, links públicos y el panel de superadmin.
--   * workshop_id tiene default = taller actual, así los INSERT existentes no cambian.
--
-- IMPORTANTE: RLS no aplica a superusuarios ni a roles con BYPASSRLS. La API debe conectarse con un
-- rol normal (ver README, "Usuario de base de datos de la app").
--
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/008-multi-taller.sql
BEGIN;

-- 1. Talleres ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshops (
  id serial PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Los datos que ya existen pasan a ser del taller 1.
INSERT INTO workshops (id, name)
SELECT 1, COALESCE((SELECT name FROM workshop_settings LIMIT 1), 'Mi Taller')
WHERE NOT EXISTS (SELECT 1 FROM workshops WHERE id = 1);
SELECT setval('workshops_id_seq', GREATEST((SELECT max(id) FROM workshops), 1));

CREATE OR REPLACE FUNCTION current_workshop_id() RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.workshop_id', true), '')::integer $$;
CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.bypass', true), '') = 'on' $$;

-- 2. Configuración: una fila por taller (antes una sola fila con id = 1) -----
ALTER TABLE workshop_settings ADD COLUMN IF NOT EXISTS workshop_id integer REFERENCES workshops(id);
UPDATE workshop_settings SET workshop_id = 1 WHERE workshop_id IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workshop_settings' AND column_name = 'id') THEN
    ALTER TABLE workshop_settings DROP CONSTRAINT IF EXISTS workshop_settings_pkey;
    ALTER TABLE workshop_settings DROP COLUMN id;
    ALTER TABLE workshop_settings ADD PRIMARY KEY (workshop_id);
  END IF;
END $$;

-- 3. workshop_id en todas las tablas del taller + política ------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'clients', 'bicycles', 'categories', 'services', 'service_steps', 'parts', 'payment_methods',
    'work_cases', 'quotes', 'quote_items', 'quote_versions', 'receptions', 'inspection_findings',
    'work_orders', 'work_order_items', 'work_order_checklist_items', 'work_order_photos',
    'timeline_events', 'workshop_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS workshop_id integer REFERENCES workshops(id)', t);
    EXECUTE format('UPDATE %I SET workshop_id = 1 WHERE workshop_id IS NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN workshop_id SET DEFAULT current_workshop_id()', t);
    -- users admite workshop_id NULL: el superadmin no pertenece a ningún taller.
    IF t <> 'users' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN workshop_id SET NOT NULL', t);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (workshop_id)', t || '_workshop_idx', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR workshop_id = current_workshop_id()) '
      'WITH CHECK (app_bypass() OR workshop_id = current_workshop_id())', t);
  END LOOP;
END $$;

-- 4. Numeración por taller (cada taller parte en OT-0001) --------------------
ALTER TABLE work_cases DROP CONSTRAINT IF EXISTS work_cases_work_case_number_unique;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_quote_number_unique;
ALTER TABLE receptions DROP CONSTRAINT IF EXISTS receptions_reception_number_unique;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_work_order_number_unique;
CREATE UNIQUE INDEX IF NOT EXISTS work_cases_number_per_workshop ON work_cases (workshop_id, work_case_number);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_number_per_workshop ON quotes (workshop_id, quote_number);
CREATE UNIQUE INDEX IF NOT EXISTS receptions_number_per_workshop ON receptions (workshop_id, reception_number);
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_number_per_workshop ON work_orders (workshop_id, work_order_number);

CREATE TABLE IF NOT EXISTS document_counters (
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  kind text NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workshop_id, kind)
);
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_counters;
CREATE POLICY tenant_isolation ON document_counters
  USING (app_bypass() OR workshop_id = current_workshop_id())
  WITH CHECK (app_bypass() OR workshop_id = current_workshop_id());

-- Los contadores parten del mayor número usado en cada taller.
INSERT INTO document_counters (workshop_id, kind, last_value)
SELECT workshop_id, kind, max(n) FROM (
  SELECT workshop_id, 'TR' AS kind, substring(work_case_number FROM '[0-9]+$')::int AS n FROM work_cases
  UNION ALL SELECT workshop_id, 'P', substring(quote_number FROM '[0-9]+$')::int FROM quotes
  UNION ALL SELECT workshop_id, 'R', substring(reception_number FROM '[0-9]+$')::int FROM receptions
  UNION ALL SELECT workshop_id, 'OT', substring(work_order_number FROM '[0-9]+$')::int FROM work_orders
) x GROUP BY workshop_id, kind
ON CONFLICT (workshop_id, kind) DO UPDATE SET last_value = GREATEST(document_counters.last_value, EXCLUDED.last_value);

DROP SEQUENCE IF EXISTS work_case_number_seq, quote_number_seq, reception_number_seq, work_order_number_seq;

-- La tabla de talleres también: cada taller solo se ve a sí mismo (el superadmin usa bypass).
ALTER TABLE workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workshops;
CREATE POLICY tenant_isolation ON workshops
  USING (app_bypass() OR id = current_workshop_id())
  WITH CHECK (app_bypass() OR id = current_workshop_id());

-- 5. Superadmin de la plataforma ---------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';

-- 6. Permisos para el usuario de la app (si existe) --------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taller_app') THEN
    GRANT USAGE ON SCHEMA public TO taller_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taller_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
    GRANT EXECUTE ON FUNCTION current_workshop_id(), app_bypass() TO taller_app;
  END IF;
END $$;

COMMIT;
