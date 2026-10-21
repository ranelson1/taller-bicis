-- OT única con link público para el cliente.
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/001-ot-publica.sql
BEGIN;

DO $$ BEGIN
  CREATE TYPE work_order_item_approval AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS public_token text;
DO $$ BEGIN
  ALTER TABLE work_orders ADD CONSTRAINT work_orders_public_token_unique UNIQUE (public_token);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS approval_status work_order_item_approval NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS approval_decided_at timestamp,
  ADD COLUMN IF NOT EXISTS approval_decided_by text;

-- Una sola OT activa por presupuesto (evita duplicados por doble clic).
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_active_quote_unique
  ON work_orders (quote_id) WHERE active AND quote_id IS NOT NULL;

ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT false;

-- Los adicionales ya existentes heredan la aprobación de su ítem de presupuesto.
UPDATE work_order_items woi
SET approval_status = qi.approval_status::text::work_order_item_approval,
    origin = CASE WHEN qi.origin = 'during_work' THEN 'additional' ELSE 'initial' END
FROM quote_items qi
WHERE woi.quote_item_id = qi.id AND woi.approval_decided_at IS NULL
  AND qi.approval_status::text IN ('pending', 'approved', 'rejected');

COMMIT;
