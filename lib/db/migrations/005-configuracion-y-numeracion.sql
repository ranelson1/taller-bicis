-- 1. Datos del taller editables desde la app (antes solo variables de entorno).
-- 2. Numeración TR/P/R/OT con secuencias: no se repite aunque se creen trabajos a la vez.
-- Idempotente: se puede ejecutar más de una vez.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/005-configuracion-y-numeracion.sql
BEGIN;

CREATE TABLE IF NOT EXISTS workshop_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name text,
  phone text,
  address text,
  workdays text NOT NULL DEFAULT '1,2,3,4,5',
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Cada secuencia parte del mayor número ya usado (TR-0047 → la próxima es 48).
CREATE SEQUENCE IF NOT EXISTS work_case_number_seq;
CREATE SEQUENCE IF NOT EXISTS quote_number_seq;
CREATE SEQUENCE IF NOT EXISTS reception_number_seq;
CREATE SEQUENCE IF NOT EXISTS work_order_number_seq;

SELECT setval('work_case_number_seq', GREATEST(
  (SELECT last_value FROM work_case_number_seq),
  COALESCE((SELECT max(substring(work_case_number FROM '[0-9]+$')::int) FROM work_cases), 0), 1));
SELECT setval('quote_number_seq', GREATEST(
  (SELECT last_value FROM quote_number_seq),
  COALESCE((SELECT max(substring(quote_number FROM '[0-9]+$')::int) FROM quotes), 0), 1));
SELECT setval('reception_number_seq', GREATEST(
  (SELECT last_value FROM reception_number_seq),
  COALESCE((SELECT max(substring(reception_number FROM '[0-9]+$')::int) FROM receptions), 0), 1));
SELECT setval('work_order_number_seq', GREATEST(
  (SELECT last_value FROM work_order_number_seq),
  COALESCE((SELECT max(substring(work_order_number FROM '[0-9]+$')::int) FROM work_orders), 0), 1));

COMMIT;
