// Recetas de insumos realistas para el taller de demo: cuánto aceite, líquido de frenos y grasa gasta cada servicio.
// Corre después de seed-inventario (usa su costo de la hora, proveedores y artículos). Idempotente.
//
// Uso (API corriendo):
//   DEMO_ADMIN="ana.perez@example.com:<clave>" pnpm --filter @workspace/api-server run seed-recetas
//
// Cantidades de referencia (verifica siempre con el manual del modelo y año):
//  · Fox 34/36/38 (tabla oficial de volúmenes): baño del lado aire 10 cc (36) o 20 cc (38) de aceite 20wt Gold + 3 cc en la
//    cámara de aire; lado amortiguador GRIP/GRIP2 40 cc de 5wt con teflón.
//  · Amortiguador trasero Fox (DPX2/Float X): 1–2 cc de 20wt Gold en cada cámara de aire.
//  · Frenos: ≈ 50 ml de aceite mineral (Shimano/Magura) o ≈ 40 ml de DOT 5.1 (SRAM/Hayes) por freno, contando el purgado.
//  · RockShox (Pike/Lyrik 35 mm y ZEB 38 mm) y el aceite del amortiguador: valores aproximados de taller.
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

// 1. El lubricante de cadena deja de llamarse "(prueba)".
let inventory: any[] = await call("GET", "/api/inventory");
const oldLube = inventory.find(i => i.name === "Lubricante cadena (prueba)");
if (oldLube) await call("PATCH", `/api/parts/${oldLube.id}`, { name: "Lubricante cadena" });

// 2. Insumos a granel (costo por ml o g, con IVA). Se compran en botellas y se gastan en pocos ml por servicio.
const SUPPLIES = [
  { name: "Aceite mineral freno (granel)", unit: "ml", costPrice: 40, minStock: 300 },
  { name: "Líquido DOT 5.1 (granel)", unit: "ml", costPrice: 14, minStock: 300 },
  { name: "Aceite Fox 20wt Gold", unit: "ml", costPrice: 80, minStock: 120 },
  { name: "Aceite Fox 5wt (Grip)", unit: "ml", costPrice: 85, minStock: 150 },
  { name: "Aceite RockShox 15wt (lowers)", unit: "ml", costPrice: 70, minStock: 150 },
  { name: "Aceite amortiguador RockShox", unit: "ml", costPrice: 90, minStock: 100 },
  { name: "Grasa sellos suspensión", unit: "g", costPrice: 130, minStock: 20 },
  { name: "Sellante tubeless (granel)", unit: "ml", costPrice: 28, minStock: 500 },
];
inventory = await call("GET", "/api/inventory");
for (const s of SUPPLIES) {
  if (inventory.some(i => i.name === s.name)) continue;
  await call("POST", "/api/parts", { name: s.name, kind: "supply", unit: s.unit, costPrice: s.costPrice, minStock: s.minStock });
}
inventory = await call("GET", "/api/inventory");
const part = (name: string) => {
  const found = inventory.find(i => i.name === name);
  if (!found) throw new Error(`No existe el artículo "${name}"`);
  return found;
};

// 3. Compra de esos insumos (botellas y tubos), con fecha reciente.
const existingPurchases: any[] = await call("GET", "/api/purchases");
if (!existingPurchases.some(p => p.docNumber === "31877")) {
  const lines: [string, number][] = [
    ["Aceite mineral freno (granel)", 1000], ["Líquido DOT 5.1 (granel)", 1000], ["Aceite Fox 20wt Gold", 473], ["Aceite Fox 5wt (Grip)", 473],
    ["Aceite RockShox 15wt (lowers)", 473], ["Aceite amortiguador RockShox", 237], ["Grasa sellos suspensión", 120], ["Sellante tubeless (granel)", 2000],
  ];
  const items = lines.map(([name, qty]) => {
    const it = part(name);
    return { partId: it.id, description: name, quantity: qty, unit: it.unit, unitCostNet: Math.round(((it.costPrice ?? 0) / 1.19) * 100) / 100 };
  });
  const net = items.reduce((s, i) => s + i.unitCostNet * i.quantity, 0);
  const created = await call("POST", "/api/purchases", {
    supplierName: "Lubricantes y Químicos Sur Ltda", supplierRut: "76.552.008-3", docType: "factura", docNumber: "31877", issuedOn: dayAgo(3),
    netTotal: Math.round(net), taxTotal: Math.round(net * 0.19), total: Math.round(net * 1.19), items,
  });
  await call("POST", `/api/purchases/${created.id}/confirm`);
  console.log("Compra 31877 (aceites, líquidos y grasas) confirmada.");
}

// 4. Servicios: renombrar los que dependen de la marca y agregar los que faltaban (dirección, pivotes, bujes, motor…).
const services: any[] = await call("GET", "/api/services");
const byService = (name: string) => services.find(s => s.name === name);
const cat = (name: string) => services.find(s => s.categoryName === name)?.categoryId as number | undefined;

