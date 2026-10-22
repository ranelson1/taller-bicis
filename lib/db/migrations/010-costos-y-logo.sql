-- Costos del taller (para calcular márgenes) y logo.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/010-costos-y-logo.sql
BEGIN;

ALTER TABLE workshop_settings
  -- Costo de una hora de trabajo = (gastos fijos + sueldo) / horas que se repara al mes.
  ADD COLUMN IF NOT EXISTS monthly_fixed_costs numeric(12, 2),
  ADD COLUMN IF NOT EXISTS monthly_salary numeric(12, 2),
  ADD COLUMN IF NOT EXISTS monthly_work_hours numeric(6, 1),
  ADD COLUMN IF NOT EXISTS labor_cost_per_hour numeric(12, 2),
  -- Margen por defecto sobre el costo de repuestos comprados para un trabajo (30 = 30 %).
  ADD COLUMN IF NOT EXISTS default_parts_margin_pct numeric(5, 1) NOT NULL DEFAULT 30,
  -- Logo del taller (clave en el almacenamiento de archivos).
  ADD COLUMN IF NOT EXISTS logo_key text;

COMMIT;
