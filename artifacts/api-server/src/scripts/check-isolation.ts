// Prueba de aislamiento entre talleres contra la API corriendo (por defecto http://localhost:8080).
// Entra como admin de dos talleres y verifica que ninguno vea, edite ni borre datos del otro.
//
// Uso: ISOLATION_A="email:clave" ISOLATION_B="email:clave" pnpm --filter @workspace/api-server run check-isolation
import { eq } from "drizzle-orm";
import { pool, withBypass, usersTable, clientsTable } from "@workspace/db";

const API = process.env.API_URL ?? "http://localhost:8080";

class Session {
  cookie = "";
  constructor(readonly label: string) {}
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* binario */ }
    return { status: res.status, json };
  }
}

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};

async function login(label: string, creds: string | undefined) {
  if (!creds?.includes(":")) throw new Error(`Define ${label} como "email:clave"`);
  const [email, ...rest] = creds.split(":");
  const s = new Session(label);
  const r = await s.call("POST", "/api/auth/login", { email, password: rest.join(":") });
  if (r.status !== 200) throw new Error(`No pude entrar como ${email} (${r.status})`);
  return { s, workshopId: r.json.workshopId as number, name: r.json.workshopName as string };
}

// Listados que deben contener solo filas del propio taller.
const LISTS = [
  "/api/work-orders", "/api/work-cases", "/api/clients", "/api/bicycles", "/api/services", "/api/parts",
  "/api/categories", "/api/payment-methods", "/api/users", "/api/quotes", "/api/receptions",
];
// Recursos individuales del otro taller que deben dar 404.
const DETAIL = ["/api/work-orders", "/api/work-cases", "/api/clients", "/api/bicycles", "/api/services", "/api/quotes", "/api/receptions"];

async function main() {
  const A = await login("ISOLATION_A", process.env.ISOLATION_A);
  const B = await login("ISOLATION_B", process.env.ISOLATION_B);
  console.log(`A = ${A.name} (#${A.workshopId}) · B = ${B.name} (#${B.workshopId})`);
  if (A.workshopId === B.workshopId) throw new Error("A y B son del mismo taller");

  // Ids de cada taller según la base (saltando RLS), para comparar con lo que devuelve la API.
  const ids: Record<number, Record<string, number[]>> = { [A.workshopId]: {}, [B.workshopId]: {} };

  console.log("\n1. Cada taller ve solo lo suyo");
  for (const path of LISTS) {
    const [ra, rb] = [await A.s.call("GET", path), await B.s.call("GET", path)];
    const listA: any[] = Array.isArray(ra.json) ? ra.json : ra.json?.items ?? [];
    const listB: any[] = Array.isArray(rb.json) ? rb.json : rb.json?.items ?? [];
    const idsA = new Set(listA.map(x => x.id)), idsB = new Set(listB.map(x => x.id));
    const overlap = [...idsA].filter(id => idsB.has(id));
    ids[A.workshopId][path] = [...idsA]; ids[B.workshopId][path] = [...idsB];
    ok(ra.status === 200 && rb.status === 200 && overlap.length === 0,
      `${path}: A ${idsA.size}, B ${idsB.size}, en común ${overlap.length}`);
  }
  const clientsInDb = await withBypass(async (db) => ({
    a: (await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.workshopId, A.workshopId))).length,
    b: (await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.workshopId, B.workshopId))).length,
  }));
  ok(ids[A.workshopId]["/api/clients"].length <= clientsInDb.a && ids[B.workshopId]["/api/clients"].length <= clientsInDb.b,
    `clientes: la API no devuelve más que los de cada taller en la base (A ${clientsInDb.a}, B ${clientsInDb.b})`);

  console.log("\n2. Recursos del otro taller por id: no se ven, no se editan, no se borran");
  for (const path of DETAIL) {
    const foreign = ids[A.workshopId][path]?.[0];
    if (!foreign) { ok(false, `${path}: A no tiene datos para probar`); continue; }
    const r = await B.s.call("GET", `${path}/${foreign}`);
    ok(r.status === 404 || (r.status === 200 && (r.json == null || (Array.isArray(r.json) && r.json.length === 0))),
      `B → GET ${path}/${foreign} (de A): ${r.status}`);
  }
  const clientA = ids[A.workshopId]["/api/clients"][0];
  const before = await withBypass((db) => db.select().from(clientsTable).where(eq(clientsTable.id, clientA)));
  const patch = await B.s.call("PATCH", `/api/clients/${clientA}`, { name: "HACKEADO" });
  const del = await B.s.call("DELETE", `/api/clients/${clientA}`);
  const after = await withBypass((db) => db.select().from(clientsTable).where(eq(clientsTable.id, clientA)));
  ok(after[0]?.name === before[0]?.name && after[0]?.active === before[0]?.active,
    `B → PATCH/DELETE cliente ${clientA} de A: ${patch.status}/${del.status}, el cliente sigue intacto`);
  const woA = ids[A.workshopId]["/api/work-orders"][0];
  const photos = await B.s.call("GET", `/api/work-orders/${woA}/photos`);
  ok(photos.status === 200 && Array.isArray(photos.json) && photos.json.length === 0, `B → fotos de la OT ${woA} de A: ninguna`);
  const status = await B.s.call("POST", `/api/work-orders/${woA}/status`, { status: "cancelled" });
  ok(status.status === 404, `B → cambiar estado de la OT ${woA} de A: ${status.status}`);

  console.log("\n3. Lo que crea un taller no aparece en el otro");
  const created = await B.s.call("POST", "/api/clients", { name: "Cliente prueba aislamiento" });
  ok(created.status === 201 || created.status === 200, `B crea un cliente: ${created.status}`);
  const seenByA = (await A.s.call("GET", "/api/clients")).json?.some((c: any) => c.id === created.json?.id);
  ok(!seenByA, "A no ve el cliente nuevo de B");
  const owner = await withBypass((db) => db.select({ w: clientsTable.workshopId }).from(clientsTable).where(eq(clientsTable.id, created.json?.id)));
  ok(owner[0]?.w === B.workshopId, `el cliente nuevo quedó en el taller de B (#${owner[0]?.w})`);
  await B.s.call("DELETE", `/api/clients/${created.json?.id}`);

  console.log("\n4. Usuarios: B no ve ni puede editar usuarios de A");
  const userA = await withBypass(async (db) => (await db.select().from(usersTable).where(eq(usersTable.workshopId, A.workshopId)))[0]);
  const editUser = await B.s.call("PATCH", `/api/users/${userA.id}`, { name: "HACKEADO" });
  const userAfter = await withBypass(async (db) => (await db.select().from(usersTable).where(eq(usersTable.id, userA.id)))[0]);
  ok(userAfter.name === userA.name, `B → PATCH usuario ${userA.id} de A: ${editUser.status}, sin cambios`);

  console.log(failures === 0 ? "\nTodo bien: los talleres están aislados." : `\n${failures} prueba(s) fallaron.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => pool.end());
