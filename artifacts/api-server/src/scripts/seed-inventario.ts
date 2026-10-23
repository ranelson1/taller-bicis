// Completa un taller de demo con costos, inventario, compras y recetas, usando la API como lo haría el admin.
// Es idempotente: se puede correr de nuevo sin duplicar compras ni artículos.
//
// Uso (API corriendo):
//   DEMO_ADMIN="ana.perez@example.com:<clave>" pnpm --filter @workspace/api-server run seed-inventario
export {};
const API = process.env.API_URL ?? "http://localhost:8080";

let cookie = "";
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
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

const creds = process.env.DEMO_ADMIN;
if (!creds?.includes(":")) {
  console.error('Define DEMO_ADMIN="email:clave" (admin del taller de demo).');
  process.exit(1);
}
const [email, ...rest] = creds.split(":");
await call("POST", "/api/auth/login", { email, password: rest.join(":") });

const dayAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const round10 = (n: number) => Math.round(n / 10) * 10;

// 1. Costo de la hora y margen sobre repuestos.
await call("PUT", "/api/settings/costs", { monthlyFixedCosts: 650000, monthlySalary: 1200000, monthlyWorkHours: 140, defaultPartsMarginPct: 35, recoversVat: false });
console.log("Costos del taller configurados (hora ≈ $13.200).");

// 2. Insumos del taller (no se cobran aparte; se gastan con las recetas).
const SUPPLIES = [
  { name: "Grasa multiuso", unit: "g", costPrice: 17, minStock: 150 },
  { name: "Desengrasante biodegradable", unit: "ml", costPrice: 4, minStock: 1500 },
  { name: "Limpia discos", unit: "ml", costPrice: 7, minStock: 600 },
  { name: "Paños de taller", unit: "un", costPrice: 540, minStock: 10 },
];
let inventory: any[] = await call("GET", "/api/inventory");
for (const s of SUPPLIES) {
  if (inventory.some(i => i.name === s.name)) continue;
  await call("POST", "/api/parts", { name: s.name, kind: "supply", unit: s.unit, costPrice: s.costPrice, minStock: s.minStock });
}
inventory = await call("GET", "/api/inventory");
const byName = (name: string) => {
  const found = inventory.find(i => i.name === name);
  if (!found) throw new Error(`No existe el artículo "${name}"`);
  return found;
};

// 3. Costo y punto de recompra de los repuestos del catálogo (costo ≈ 60 % del precio al público).
const MIN_STOCK: Record<string, number> = {
  "Cadena Shimano SLX M7100 12v": 3, "Cadena Shimano Deore M6100 12v": 3, "Cadena SRAM GX Eagle 12v": 2,
  "Cassette SRAM NX Eagle": 2, "Pastillas Shimano N03A": 3, "Pastillas Shimano B05S": 4, "Pastillas SRAM Code": 2,
  "Líquido DOT 5.1 120 ml": 4, "Disco SRAM Centerline 200 mm": 1, "Kit retenes horquilla 38 mm": 1, "Kit retenes horquilla 36 mm": 2,
  "Sellante tubeless 140 ml": 4, "Cinta tubeless 25 mm": 3, "Radio DT Swiss Competition": 12, "Cable cambio inoxidable": 6,
};
for (const p of inventory.filter(i => i.kind === "part" && i.costPrice == null && i.salePrice)) {
  await call("PATCH", `/api/parts/${p.id}`, { costPrice: round10(p.salePrice * 0.6), minStock: MIN_STOCK[p.name] ?? 2 });
}
inventory = await call("GET", "/api/inventory");
console.log("Costos y puntos de recompra cargados.");

