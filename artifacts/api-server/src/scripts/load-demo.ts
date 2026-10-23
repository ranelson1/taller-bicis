// Carga un taller de demostración desde un JSON con el formato de docs/esquema-seed.md.
// Crea un taller NUEVO (no toca los demás) con su catálogo, usuarios, clientes y trabajos.
//
// Uso: DEMO_USERS_PASSWORD='...' pnpm --filter @workspace/api-server run load-demo -- ruta/al/seed.json
//
// Los trabajos se recorren por fecha de ingreso y se crean con las mismas funciones que usa la app
// (numeración, OT con checklist, término estimado, totales); después se les aplica el estado del JSON
// con fechas en el pasado ("hace N días"), así hay atrasados, listos para retiro, etc.
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, pool, runWithTenantConnection, withBypass,
  workshopsTable, workshopSettingsTable, usersTable, categoriesTable, servicesTable, serviceStepsTable,
  partsTable, paymentMethodsTable, clientsTable, bicyclesTable, workCasesTable, quotesTable, quoteItemsTable,
  receptionsTable, reservationsTable, workOrdersTable, workOrderItemsTable, workOrderChecklistItemsTable, timelineEventsTable,
} from "@workspace/db";
import { nextDocumentNumber } from "../helpers/numbering";
import { createWorkOrderFromQuoteInternal, computeWorkOrderTotal, triggerWorkCaseRecalc } from "../helpers/workCase";
import { estimateCompletionDate } from "../helpers/completionEstimate";

// ── Formato del JSON ─────────────────────────────────────────────────────────
type Item = { servicio?: string; repuesto?: string; otro?: string; cantidad?: number; precio?: number; horas?: number; decision?: "pending" | "approved" | "rejected" };
type Seed = {
  taller: { nombre: string; telefono?: string; direccion?: string; horario: Record<string, [string, string]>; colacion?: [string, string] | null };
  usuarios: { nombre: string; email: string; rol: "admin" | "mechanic" | "reception"; horasSemanales?: number }[];
  catalogo: {
    categorias: string[];
    servicios: { nombre: string; categoria?: string; precio: number; horas?: number; pasos?: string[] }[];
    repuestos: { nombre: string; categoria?: string; marca?: string; precio: number; sku?: string }[];
    metodosPago: string[];
  };
  clientes: { nombre: string; telefono?: string | null; email?: string | null; bicis: { marca: string; modelo: string; tipo?: string; anio?: number | null; color?: string | null; aro?: string | null }[] }[];
  trabajos: {
    cliente: string; bici: string; ingresoHaceDias: number; estado: string; mecanico?: string | null; problema?: string;
    items: Item[]; adicionales?: Item[]; avance?: number; terminadoHaceDias?: number | null; entregadoHaceDias?: number | null;
    pago?: { metodo: string; monto: number; haceDias: number } | null;
    comentarios?: { texto: string; visibleCliente?: boolean }[];
  }[];
  // Bicis que van a llegar: cotización acordada y día de ingreso ("enDias" desde hoy, saltando días sin atención).
  reservas?: { cliente: string; telefono?: string | null; bici?: string; items: Item[]; enDias: number; hora?: string | null; nota?: string }[];
};

const BIKE_TYPES = new Set(["mtb", "road", "gravel", "urban", "ebike", "kids", "other"]);
const OPEN = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"];
const STATES = [...OPEN, "delivered", "cancelled"];

