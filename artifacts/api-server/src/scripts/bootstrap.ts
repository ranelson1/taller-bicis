// Prepara la base de datos antes de arrancar la API (corre en cada despliegue, es idempotente):
//   1. Base nueva: crea el esquema completo (lib/db/schema.sql).
//   2. Base existente: aplica las migraciones pendientes (lib/db/migrations/*.sql, en orden).
//   3. Crea/actualiza el usuario normal `taller_app` con el que se conecta la API (respeta Row Level Security).
//   4. Crea el superadmin si hay SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD y todavía no existe ninguno.
// Variables: DATABASE_URL_ADMIN (dueño de la base), APP_DB_PASSWORD, DB_SQL_DIR (por defecto ./db).
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

const adminUrl = process.env.DATABASE_URL_ADMIN;
const appPassword = process.env.APP_DB_PASSWORD;
const sqlDir = path.resolve(process.env.DB_SQL_DIR ?? "db");

if (!adminUrl || !appPassword) {
  console.error("Define DATABASE_URL_ADMIN y APP_DB_PASSWORD.");
  process.exit(1);
}
if (appPassword.length < 16) {
  console.error("APP_DB_PASSWORD debe tener al menos 16 caracteres.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
const log = (m: string) => console.log(`[bootstrap] ${m}`);

try {
  const migrations = fs.readdirSync(path.join(sqlDir, "migrations")).filter(f => f.endsWith(".sql")).sort();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

  const { rows: [{ fresh }] } = await pool.query<{ fresh: boolean }>("SELECT to_regclass('public.workshops') IS NULL AS fresh");
  if (fresh) {
    log("Base nueva: creando el esquema…");
    await pool.query(fs.readFileSync(path.join(sqlDir, "schema.sql"), "utf8"));
    // pg_dump deja search_path vacío en la sesión; se restaura para el resto del arranque.
    await pool.query("SELECT pg_catalog.set_config('search_path', 'public', false)");
    // El esquema ya incluye todas las migraciones existentes.
    for (const name of migrations) await pool.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
  } else {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map(r => r.name));
    for (const name of migrations.filter(m => !applied.has(m))) {
      log(`Aplicando migración ${name}…`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(fs.readFileSync(path.join(sqlDir, "migrations", name), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  }

  // Usuario de la API: normal a propósito (sin superusuario ni BYPASSRLS).
  const { rows: [{ literal }] } = await pool.query<{ literal: string }>("SELECT format('%L', $1::text) AS literal", [appPassword]);
  const { rows: roles } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'taller_app'");
  await pool.query(roles.length
    ? `ALTER ROLE taller_app LOGIN PASSWORD ${literal} NOSUPERUSER NOBYPASSRLS`
    : `CREATE ROLE taller_app LOGIN PASSWORD ${literal} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await pool.query(`
    GRANT USAGE ON SCHEMA public TO taller_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taller_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taller_app;
    GRANT EXECUTE ON FUNCTION current_workshop_id(), app_bypass() TO taller_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taller_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO taller_app;
  `);
  log("Usuario taller_app listo.");

  // Superadmin: solo si falta (la contraseña se cambia con el script create-superadmin).
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (email && password) {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.bypass', 'on', false)");
      const { rows } = await client.query("SELECT 1 FROM users WHERE role = 'superadmin' LIMIT 1");
      if (rows.length === 0) {
        if (password.length < 10) throw new Error("SUPERADMIN_PASSWORD debe tener al menos 10 caracteres.");
        const hash = await bcrypt.hash(password, 10);
        await client.query(
          "INSERT INTO users (workshop_id, name, email, password_hash, role) VALUES (NULL, $1, $2, $3, 'superadmin')",
          [process.env.SUPERADMIN_NAME?.trim() || "Administrador plataforma", email, hash],
        );
        log(`Superadmin ${email} creado.`);
      }
    } finally {
      client.release();
    }
  }
  log("Listo.");
} catch (e) {
  console.error("[bootstrap] Falló:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
