-- Quién hace trabajos (se le asignan OT y cuenta para la capacidad), independiente del rol:
-- en un taller de una persona el mismo administrador repara las bicis.
-- Idempotente. Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/migrations/009-hace-trabajos.sql
BEGIN;
SELECT set_config('app.bypass', 'on', true);

ALTER TABLE users ADD COLUMN IF NOT EXISTS does_jobs boolean NOT NULL DEFAULT false;

-- Los mecánicos hacen trabajos.
UPDATE users SET does_jobs = true WHERE role = 'mechanic' AND NOT does_jobs;

-- En talleres sin mecánicos, el administrador es quien repara.
UPDATE users u SET does_jobs = true
WHERE u.role = 'admin' AND u.workshop_id IS NOT NULL AND NOT u.does_jobs
  AND NOT EXISTS (SELECT 1 FROM users m WHERE m.workshop_id = u.workshop_id AND m.role = 'mechanic' AND m.active);

COMMIT;