const RENAMES: Record<string, string> = {
  "Sangrado freno individual": "Sangrado freno individual (aceite mineral)",
  "Sangrado frenos pareja": "Sangrado frenos pareja (aceite mineral)",
  "Servicio horquilla full": "Servicio horquilla full Fox 36",
  "Servicio horquilla lower legs": "Servicio lower legs otras marcas",
};
for (const [from, to] of Object.entries(RENAMES)) {
  const s = byService(from);
  if (s) await call("PATCH", `/api/services/${s.id}`, { name: to });
}

type NewService = { name: string; category: string; price: number; hours: number; steps: string[] };
const NEW_SERVICES: NewService[] = [
  { name: "Sangrado freno individual DOT", category: "Frenos", price: 26000, hours: 0.75, steps: ["Retirar pastillas y proteger el disco", "Purgar con líquido DOT 5.1 hasta que salga sin burbujas", "Limpiar con limpia discos y montar pastillas", "Probar la palanca"] },
  { name: "Sangrado frenos pareja DOT", category: "Frenos", price: 45000, hours: 1.5, steps: ["Retirar pastillas de ambos frenos", "Purgar freno delantero con DOT 5.1", "Purgar freno trasero con DOT 5.1", "Limpiar discos y montar pastillas", "Probar ambas palancas"] },
  { name: "Servicio lower legs Fox 38", category: "Suspensión", price: 58000, hours: 1.75, steps: ["Retirar las botellas", "Cambiar sellos y espumas", "Rellenar baños: 20wt lado aire y 5wt lado amortiguador", "Montar y revisar recorrido"] },
  { name: "Servicio lower legs RockShox 35 mm", category: "Suspensión", price: 52000, hours: 1.5, steps: ["Retirar las botellas", "Cambiar sellos y espumas", "Rellenar los baños con aceite 15wt", "Montar y revisar recorrido"] },
  { name: "Servicio horquilla full RockShox", category: "Suspensión", price: 118000, hours: 3.5, steps: ["Desarmar la horquilla", "Servicio de lower legs", "Servicio de amortiguador y resorte de aire", "Armar, purgar y ajustar presión"] },
  { name: "Servicio de dirección (headset)", category: "Mantención general", price: 18000, hours: 0.75, steps: ["Desmontar horquilla y rodamientos", "Limpiar copas y rodamientos", "Engrasar y montar", "Ajustar la precarga"] },
  { name: "Servicio de pivotes de cuadro", category: "Mantención general", price: 38000, hours: 2, steps: ["Desmontar amortiguador y bieletas", "Extraer rodamientos de cada pivote", "Limpiar, engrasar y montar", "Torquear según fabricante"] },
  { name: "Servicio de pedalier (caja)", category: "Mantención general", price: 20000, hours: 0.75, steps: ["Retirar bielas", "Extraer y limpiar la caja", "Engrasar roscas y montar", "Torquear"] },
  { name: "Servicio de bujes (por rueda)", category: "Ruedas", price: 22000, hours: 1, steps: ["Desmontar eje y rueda libre", "Limpiar y revisar rodamientos", "Engrasar y armar", "Revisar juego"] },
  { name: "Revisión y lubricación motor e-bike", category: "Mantención general", price: 30000, hours: 1, steps: ["Retirar cubierta del motor", "Revisar holguras y conectores", "Limpiar y lubricar el eje y la rueda libre", "Prueba de asistencia"] },
];
for (const n of NEW_SERVICES) {
  if (byService(n.name)) continue;
  const created = await call("POST", "/api/services", { name: n.name, categoryId: cat(n.category) ?? null, basePrice: n.price, estimatedHours: n.hours });
  for (const description of n.steps) await call("POST", "/api/service-steps", { serviceId: created.id, description });
}
const all: any[] = await call("GET", "/api/services");
const svcId = (name: string) => {
  const s = all.find(x => x.name === name);
  if (!s) throw new Error(`No existe el servicio "${name}"`);
  return s.id as number;
};

