import { Router } from "express";
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db, workOrdersTable, workOrderItemsTable, purchasesTable, partsTable, clientsTable, bicyclesTable, usersTable, servicesTable, serviceSuppliesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { workOrderEconomics } from "../helpers/inventory";
import { getWorkshopSettings } from "../helpers/settings";

// "Mis números": cómo le fue al taller en un período. Solo administrador.
const router = Router();
router.use(requireAuth);

const round = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const validDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const OPEN = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"] as const;

router.get("/summary", async (req, res) => {
  if (res.locals.userRole !== "admin") { res.status(403).json({ error: "Solo un administrador ve los números del taller" }); return; }
  const now = new Date();
  const from = validDay(req.query.from) ? req.query.from : ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = validDay(req.query.to) ? req.query.to : ymd(now);
  if (from > to) { res.status(400).json({ error: "La fecha inicial es posterior a la final" }); return; }
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1);

  try {
    const settings = await getWorkshopSettings();

    // Trabajos entregados en el período: lo que se facturó y lo que dejó.
    const delivered = await db.select({
      id: workOrdersTable.id, number: workOrdersTable.workOrderNumber, workCaseId: workOrdersTable.workCaseId, total: workOrdersTable.total,
      mechanicId: workOrdersTable.mechanicId, clientName: clientsTable.name, bikeBrand: bicyclesTable.brand, bikeModel: bicyclesTable.model,
    }).from(workOrdersTable)
      .leftJoin(clientsTable, eq(clientsTable.id, workOrdersTable.clientId))
      .leftJoin(bicyclesTable, eq(bicyclesTable.id, workOrdersTable.bicycleId))
      .where(and(eq(workOrdersTable.status, "delivered"), gte(workOrdersTable.deliveredAt, start), lt(workOrdersTable.deliveredAt, end)))
      .limit(500);
    const eco: { row: (typeof delivered)[number]; e: NonNullable<Awaited<ReturnType<typeof workOrderEconomics>>> }[] = [];
    for (const row of delivered) {
      const e = await workOrderEconomics(row.id);
      if (e) eco.push({ row, e });
    }
    const sum = (f: (x: (typeof eco)[number]) => number) => eco.reduce((s, x) => s + f(x), 0);
    const billed = sum(x => x.e.total), revenue = sum(x => x.e.revenue), materials = sum(x => x.e.materialsCost);
    const labor = sum(x => x.e.laborCost ?? 0), hours = sum(x => x.e.laborHours), margin = sum(x => x.e.margin);

    // Plata que entró en el período (por fecha de pago) y lo que falta cobrar (siempre, no solo del período).
    const [collected] = await db.select({
      amount: sql<string>`coalesce(sum(coalesce(${workOrdersTable.paidAmount}, ${workOrdersTable.total})), 0)`,
      count: sql<string>`count(*)`,
    }).from(workOrdersTable).where(and(isNotNull(workOrdersTable.paidAt), gte(workOrdersTable.paidAt, start), lt(workOrdersTable.paidAt, end)));

    const unpaid = (await db.select({
      id: workOrdersTable.id, number: workOrdersTable.workOrderNumber, workCaseId: workOrdersTable.workCaseId, total: workOrdersTable.total,
      paidAt: workOrdersTable.paidAt, paidAmount: workOrdersTable.paidAmount, deliveredAt: workOrdersTable.deliveredAt, clientName: clientsTable.name, clientPhone: clientsTable.phone,
    }).from(workOrdersTable).leftJoin(clientsTable, eq(clientsTable.id, workOrdersTable.clientId))
      .where(eq(workOrdersTable.status, "delivered")))
      .map(w => ({ ...w, balance: Number(w.total) - (w.paidAt ? Number(w.paidAmount ?? w.total) : 0) }))
      .filter(w => w.balance > 0.5)
      .sort((a, b) => b.balance - a.balance);

    const [inProgress] = await db.select({
      count: sql<string>`count(*)`, value: sql<string>`coalesce(sum(${workOrdersTable.total}), 0)`,
    }).from(workOrdersTable).where(inArray(workOrdersTable.status, [...OPEN]));

    // Compras confirmadas en el período (por fecha del documento, o de confirmación si no la tiene).
    const [bought] = await db.select({
      total: sql<string>`coalesce(sum(coalesce(${purchasesTable.total}, 0)), 0)`,
      net: sql<string>`coalesce(sum(coalesce(${purchasesTable.netTotal}, 0)), 0)`,
      count: sql<string>`count(*)`,
    }).from(purchasesTable).where(and(
      eq(purchasesTable.status, "confirmed"),
      sql`coalesce(${purchasesTable.issuedOn}::timestamp, ${purchasesTable.confirmedAt}) >= ${start} and coalesce(${purchasesTable.issuedOn}::timestamp, ${purchasesTable.confirmedAt}) < ${end}`,
    ));

    const [stock] = await db.select({
      value: sql<string>`coalesce(sum(greatest(${partsTable.stock}, 0) * coalesce(${partsTable.costPrice}, 0)), 0)`,
    }).from(partsTable).where(eq(partsTable.active, true));

    // Por mecánico: lo que cerró cada uno y lo que dejó (mano de obra y repuestos separados).
    const mechNames = new Map((await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)).map(u => [u.id, u.name]));
    const byMech = new Map<number | null, { jobs: number; revenue: number; materialsCost: number; laborCost: number; margin: number }>();
    for (const { row, e } of eco) {
      const k = row.mechanicId ?? null;
      const m = byMech.get(k) ?? { jobs: 0, revenue: 0, materialsCost: 0, laborCost: 0, margin: 0 };
      m.jobs += 1; m.revenue += e.revenue; m.materialsCost += e.materialsCost; m.laborCost += e.laborCost ?? 0; m.margin += e.margin;
      byMech.set(k, m);
    }

    // Servicios más usados y lo que dejan (los insumos de la receta se estiman a costo actual).
    const rate = settings.laborCostPerHour ?? 0;
    const vatDiv = settings.recoversVat ? 1.19 : 1;
    const deliveredIds = eco.map(x => x.row.id);
    const svcItems = deliveredIds.length ? await db.select({
      serviceId: workOrderItemsTable.serviceId, total: workOrderItemsTable.total, hours: workOrderItemsTable.estimatedLaborHours,
    }).from(workOrderItemsTable).where(and(
      inArray(workOrderItemsTable.workOrderId, deliveredIds), isNotNull(workOrderItemsTable.serviceId),
      eq(workOrderItemsTable.active, true), eq(workOrderItemsTable.approvalStatus, "approved"),
    )) : [];
    const svcIds = [...new Set(svcItems.map(i => i.serviceId!))];
    const svcNames = new Map(svcIds.length ? (await db.select({ id: servicesTable.id, name: servicesTable.name }).from(servicesTable).where(inArray(servicesTable.id, svcIds))).map(s => [s.id, s.name]) : []);
    const recipeCost = new Map<number, number>();
    if (svcIds.length) {
      const rows = await db.select({ serviceId: serviceSuppliesTable.serviceId, qty: serviceSuppliesTable.quantity, cost: partsTable.costPrice })
        .from(serviceSuppliesTable).innerJoin(partsTable, eq(partsTable.id, serviceSuppliesTable.partId)).where(inArray(serviceSuppliesTable.serviceId, svcIds));
      for (const r of rows) recipeCost.set(r.serviceId, (recipeCost.get(r.serviceId) ?? 0) + Number(r.qty) * Number(r.cost ?? 0));
    }
    const svc = new Map<number, { uses: number; revenue: number; laborCost: number; suppliesCost: number }>();
    for (const i of svcItems) {
      const s = svc.get(i.serviceId!) ?? { uses: 0, revenue: 0, laborCost: 0, suppliesCost: 0 };
      s.uses += 1; s.revenue += Number(i.total) / vatDiv; s.laborCost += Number(i.hours ?? 0) * rate; s.suppliesCost += recipeCost.get(i.serviceId!) ?? 0;
      svc.set(i.serviceId!, s);
    }

    res.json({
      from, to,
      byMechanic: [...byMech.entries()].map(([id, m]) => ({
        mechanicId: id, name: id == null ? "Sin asignar" : mechNames.get(id) ?? "—", jobs: m.jobs, revenue: round(m.revenue),
        materialsCost: round(m.materialsCost), laborCost: round(m.laborCost), margin: round(m.margin),
      })).sort((a, b) => b.margin - a.margin),
      topServices: [...svc.entries()].map(([id, s]) => ({
        serviceId: id, name: svcNames.get(id) ?? "Servicio", uses: s.uses, revenue: round(s.revenue),
        margin: round(s.revenue - s.laborCost - s.suppliesCost),
        marginPct: s.revenue > 0 ? round(((s.revenue - s.laborCost - s.suppliesCost) / s.revenue) * 100) : null,
      })).sort((a, b) => b.uses - a.uses).slice(0, 8),
      laborCostPerHour: settings.laborCostPerHour ?? null,
      recoversVat: settings.recoversVat,
      jobs: {
        count: eco.length, billed: round(billed), revenue: round(revenue), materialsCost: round(materials), laborCost: round(labor),
        laborHours: round(hours), margin: round(margin), marginPct: revenue > 0 ? round((margin / revenue) * 100) : null,
        avgTicket: eco.length ? round(billed / eco.length) : null,
        // Lo que deja cada hora trabajada antes de contar tu tiempo: compáralo con lo que te cuesta la hora.
        earnedPerHour: hours > 0 ? round((revenue - materials) / hours) : null,
      },
      collected: { amount: round(Number(collected.amount)), count: Number(collected.count) },
      receivable: {
        amount: round(unpaid.reduce((s, w) => s + w.balance, 0)), count: unpaid.length,
        items: unpaid.slice(0, 8).map(w => ({ workOrderId: w.id, workCaseId: w.workCaseId, workOrderNumber: w.number, clientName: w.clientName, clientPhone: w.clientPhone, total: Number(w.total), balance: round(w.balance), deliveredAt: w.deliveredAt?.toISOString() ?? null })),
      },
      inProgress: { count: Number(inProgress.count), value: round(Number(inProgress.value)) },
      purchases: { total: round(Number(bought.total)), net: round(Number(bought.net)), count: Number(bought.count) },
      stockValue: round(Number(stock.value)),
      lowestMargins: [...eco].filter(x => x.e.marginPct != null).sort((a, b) => a.e.margin - b.e.margin).slice(0, 5).map(x => ({
        workOrderId: x.row.id, workCaseId: x.row.workCaseId, workOrderNumber: x.row.number, clientName: x.row.clientName,
        bicycleName: [x.row.bikeBrand, x.row.bikeModel].filter(Boolean).join(" ") || null,
        total: x.e.total, margin: x.e.margin, marginPct: x.e.marginPct,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
