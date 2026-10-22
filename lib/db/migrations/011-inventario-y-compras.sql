-- Inventario (repuestos e insumos con costo, stock y punto de recompra), proveedores, compras
-- (facturas/boletas con su archivo), movimientos de stock y recetas de insumos por servicio.
-- Todo por taller, con Row Level Security como el resto (ver 008).
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/011-inventario-y-compras.sql
BEGIN;

-- 1. Artículos: la tabla de repuestos pasa a ser el inventario --------------
ALTER TABLE parts
  -- part = se cobra al cliente (pastillas, cadena); supply = insumo del taller (lubricante, grasa).
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'part',
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'un',
  -- Costo promedio ponderado de lo que hay en stock (según "recupera IVA": neto o con IVA).
  ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS stock numeric(12, 3) NOT NULL DEFAULT 0,
  -- Punto de recompra: bajo este stock aparece en "Por comprar".
  ADD COLUMN IF NOT EXISTS min_stock numeric(12, 3);
DO $$ BEGIN
  ALTER TABLE parts ADD CONSTRAINT parts_kind_check CHECK (kind IN ('part', 'supply'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE workshop_settings
  -- Con inicio de actividades el IVA de las compras se recupera: costos y márgenes van netos.
  ADD COLUMN IF NOT EXISTS recovers_vat boolean NOT NULL DEFAULT false;

-- 2. Tablas nuevas ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  name text NOT NULL,
  rut text,
  phone text,
  email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  supplier_id integer REFERENCES suppliers(id),
  doc_type text NOT NULL DEFAULT 'factura',      -- factura | boleta | guia | otro
  doc_number text,
  issued_on date,
  net_total numeric(12, 2),
  tax_total numeric(12, 2),
  total numeric(12, 2),
  status text NOT NULL DEFAULT 'draft',          -- draft | confirmed | cancelled
  source text NOT NULL DEFAULT 'manual',         -- manual | xml | pdf | image
  file_key text,
  file_mime text,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  confirmed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  purchase_id integer NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  part_id integer REFERENCES parts(id),           -- null = se crea un artículo al confirmar
  description text NOT NULL,                      -- como viene en el documento
  supplier_code text,
  quantity numeric(12, 3) NOT NULL DEFAULT 1,
  unit text,
  unit_cost_net numeric(12, 2) NOT NULL DEFAULT 0,
  -- Repuesto comprado para un trabajo: entra y sale del stock al confirmar y se cobra en esa OT.
  work_order_id integer REFERENCES work_orders(id),
  -- Precio al cliente: PVP del distribuidor o costo + margen. Se guarda en el artículo.
  sale_price numeric(12, 2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  part_id integer NOT NULL REFERENCES parts(id),
  kind text NOT NULL,                             -- purchase | consumption | return | adjustment
  quantity numeric(12, 3) NOT NULL,               -- + entra, − sale
  unit_cost numeric(12, 2),
  work_order_id integer REFERENCES work_orders(id),
  purchase_id integer REFERENCES purchases(id),
  -- Consumo automático al terminar la OT (se revierte si vuelve a reparación).
  automatic boolean NOT NULL DEFAULT false,
  note text,
  user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_supplies (
  id serial PRIMARY KEY,
  workshop_id integer NOT NULL REFERENCES workshops(id) DEFAULT current_workshop_id(),
  service_id integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  part_id integer NOT NULL REFERENCES parts(id),
  quantity numeric(12, 3) NOT NULL,
  UNIQUE (service_id, part_id)
);

-- 3. OT: qué artículo es cada ítem, a qué costo, y si ya se descontó del stock --
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS part_id integer REFERENCES parts(id),
  ADD COLUMN IF NOT EXISTS service_id integer REFERENCES services(id),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS stock_consumed boolean NOT NULL DEFAULT false;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS stock_consumed_at timestamp;

-- Los ítems que vienen de un repuesto del catálogo quedan enlazados a él.
SELECT set_config('app.bypass', 'on', true);
UPDATE work_order_items woi SET part_id = qi.part_id
FROM quote_items qi WHERE woi.quote_item_id = qi.id AND qi.part_id IS NOT NULL AND woi.part_id IS NULL;
UPDATE work_order_items woi SET service_id = qi.service_id
FROM quote_items qi WHERE woi.quote_item_id = qi.id AND qi.service_id IS NOT NULL AND woi.service_id IS NULL;

-- 4. Aislamiento por taller e índices --------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers', 'purchases', 'purchase_items', 'inventory_movements', 'service_supplies'] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (workshop_id)', t || '_workshop_idx', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR workshop_id = current_workshop_id()) '
      'WITH CHECK (app_bypass() OR workshop_id = current_workshop_id())', t);
  END LOOP;
END $$;
-- Ítem de la OT que originó el movimiento (para devolver solo lo consumido automáticamente).
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS work_order_item_id integer REFERENCES work_order_items(id);
CREATE INDEX IF NOT EXISTS inventory_movements_part_idx ON inventory_movements (part_id);
CREATE INDEX IF NOT EXISTS inventory_movements_wo_idx ON inventory_movements (work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON purchase_items (purchase_id);

-- 5. Permisos del usuario de la app ---------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taller_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers, purchases, purchase_items, inventory_movements, service_supplies TO taller_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
  END IF;
END $$;

COMMIT;