// 5. Recetas (por servicio, en ml o g; PUT reemplaza lo anterior).
const RECIPES: Record<string, [string, number][]> = {
  // Mantención: grasa en dirección (10 g), pedalier (8), bujes (20), pedales (6), tija y pernos (10), otros (6).
  "Mantención general": [["Grasa multiuso", 25], ["Desengrasante biodegradable", 150], ["Lubricante cadena", 30], ["Limpia discos", 10], ["Paños de taller", 2]],
  "Mantención full bicicleta": [["Grasa multiuso", 60], ["Desengrasante biodegradable", 300], ["Lubricante cadena", 40], ["Limpia discos", 40], ["Paños de taller", 4]],
  "Ajuste de transmisión": [["Lubricante cadena", 10], ["Paños de taller", 1]],
  "Instalación de cadena": [["Lubricante cadena", 20], ["Desengrasante biodegradable", 40], ["Paños de taller", 1]],
  "Servicio de dirección (headset)": [["Grasa multiuso", 10], ["Desengrasante biodegradable", 20], ["Paños de taller", 1]],
  "Servicio de pivotes de cuadro": [["Grasa multiuso", 16], ["Desengrasante biodegradable", 40], ["Paños de taller", 2]],
  "Servicio de pedalier (caja)": [["Grasa multiuso", 8], ["Desengrasante biodegradable", 20], ["Paños de taller", 1]],
  "Servicio de bujes (por rueda)": [["Grasa multiuso", 12], ["Desengrasante biodegradable", 40], ["Paños de taller", 1]],
  "Revisión y lubricación motor e-bike": [["Grasa multiuso", 5], ["Desengrasante biodegradable", 20], ["Paños de taller", 1]],
  // Frenos: aceite mineral (Shimano/Magura) ≈ 50 ml por freno; DOT 5.1 (SRAM/Hayes) ≈ 40 ml por freno.
  "Instalación pastillas de freno": [["Limpia discos", 20], ["Paños de taller", 1]],
  "Sangrado freno individual (aceite mineral)": [["Aceite mineral freno (granel)", 50], ["Limpia discos", 20], ["Paños de taller", 1]],
  "Sangrado frenos pareja (aceite mineral)": [["Aceite mineral freno (granel)", 100], ["Limpia discos", 40], ["Paños de taller", 2]],
  "Sangrado freno individual DOT": [["Líquido DOT 5.1 (granel)", 40], ["Limpia discos", 20], ["Paños de taller", 1]],
  "Sangrado frenos pareja DOT": [["Líquido DOT 5.1 (granel)", 80], ["Limpia discos", 40], ["Paños de taller", 2]],
  // Fox 36 con GRIP2: 10 + 3 cc de 20wt (lado aire) y 40 cc de 5wt (lado amortiguador). El full suma el servicio del amortiguador.
  "Servicio horquilla full Fox 36": [["Aceite Fox 20wt Gold", 13], ["Aceite Fox 5wt (Grip)", 100], ["Grasa sellos suspensión", 6], ["Desengrasante biodegradable", 50], ["Paños de taller", 3]],
  "Servicio lower legs otras marcas": [["Aceite Fox 20wt Gold", 25], ["Grasa sellos suspensión", 4], ["Desengrasante biodegradable", 30], ["Paños de taller", 2]],
  // Fox 38: 20 + 3 cc de 20wt y 40 cc de 5wt.
  "Servicio lower legs Fox 38": [["Aceite Fox 20wt Gold", 23], ["Aceite Fox 5wt (Grip)", 40], ["Grasa sellos suspensión", 5], ["Desengrasante biodegradable", 30], ["Paños de taller", 2]],
  // RockShox 35 mm: aprox. 30 ml de 15wt por pata.
  "Servicio lower legs RockShox 35 mm": [["Aceite RockShox 15wt (lowers)", 60], ["Grasa sellos suspensión", 5], ["Desengrasante biodegradable", 30], ["Paños de taller", 2]],
  "Servicio horquilla full RockShox": [["Aceite RockShox 15wt (lowers)", 60], ["Aceite amortiguador RockShox", 90], ["Grasa sellos suspensión", 8], ["Desengrasante biodegradable", 50], ["Paños de taller", 3]],
  // Amortiguador trasero Fox: 1–2 cc de 20wt Gold por cámara de aire.
  "Servicio shock air can": [["Aceite Fox 20wt Gold", 3], ["Grasa sellos suspensión", 3], ["Paños de taller", 1]],
  "Servicio shock completo": [["Aceite Fox 20wt Gold", 3], ["Aceite Fox 5wt (Grip)", 15], ["Grasa sellos suspensión", 3], ["Desengrasante biodegradable", 40], ["Paños de taller", 2]],
  "Servicio dropper básico": [["Grasa sellos suspensión", 3], ["Desengrasante biodegradable", 20], ["Paños de taller", 1]],
  "Sangrado dropper hidráulico": [["Aceite mineral freno (granel)", 30], ["Limpia discos", 10], ["Paños de taller", 1]],
  "Montaje tubeless por rueda": [["Sellante tubeless (granel)", 60], ["Desengrasante biodegradable", 20], ["Paños de taller", 1]],
};
for (const [service, list] of Object.entries(RECIPES)) {
  await call("PUT", `/api/services/${svcId(service)}/supplies`, { supplies: list.map(([name, quantity]) => ({ partId: part(name).id, quantity })) });
}
console.log(`Listo. ${Object.keys(RECIPES).length} servicios con receta de insumos.`);
