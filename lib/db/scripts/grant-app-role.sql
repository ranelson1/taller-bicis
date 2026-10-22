-- Crea (si no existe) el usuario con el que se conecta la API y le da acceso a los datos.
-- Es un usuario NORMAL a propósito: Row Level Security no aplica a superusuarios ni a roles con
-- BYPASSRLS, y sin RLS los talleres no quedan aislados.
--
-- Uso (como dueño de la base):
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -v app_password='una-clave-larga' -f lib/db/scripts/grant-app-role.sql
-- Después la API usa: DATABASE_URL=postgresql://taller_app:<esa clave>@<host>:<puerto>/<base>

SELECT format('CREATE ROLE taller_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taller_app') \gexec

GRANT USAGE ON SCHEMA public TO taller_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taller_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
GRANT EXECUTE ON FUNCTION current_workshop_id(), app_bypass() TO taller_app;
-- Tablas y secuencias que creen migraciones futuras.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taller_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taller_app;