// Azar reproducible: el mismo JSON genera siempre las mismas horas.
let seedState = 42;
const rand = () => ((seedState = (seedState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

// "Hace N días" a una hora de trabajo (entre 10:00 y 17:00).
function daysAgo(n: number, hour?: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour ?? 10 + Math.floor(rand() * 7), Math.floor(rand() * 60), 0, 0);
  return d > new Date() ? new Date(Date.now() - 60_000) : d;
}

function fail(msg: string): never { throw new Error(msg); }

async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith("-")) ?? fail("Indica la ruta del JSON");
  const password = process.env.DEMO_USERS_PASSWORD ?? fail("Define DEMO_USERS_PASSWORD (contraseña para los usuarios demo)");
  const seed: Seed = JSON.parse(await fs.readFile(file, "utf8"));
  const passwordHash = await bcrypt.hash(password, 10);

  // Validaciones antes de escribir nada.
  const emails = new Set(seed.usuarios.map(u => u.email.toLowerCase()));
  const bikeKey = (c: string, b: string) => `${c}|${b}`.toLowerCase();
  const bikes = new Set(seed.clientes.flatMap(c => c.bicis.map(b => bikeKey(c.nombre, `${b.marca} ${b.modelo}`))));
  const services = new Set(seed.catalogo.servicios.map(s => s.nombre));
  const parts = new Set(seed.catalogo.repuestos.map(p => p.nombre));
  seed.trabajos.forEach((t, i) => {
    const where = `trabajo #${i + 1} (${t.cliente})`;
    if (!STATES.includes(t.estado)) fail(`${where}: estado desconocido "${t.estado}"`);
    if (!bikes.has(bikeKey(t.cliente, t.bici))) fail(`${where}: no encuentro la bici "${t.bici}" del cliente`);
    if (t.mecanico && !emails.has(t.mecanico.toLowerCase())) fail(`${where}: mecánico "${t.mecanico}" no está en usuarios`);
    for (const it of [...t.items, ...(t.adicionales ?? [])]) {
      if (it.servicio && !services.has(it.servicio)) fail(`${where}: servicio "${it.servicio}" no está en el catálogo`);
      if (it.repuesto && !parts.has(it.repuesto)) fail(`${where}: repuesto "${it.repuesto}" no está en el catálogo`);
    }
  });

  // 1. Taller y usuarios (sin taller fijado todavía: se escribe con workshop_id explícito).
  const workshopId = await withBypass(async (bdb) => bdb.transaction(async (tx) => {
    const [ws] = await tx.insert(workshopsTable).values({ name: seed.taller.nombre }).returning();
    const schedule = Object.entries(seed.taller.horario).map(([day, [open, close]]) => ({ day: Number(day), open, close }));
    await tx.insert(workshopSettingsTable).values({
      workshopId: ws.id, name: seed.taller.nombre, phone: seed.taller.telefono ?? null, address: seed.taller.direccion ?? null,
      schedule, workdays: schedule.map(d => d.day).sort().join(","),
      lunchStart: seed.taller.colacion?.[0] ?? null, lunchEnd: seed.taller.colacion?.[1] ?? null,
    });
    await tx.insert(usersTable).values(seed.usuarios.map(u => ({
      workshopId: ws.id, name: u.nombre, email: u.email.toLowerCase(), passwordHash, role: u.rol, weeklyHours: u.horasSemanales ?? null,
      doesJobs: u.rol === "mechanic" || (u.rol === "admin" && !seed.usuarios.some(x => x.rol === "mechanic")),
    })));
    return ws.id;
  }));
  console.log(`Taller "${seed.taller.nombre}" creado (#${workshopId}).`);

  // 2. El resto, dentro del taller: lo mismo que haría la app con una sesión de ese taller.
  let finish!: () => void;
  const done = new Promise<void>(r => { finish = r; });
  let work!: Promise<void>;
  await runWithTenantConnection(workshopId, done, () => { work = loadWorkshop(seed).finally(finish); });
  await work;
}