// 4. Compras (facturas) con fechas pasadas: dejan el stock y el costo promedio.
type Line = [name: string, qty: number];
const PURCHASES: { supplierName: string; supplierRut: string; docNumber: string; ago: number; lines: Line[]; supplyCosts?: Record<string, number> }[] = [
  {
    supplierName: "Distribuidora Bike Parts SpA", supplierRut: "76.318.442-5", docNumber: "48102", ago: 38,
    lines: [
      ["Cadena Shimano Deore M6100 12v", 5], ["Cadena Shimano SLX M7100 12v", 2], ["Cadena SRAM GX Eagle 12v", 2],
      ["Cassette Shimano Deore 12v", 2], ["Cassette SRAM NX Eagle", 1], ["Pastillas Shimano B05S", 8], ["Pastillas Shimano N03A", 1],
      ["Pastillas SRAM Code", 3], ["Disco Shimano RT66 180 mm", 3], ["Cable cambio inoxidable", 12], ["Funda cambio 1 metro", 10],
      ["Cable mando dropper", 3], ["Piñón single speed 16T", 3], ["Radio DT Swiss Competition", 24], ["Rodamiento dirección 41 mm", 2],
      ["Rodamiento pivote 6802", 6], ["Válvula tubeless presta", 8], ["Cinta tubeless 25 mm", 6], ["Sellante tubeless 140 ml", 8],
    ],
  },
  {
    supplierName: "Suspensión Pro Chile SpA", supplierRut: "77.204.915-K", docNumber: "7731", ago: 20,
    lines: [
      ["Kit retenes horquilla 36 mm", 3], ["Aceite suspensión 5wt 250 ml", 4], ["Aceite suspensión 20wt 250 ml", 3],
      ["Grasa suspensión 30 g", 4], ["Espumas lubricación horquilla", 4], ["Kit juntas cámara aire shock", 3],
      ["Aceite mineral para freno 100 ml", 4], ["Líquido DOT 5.1 120 ml", 2],
    ],
  },
  {
    supplierName: "Lubricantes y Químicos Sur Ltda", supplierRut: "76.552.008-3", docNumber: "20933", ago: 6,
    lines: [["Grasa multiuso", 500], ["Desengrasante biodegradable", 5000], ["Limpia discos", 2000], ["Paños de taller", 40], ["Lubricante cadena (prueba)", 500]],
  },
];

const existing: any[] = await call("GET", "/api/purchases");
for (const p of PURCHASES) {
  if (existing.some(e => e.docNumber === p.docNumber && e.supplierName === p.supplierName)) { console.log(`Compra ${p.docNumber} ya estaba.`); continue; }
  const items = p.lines.map(([name, qty]) => {
    const it = byName(name);
    // Costo neto unitario: lo que tiene el artículo, sin IVA (el sistema le suma el IVA si el taller no lo recupera).
    const withVat = it.costPrice ?? 0;
    return { partId: it.id, description: name, quantity: qty, unit: it.unit, unitCostNet: Math.round((withVat / 1.19) * 100) / 100 };
  });
  const net = items.reduce((s, i) => s + i.unitCostNet * i.quantity, 0);
  const created = await call("POST", "/api/purchases", {
    supplierName: p.supplierName, supplierRut: p.supplierRut, docType: "factura", docNumber: p.docNumber, issuedOn: dayAgo(p.ago),
    netTotal: Math.round(net), taxTotal: Math.round(net * 0.19), total: Math.round(net * 1.19), items,
  });
  await call("POST", `/api/purchases/${created.id}/confirm`);
  console.log(`Compra ${p.docNumber} (${p.supplierName}) confirmada: ${items.length} líneas.`);
}

// 5. Recetas: qué insumos gasta cada servicio.
inventory = await call("GET", "/api/inventory");
const services: any[] = await call("GET", "/api/services");
const svc = (name: string) => services.find(s => s.name === name)?.id as number | undefined;
const RECIPES: Record<string, [string, number][]> = {
  "Mantención general": [["Grasa multiuso", 20], ["Desengrasante biodegradable", 150], ["Lubricante cadena (prueba)", 30], ["Paños de taller", 2]],
  "Mantención full bicicleta": [["Grasa multiuso", 50], ["Desengrasante biodegradable", 300], ["Lubricante cadena (prueba)", 40], ["Limpia discos", 50], ["Paños de taller", 4]],
  "Ajuste de transmisión": [["Lubricante cadena (prueba)", 10], ["Paños de taller", 1]],
  "Instalación de cadena": [["Lubricante cadena (prueba)", 20], ["Desengrasante biodegradable", 40], ["Paños de taller", 1]],
  "Instalación pastillas de freno": [["Limpia discos", 30], ["Paños de taller", 1]],
  "Sangrado freno individual": [["Limpia discos", 30], ["Paños de taller", 1]],
  "Sangrado frenos pareja": [["Limpia discos", 60], ["Paños de taller", 2]],
  "Montaje tubeless por rueda": [["Paños de taller", 1], ["Desengrasante biodegradable", 30]],
  "Servicio horquilla full": [["Grasa multiuso", 10], ["Desengrasante biodegradable", 50], ["Paños de taller", 2]],
  "Servicio shock completo": [["Grasa multiuso", 10], ["Desengrasante biodegradable", 50], ["Paños de taller", 2]],
};
for (const [service, list] of Object.entries(RECIPES)) {
  const id = svc(service);
  if (!id) continue;
  await call("PUT", `/api/services/${id}/supplies`, { supplies: list.map(([name, quantity]) => ({ partId: byName(name).id, quantity })) });
}
console.log("Recetas de insumos cargadas.");

const toBuy = inventory.filter(i => i.needsReorder);
console.log(`Listo. Artículos: ${inventory.length}. Por comprar: ${toBuy.length} (${toBuy.map(i => i.name).slice(0, 5).join(", ")}…).`);
