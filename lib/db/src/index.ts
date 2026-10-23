import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Usuario de la app: DATABASE_URL directa, o (en hosting con una sola URL de base) la URL de
// administración con el usuario normal `taller_app` que crea scripts/bootstrap.
function appDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const admin = process.env.DATABASE_URL_ADMIN;
  const password = process.env.APP_DB_PASSWORD;
  if (admin && password) {
    const url = new URL(admin);
    url.username = "taller_app";
    url.password = password;
    return url.toString();
  }
  throw new Error(
    "DATABASE_URL must be set (or DATABASE_URL_ADMIN + APP_DB_PASSWORD). Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: appDatabaseUrl(), max: Number(process.env.DB_POOL_MAX ?? 20) });

type Db = NodePgDatabase<typeof schema>;
const baseDb: Db = drizzle(pool, { schema });

// ── Taller actual (multi-taller con Row Level Security) ──────────────────────
// Cada request de la API corre con su propia conexión, en la que se fija `app.workshop_id`;
// las políticas de la base (migración 008) solo dejan ver y escribir filas de ese taller.
// `db` apunta a la conexión del request en curso, así el código de las rutas no cambia.
// Fuera de un request (scripts) no hay taller: la base no devuelve nada salvo con withBypass.

type TenantStore = { client: pg.PoolClient; db: Db; workshopId: number | null };
const storage = new AsyncLocalStorage<TenantStore>();

export const db: Db = new Proxy(baseDb, {
  get(target, prop) {
    const current = storage.getStore()?.db ?? target;
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

// Corre `fn` con una conexión propia fijada al taller dado (null = ningún taller).
// La conexión se libera cuando la promesa `done` se resuelve (fin del request).
export async function runWithTenantConnection(workshopId: number | null, done: Promise<unknown>, fn: () => void) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("select set_config('app.workshop_id', $1, false), set_config('app.bypass', 'off', false)", [workshopId == null ? "" : String(workshopId)]);
  } catch (e) {
    client.release(true);
    throw e;
  }
  const store: TenantStore = { client, db: drizzle(client, { schema }), workshopId };
  storage.run(store, fn);
  try {
    await done;
  } finally {
    // Limpiar antes de devolver la conexión al pool; si falla, se descarta.
    try {
      await client.query("select set_config('app.workshop_id', '', false), set_config('app.bypass', 'off', false)");
    } catch {
      broken = true;
    }
    client.release(broken);
  }
}

// Cambia el taller de la conexión del request en curso (login, links públicos).
export async function setCurrentWorkshop(workshopId: number | null) {
  const store = storage.getStore();
  if (!store) throw new Error("setCurrentWorkshop fuera de un request");
  await store.client.query("select set_config('app.workshop_id', $1, false)", [workshopId == null ? "" : String(workshopId)]);
  store.workshopId = workshopId;
}

export function currentWorkshopId(): number | null {
  return storage.getStore()?.workshopId ?? null;
}

// Salta el filtro por taller mientras corre `fn`. Solo para buscar a qué taller pertenece algo
// (login, token público) y para el panel de superadmin. Fuera de un request usa una conexión propia.
export async function withBypass<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const store = storage.getStore();
  const client = store?.client ?? (await pool.connect());
  const scopedDb = store?.db ?? drizzle(client, { schema });
  try {
    await client.query("select set_config('app.bypass', 'on', false)");
    return await fn(scopedDb);
  } finally {
    try {
      await client.query("select set_config('app.bypass', 'off', false)");
      if (!store) client.release();
    } catch {
      if (!store) client.release(true);
    }
  }
}

// Advierte si la conexión puede saltarse RLS (superusuario o BYPASSRLS): en ese caso los
// talleres NO quedan aislados.
export async function checkRlsRole(): Promise<{ user: string; bypassesRls: boolean }> {
  const { rows } = await pool.query("select current_user as user, (rolsuper or rolbypassrls) as bypass from pg_roles where rolname = current_user");
  return { user: rows[0]?.user, bypassesRls: !!rows[0]?.bypass };
}

export * from "./schema";