async function loadWorkshop(seed: Seed) {
  const users = await db.select().from(usersTable);
  const userByEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  const staff = users.find(u => u.role === "admin") ?? users[0];

  // Catálogo
  const cats = await db.insert(categoriesTable).values(seed.catalogo.categorias.map(name => ({ name }))).returning();
  const catId = (name?: string) => (name ? cats.find(c => c.name === name)?.id ?? null : null);
  const svcRows = await db.insert(servicesTable).values(seed.catalogo.servicios.map(s => ({
    name: s.nombre, categoryId: catId(s.categoria), basePrice: String(s.precio), estimatedHours: s.horas != null ? String(s.horas) : null,
  }))).returning();
  const steps = seed.catalogo.servicios.flatMap(s => (s.pasos ?? []).map((description, order) => ({
    serviceId: svcRows.find(r => r.name === s.nombre)!.id, description, order,
  })));
  if (steps.length) await db.insert(serviceStepsTable).values(steps);
  const partRows = await db.insert(partsTable).values(seed.catalogo.repuestos.map(p => ({
    name: p.nombre, categoryId: catId(p.categoria), brand: p.marca ?? null, suggestedPrice: String(p.precio), sku: p.sku ?? null,
  }))).returning();
  const methods = await db.insert(paymentMethodsTable).values(seed.catalogo.metodosPago.map(name => ({ name }))).returning();
  console.log(`Catálogo: ${cats.length} categorías, ${svcRows.length} servicios (${steps.length} pasos), ${partRows.length} repuestos.`);

  // Clientes y bicis
  const bikeIds = new Map<string, { clientId: number; bikeId: number }>();
  for (const c of seed.clientes) {
    const [client] = await db.insert(clientsTable).values({ name: c.nombre, phone: c.telefono ?? null, email: c.email ?? null }).returning();
    for (const b of c.bicis) {
      const [bike] = await db.insert(bicyclesTable).values({
        clientId: client.id, brand: b.marca, model: b.modelo, type: (BIKE_TYPES.has(b.tipo ?? "") ? b.tipo : "other") as any,
        year: b.anio ?? null, color: b.color ?? null, rimSize: b.aro ?? null,
      }).returning();
      bikeIds.set(`${c.nombre}|${b.marca} ${b.modelo}`.toLowerCase(), { clientId: client.id, bikeId: bike.id });
    }
  }
  console.log(`Clientes: ${seed.clientes.length}, bicis: ${bikeIds.size}.`);

  // Trabajos, del más antiguo al más nuevo.
  const resolveItem = (it: Item) => {
    if (it.servicio) {
      const s = svcRows.find(r => r.name === it.servicio)!;
      return { itemType: "service" as const, description: s.name, price: it.precio ?? Number(s.basePrice), hours: it.horas ?? Number(s.estimatedHours ?? 0), serviceId: s.id, partId: null };
    }
    if (it.repuesto) {
      const p = partRows.find(r => r.name === it.repuesto)!;
      return { itemType: "part" as const, description: p.name, price: it.precio ?? Number(p.suggestedPrice), hours: it.horas ?? 0, serviceId: null, partId: p.id };
    }
    return { itemType: "other" as const, description: it.otro ?? "Otro", price: it.precio ?? 0, hours: it.horas ?? 0, serviceId: null, partId: null };
  };

  const works = [...seed.trabajos].sort((a, b) => b.ingresoHaceDias - a.ingresoHaceDias);
  for (const t of works) {
    const { clientId, bikeId } = bikeIds.get(`${t.cliente}|${t.bici}`.toLowerCase())!;
    const mechanic = t.mecanico ? userByEmail.get(t.mecanico.toLowerCase()) ?? null : null;
    const received = daysAgo(t.ingresoHaceDias);
    const items = t.items.map(it => ({ ...resolveItem(it), qty: it.cantidad ?? 1 }));
    const laborHours = items.reduce((s, i) => s + i.hours * i.qty, 0);

    const workCaseId = await db.transaction(async (tx) => {
      // TR, presupuesto aprobado, recepción y OT: igual que "Nuevo trabajo".
      const [wc] = await tx.insert(workCasesTable).values({
        workCaseNumber: await nextDocumentNumber(tx, "TR"), clientId, bicycleId: bikeId, status: "lead",
        originChannel: "presencial", initialRequirement: t.problema ?? null, assignedMechanicId: mechanic?.id ?? null, createdAt: received,
      }).returning();
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const [quote] = await tx.insert(quotesTable).values({
        quoteNumber: await nextDocumentNumber(tx, "P"), clientId, bicycleId: bikeId, originChannel: "presencial",
        initialRequirement: t.problema ?? null, status: "approved", subtotal: String(subtotal), total: String(subtotal),
        estimatedLaborHours: String(laborHours), approvedAt: received, workCaseId: wc.id, createdAt: received,
      }).returning();
      await tx.insert(quoteItemsTable).values(items.map((i, n) => ({
        quoteId: quote.id, itemType: i.itemType, origin: "manual" as const, description: i.description, quantity: String(i.qty),
        unitPrice: String(i.price), total: String(i.price * i.qty), estimatedLaborHours: i.hours ? String(i.hours * i.qty) : null,
        approvalStatus: "approved" as const, serviceId: i.serviceId, partId: i.partId, sortOrder: n, createdAt: received,
      })));
      const [reception] = await tx.insert(receptionsTable).values({
        receptionNumber: await nextDocumentNumber(tx, "R"), clientId, bicycleId: bikeId, quoteId: quote.id,
        receivedByUserId: staff.id, receivedAt: received, customerReportedProblem: t.problema ?? null,
        status: "ready_for_work_order", workCaseId: wc.id, createdAt: received,
      }).returning();

      // Término estimado como lo habría calculado la app el día que llegó la bici.
      const eta = await estimateCompletionDate(tx, { laborHours, mechanicId: mechanic?.id ?? null }, received);
      const created = await createWorkOrderFromQuoteInternal(tx, quote.id, {
        mechanicId: mechanic?.id ?? null, estimatedDeliveryDate: eta.date.toISOString(),
      }, staff.id);
      const woId = created.id;
      void reception;

      // Adicionales que aparecieron durante el trabajo.
      for (const [n, add] of (t.adicionales ?? []).entries()) {
        const r = resolveItem(add);
        const qty = add.cantidad ?? 1;
        const decision = add.decision ?? "approved";
        await tx.insert(workOrderItemsTable).values({
          workOrderId: woId, itemType: r.itemType, description: r.description, quantity: String(qty), unitPrice: String(r.price),
          total: String(r.price * qty), estimatedLaborHours: r.hours ? String(r.hours * qty) : null, origin: "additional",
          approvalStatus: decision, approvalDecidedAt: decision === "pending" ? null : daysAgo(Math.max(t.ingresoHaceDias - 1, 0)),
          approvalDecidedBy: decision === "pending" ? null : "client", sortOrder: 100 + n,
          createdAt: daysAgo(Math.max(t.ingresoHaceDias - 1, 0)),
        });
      }

      // Estado final y sus fechas.
      const completed = ["ready_for_pickup", "delivered"].includes(t.estado)
        ? daysAgo(t.terminadoHaceDias ?? Math.max(t.ingresoHaceDias - 2, 0), 17) : null;
      // Empieza unas horas después de llegar, pero nunca en el futuro ni después de terminar.
      const started = t.estado === "ready_to_work" ? null : new Date(Math.max(received.getTime(), Math.min(
        received.getTime() + (1 + rand() * 20) * 3600_000,
        Date.now() - 60_000,
        (completed?.getTime() ?? Infinity) - 2 * 3600_000,
      )));
      // Se entrega después de terminar (si es el mismo día, al menos media hora después) y nunca en el futuro.
      const delivered = t.estado === "delivered" ? new Date(Math.min(
        Math.max(daysAgo(t.entregadoHaceDias ?? 0, 12).getTime(), (completed?.getTime() ?? 0) + 30 * 60_000),
        Date.now() - 60_000,
      )) : null;
      const isDone = ["ready_for_pickup", "delivered"].includes(t.estado);

      // Checklist e ítems según el avance.
      const checklist = await tx.select().from(workOrderChecklistItemsTable)
        .where(eq(workOrderChecklistItemsTable.workOrderId, woId)).orderBy(workOrderChecklistItemsTable.sortOrder);
      const share = isDone ? 1 : t.estado === "quality_control" ? 1 : t.estado === "in_progress" ? (t.avance ?? 0.4) : 0;
      const doneSteps = checklist.slice(0, Math.round(checklist.length * share));
      if (doneSteps.length) {
        await tx.update(workOrderChecklistItemsTable)
          .set({ status: "completed", completedAt: completed ?? started ?? received, completedByUserId: mechanic?.id ?? null })
          .where(inArray(workOrderChecklistItemsTable.id, doneSteps.map(s => s.id)));
      }
      const woItems = await tx.select().from(workOrderItemsTable).where(eq(workOrderItemsTable.workOrderId, woId));
      if (isDone) {
        await tx.update(workOrderItemsTable).set({ status: "completed" })
          .where(and(eq(workOrderItemsTable.workOrderId, woId), eq(workOrderItemsTable.approvalStatus, "approved")));
      }
      const billable = woItems.filter(i => i.approvalStatus === "approved");
      const progress = isDone ? 100 : checklist.length ? Math.round((doneSteps.length / checklist.length) * 100) : 0;
      const method = t.pago ? methodsByName(t.pago.metodo) : null;

      await tx.update(workOrdersTable).set({
        status: t.estado as any, mechanicId: mechanic?.id ?? null, startedAt: started, completedAt: completed, deliveredAt: delivered,
        progressPercentage: String(progress), total: String(computeWorkOrderTotal(billable)),
        paidAt: t.pago ? daysAgo(t.pago.haceDias, 13) : null, paymentMethodId: method, paidAmount: t.pago ? String(t.pago.monto) : null,
        createdAt: received, updatedAt: delivered ?? completed ?? started ?? received,
      }).where(eq(workOrdersTable.id, woId));
      await tx.update(workOrderItemsTable).set({ createdAt: received })
        .where(and(eq(workOrderItemsTable.workOrderId, woId), eq(workOrderItemsTable.origin, "initial")));

      // Historial con las fechas reales del recorrido.
      await tx.update(timelineEventsTable).set({ createdAt: received }).where(or(
        and(eq(timelineEventsTable.entityType, "work_order"), eq(timelineEventsTable.entityId, woId)),
        and(eq(timelineEventsTable.entityType, "work_case"), eq(timelineEventsTable.entityId, wc.id)),
      ));
      const path: [string, Date | null][] = [
        ["in_progress", started],
        ["quality_control", ["quality_control", "ready_for_pickup", "delivered"].includes(t.estado) ? new Date((completed ?? new Date()).getTime() - 3600_000) : null],
        ["ready_for_pickup", completed],
        ["delivered", delivered],
      ];
      let prev = "ready_to_work";
      for (const [status, at] of path) {
        if (!at) continue;
        await tx.insert(timelineEventsTable).values({ entityType: "work_order", entityId: woId, userId: mechanic?.id ?? staff.id, action: "status_changed", previousStatus: prev, newStatus: status, createdAt: at });
        prev = status;
      }
      if (t.estado === "cancelled") {
        await tx.insert(timelineEventsTable).values({ entityType: "work_order", entityId: woId, userId: staff.id, action: "work_order_cancelled", previousStatus: "ready_to_work", newStatus: "cancelled", comment: t.comentarios?.[0]?.texto ?? null, createdAt: daysAgo(Math.max(t.ingresoHaceDias - 1, 0)) });
      }
      if (t.pago) {
        await tx.insert(timelineEventsTable).values({ entityType: "work_order", entityId: woId, userId: staff.id, action: "payment_registered", comment: `${t.pago.metodo} · $${t.pago.monto.toLocaleString("es-CL")}`, createdAt: daysAgo(t.pago.haceDias, 13) });
      }
      for (const c of t.comentarios ?? []) {
        await tx.insert(timelineEventsTable).values({ entityType: "work_case", entityId: wc.id, userId: mechanic?.id ?? staff.id, action: "comment_durante_trabajo", comment: c.texto, visibleToClient: !!c.visibleCliente, createdAt: started ?? received });
      }
      await tx.update(workCasesTable).set({ createdAt: received }).where(eq(workCasesTable.id, wc.id));
      return wc.id;
    });

    // Estado del TR según su OT (fuera de la transacción, como en la app).
    await triggerWorkCaseRecalc(workCaseId, null);
  }

  function methodsByName(name: string) {
    return methods.find(m => m.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  }

  // Reservas (no consumen número de OT).
  const clientRows = await db.select().from(clientsTable);
  const workdays = new Set(Object.keys(seed.taller.horario).map(Number));
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (const r of seed.reservas ?? []) {
    const day = new Date();
    day.setDate(day.getDate() + r.enDias);
    while (!workdays.has(day.getDay())) day.setDate(day.getDate() + 1);
    const client = clientRows.find(c => c.name.toLowerCase() === r.cliente.toLowerCase()) ?? null;
    const items = r.items.map(resolveItem).map(i => ({
      itemType: i.itemType === "other" ? "part" as const : i.itemType, description: i.description, quantity: 1,
      unitPrice: i.price, hours: i.hours, serviceId: i.serviceId,
    }));
    const hours = items.reduce((s, i) => s + i.hours, 0);
    await db.insert(reservationsTable).values({
      clientId: client?.id ?? null, clientName: client?.name ?? r.cliente, clientPhone: r.telefono ?? client?.phone ?? null,
      bicycleText: r.bici ?? null, note: r.nota ?? null, quoteItems: items, serviceId: items.find(i => i.serviceId)?.serviceId ?? null,
      estimatedHours: hours > 0 ? String(hours) : null, expectedOn: ymd(day), expectedTime: r.hora ?? null, createdByUserId: staff.id,
    });
  }
  if (seed.reservas?.length) console.log(`Reservas: ${seed.reservas.length}.`);

  const byState = works.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.estado]: (acc[t.estado] ?? 0) + 1 }), {});
  console.log(`Trabajos: ${works.length} (${Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(", ")}).`);
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => pool.end());
