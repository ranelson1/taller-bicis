-- Fotos de la OT con nota y visibilidad para el cliente.
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/007-fotos-ot.sql
BEGIN;

CREATE TABLE IF NOT EXISTS work_order_photos (
  id serial PRIMARY KEY,
  work_order_id integer NOT NULL REFERENCES work_orders(id),
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  note text,
  visible_to_client boolean NOT NULL DEFAULT true,
  uploaded_by_user_id integer REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_order_photos_wo_idx ON work_order_photos (work_order_id) WHERE active;

COMMIT;
