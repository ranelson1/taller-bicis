// Carga el catálogo de un taller (servicios con sus pasos y repuestos con precio) desde un JSON, usando la API como el admin.
// Es idempotente: lo que ya existe (por nombre) no se duplica.
//
// Uso (API corriendo):
//   CATALOG_ADMIN="admin@taller.cl:<clave>" pnpm --filter @workspace/api-server run load-catalogo seed/catalogo-ridemec.json
import fs from "node:fs";
export {};

const API = process.env.API_URL ?? "http://localhost:8080";
const file = process.argv[2];
const creds = process.env.CATALOG_ADMIN;
if (!file || !creds?.includes(":")) {
  console.error('Uso: CATALOG_ADMIN="email:clave" load-catalogo <archivo.json>');
  process.exit(1);
}

type Catalog = {
  categories?: string[];
  services?: { name: string; category?: string; price: number; hours?: number; steps?: string[] }[];
  parts?: { name: string; price: number; sku?: string; brand?: string }[];
};
const catalog: Catalog = JSON.parse(fs.readFileSync(file, "utf8"));

let cookie = "";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* sin cuerpo */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.error ?? text.slice(0, 200)}`);
  return json;
}

const [email, ...rest] = creds.split(":");
await call("POST", "/api/auth/login", { email, password: rest.join(":") });

const categories: any[] = await call("GET", "/api/categories");
const categoryId = async (name?: string) => {
  if (!name) return null;
  const found = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id as number;
  const created = await call("POST", "/api/categories", { name });
  categories.push(created);
  return created.id as number;
};
for (const name of catalog.categories ?? []) await categoryId(name);

const existingServices: any[] = await call("GET", "/api/services");
let newServices = 0;
for (const s of catalog.services ?? []) {
  if (existingServices.some(e => e.name.toLowerCase() === s.name.toLowerCase())) continue;
  const created = await call("POST", "/api/services", { name: s.name, categoryId: await categoryId(s.category), basePrice: s.price, estimatedHours: s.hours ?? null });
  for (const description of s.steps ?? []) await call("POST", "/api/service-steps", { serviceId: created.id, description });
  newServices++;
}

const existingParts: any[] = await call("GET", "/api/parts");
let newParts = 0;
for (const p of catalog.parts ?? []) {
  if (existingParts.some(e => e.name.toLowerCase() === p.name.toLowerCase())) continue;
  await call("POST", "/api/parts", { name: p.name, kind: "part", suggestedPrice: p.price, sku: p.sku ?? null, brand: p.brand ?? null });
  newParts++;
}
console.log(`Catálogo cargado: ${newServices} servicio(s) y ${newParts} repuesto(s) nuevos.`);
