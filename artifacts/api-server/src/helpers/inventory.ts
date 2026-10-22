import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, partsTable, inventoryMovementsTable, purchasesTable, purchaseItemsTable, serviceSuppliesTable,
  workOrdersTable, workOrderItemsTable, quoteItemsTable, timelineEventsTable, workshopSettingsTable,
} from "@workspace/db";
import { computeWorkOrderTotal } from "./workCase";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

// Inventario: cada entrada y salida de stock queda como movimiento con su costo.
//  - Compra confirmada  → +stock y costo promedio ponderado.
//  - Repuesto comprado para un trabajo → entra y sale al tiro (consumo de esa OT) y se cobra ahí.
//  - OT lista para retiro → se descuentan sus repuestos y los insumos de sus servicios (automático);
//    si vuelve a reparación, esos consumos automáticos se devuelven.

export const VAT_RATE = 0.19;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function costSettings(exec: Exec) {
  const [s] = await exec.select({
    recoversVat: workshopSettingsTable.recoversVat,
    margin: workshopSettingsTable.defaultPartsMarginPct,
    laborCostPerHour: workshopSettingsTable.laborCostPerHour,
  }).from(workshopSettingsTable).where(eq(workshopSettingsTable.workshopId, sql`current_workshop_id()`));
  return {
    recoversVat: s?.recoversVat ?? false,
    marginPct: s?.margin != null ? Number(s.margin) : 30,
    laborCostPerHour: s?.laborCostPerHour != null ? Number(s.laborCostPerHour) : null,
  };
}

// Costo real de una unidad comprada: neto si el taller recupera el IVA, con IVA si no.
export const effectiveCost = (unitCostNet: number, recoversVat: boolean) =>
  round2(recoversVat ? unitCostNet : unitCostNet * (1 + VAT_RATE));

// Precio al cliente de un repuesto: el PVP que fija el distribuidor o costo + margen (redondeado a $10).
export const priceWithMargin = (unitCost: number, marginPct: number) =>
  Math.round((unitCost * (1 + marginPct / 100)) / 10) * 10;

type MovementInput = {
  partId: number; kind: "purchase" | "consumption" | "return" | "adjustment"; quantity: number; unitCost: number | null;
  workOrderId?: number | null; workOrderItemId?: number | null; purchaseId?: number | null;
  automatic?: boolean; note?: string | null; userId?: number | null;
};

export async function applyMovement(exec: Exec, m: MovementInput) {
  await exec.insert(inventoryMovementsTable).values({
    partId: m.partId, kind: m.kind, quantity: String(m.quantity), unitCost: m.unitCost != null ? String(m.unitCost) : null,
    workOrderId: m.workOrderId ?? null, workOrderItemId: m.workOrderItemId ?? null, purchaseId: m.purchaseId ?? null,
    automatic: m.automatic ?? false, note: m.note ?? null, userId: m.userId ?? null,
  });
  await exec.update(partsTable)
    .set({ stock: sql`${partsTable.stock} + ${String(m.quantity)}`, updatedAt: new Date() })
    .where(eq(partsTable.id, m.partId));
}

// Entrada de stock con costo promedio ponderado (lo que ya había vale lo que costó).
async function receive(exec: Exec, partId: number, quantity: number, unitCost: number, purchaseId: number, userId: number | null) {
  const [p] = await exec.select({ stock: partsTable.stock, cost: partsTable.costPrice }).from(partsTable).where(eq(partsTable.id, partId));
  const onHand = Math.max(Number(p?.stock ?? 0), 0);
  const oldCost = p?.cost != null ? Number(p.cost) : unitCost;
  const newCost = onHand + quantity > 0 ? (onHand * oldCost + quantity * unitCost) / (onHand + quantity) : unitCost;
  await exec.update(partsTable).set({ costPrice: String(round2(newCost)) }).where(eq(partsTable.id, partId));
  await applyMovement(exec, { partId, kind: "purchase", quantity, unitCost, purchaseId, userId });
}

export class PurchaseError extends Error {}

// Confirma una compra en borrador: crea los artículos nuevos, suma stock y, en las líneas
// asignadas a un trabajo, agrega el repuesto a esa OT (al precio de venta) y lo consume.
export async function confirmPurchase(purchaseId: number, userId: number | null) {
  return db.transaction(async (tx) => {
    const [purchase] = await tx.select().from(purchasesTable).where(eq(purchasesTable.id, purchaseId)).for("update");
    if (!purchase) throw new PurchaseError("Compra no encontrada");
    if (purchase.status !== "draft") throw new PurchaseError("Esta compra ya fue confirmada");
    const lines = await tx.select().from(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, purchaseId)).orderBy(purchaseItemsTable.sortOrder);
    if (lines.length === 0) throw new PurchaseError("La compra no tiene líneas");
    const settings = await costSettings(tx);
    const touchedOrders = new Set<number>();

    for (const line of lines) {
      const qty = Number(line.quantity);
      if (!(qty > 0)) throw new PurchaseError(`Cantidad inválida en "${line.description}"`);
      const unitCost = effectiveCost(Number(line.unitCostNet), settings.recoversVat);
      const salePrice = line.salePrice != null ? Number(line.salePrice) : null;

      // Artículo: el elegido o uno nuevo con los datos del documento.
      let partId = line.partId;
      if (!partId) {
        const [created] = await tx.insert(partsTable).values({
          name: line.description, sku: line.supplierCode ?? null, unit: line.unit || "un", kind: "part",
          costPrice: String(unitCost), suggestedPrice: String(salePrice ?? priceWithMargin(unitCost, settings.marginPct)),
        }).returning({ id: partsTable.id });
        partId = created.id;
        await tx.update(purchaseItemsTable).set({ partId }).where(eq(purchaseItemsTable.id, line.id));
      } else if (salePrice != null) {
        // El distribuidor fija el PVP: queda como precio del artículo.
        await tx.update(partsTable).set({ suggestedPrice: String(salePrice) }).where(eq(partsTable.id, partId));
      }
      await receive(tx, partId, qty, unitCost, purchaseId, userId);

      // Comprado para un trabajo: se agrega a la OT y se consume al tiro.
      if (line.workOrderId) {
        const [wo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, line.workOrderId));
        if (!wo) throw new PurchaseError(`La OT de "${line.description}" no existe`);
        if (wo.status === "delivered" || wo.status === "cancelled") throw new PurchaseError(`${wo.workOrderNumber} ya está cerrada`);
        const [part] = await tx.select({ name: partsTable.name }).from(partsTable).where(eq(partsTable.id, partId));
        const price = salePrice ?? priceWithMargin(unitCost, settings.marginPct);
        const [item] = await tx.insert(workOrderItemsTable).values({
          workOrderId: wo.id, itemType: "part", description: part?.name ?? line.description, quantity: String(qty),
          unitPrice: String(price), total: String(price * qty), origin: "additional", approvalStatus: "approved",
          approvalDecidedBy: "staff", approvalDecidedAt: new Date(), partId, unitCost: String(unitCost),
          stockConsumed: true, sortOrder: 200,
        }).returning({ id: workOrderItemsTable.id });
        await applyMovement(tx, {
          partId, kind: "consumption", quantity: -qty, unitCost, workOrderId: wo.id, workOrderItemId: item.id,
          purchaseId, userId, note: `Comprado para ${wo.workOrderNumber}`,
        });
        await tx.insert(timelineEventsTable).values({
          entityType: "work_order", entityId: wo.id, userId, action: "part_purchased_for_job",
          comment: `${part?.name ?? line.description} × ${qty}`,
        });
        touchedOrders.add(wo.id);
      }
    }

    // Totales de las OT que recibieron repuestos.
    for (const woId of touchedOrders) {
      const items = await tx.select().from(workOrderItemsTable)
        .where(and(eq(workOrderItemsTable.workOrderId, woId), eq(workOrderItemsTable.active, true)));
      await tx.update(workOrdersTable).set({ total: String(computeWorkOrderTotal(items)), updatedAt: new Date() })
        .where(eq(workOrdersTable.id, woId));
    }

    const net = lines.reduce((s, l) => s + Number(l.unitCostNet) * Number(l.quantity), 0);
    await tx.update(purchasesTable).set({
      status: "confirmed", confirmedAt: new Date(), updatedAt: new Date(),
      netTotal: purchase.netTotal ?? String(round2(net)),
      taxTotal: purchase.taxTotal ?? String(round2(net * VAT_RATE)),
      total: purchase.total ?? String(round2(net * (1 + VAT_RATE))),
    }).where(eq(purchasesTable.id, purchaseId));
    return { touchedOrders: [...touchedOrders] };
  });
}

// Servicio de catálogo de cada ítem de la OT: el suyo o, en ítems antiguos, el del presupuesto.
async function serviceOfItems(exec: Exec, items: { id: number; serviceId: number | null; quoteItemId: number | null }[]) {
  const out = new Map(items.filter(i => i.serviceId).map(i => [i.id, i.serviceId!]));
  const qIds = items.filter(i => !i.serviceId && i.quoteItemId).map(i => i.quoteItemId!);
  if (qIds.length) {
    const rows = await exec.select({ id: quoteItemsTable.id, serviceId: quoteItemsTable.serviceId })
      .from(quoteItemsTable).where(inArray(quoteItemsTable.id, qIds));
    const byQuoteItem = new Map(rows.filter(r => r.serviceId).map(r => [r.id, r.serviceId!]));
    for (const i of items) if (!i.serviceId && i.quoteItemId && byQuoteItem.has(i.quoteItemId)) out.set(i.id, byQuoteItem.get(i.quoteItemId)!);
  }
  return out;
}

// Lo que una OT abierta va a sacar del stock: sus repuestos (aún no descontados) y los insumos de sus servicios.
export async function plannedConsumption(exec: Exec, workOrderIds: number[]) {
  if (workOrderIds.length === 0) return [] as { workOrderId: number; workOrderItemId: number; partId: number; quantity: number; fromRecipe: boolean }[];
  const items = await exec.select().from(workOrderItemsTable).where(and(
    inArray(workOrderItemsTable.workOrderId, workOrderIds),
    eq(workOrderItemsTable.active, true),
    eq(workOrderItemsTable.approvalStatus, "approved"),
    eq(workOrderItemsTable.stockConsumed, false),
  ));
  const live = items.filter(i => i.status !== "cancelled");
  const serviceByItem = await serviceOfItems(exec, live);
  const serviceIds = [...new Set(serviceByItem.values())];
  const recipes = serviceIds.length
    ? await exec.select().from(serviceSuppliesTable).where(inArray(serviceSuppliesTable.serviceId, serviceIds))
    : [];

  const out: { workOrderId: number; workOrderItemId: number; partId: number; quantity: number; fromRecipe: boolean }[] = [];
  for (const it of live) {
    const qty = Number(it.quantity);
    if (it.partId) out.push({ workOrderId: it.workOrderId, workOrderItemId: it.id, partId: it.partId, quantity: qty, fromRecipe: false });
    const svc = serviceByItem.get(it.id);
    for (const r of recipes.filter(r => r.serviceId === svc)) {
      out.push({ workOrderId: it.workOrderId, workOrderItemId: it.id, partId: r.partId, quantity: Number(r.quantity) * qty, fromRecipe: true });
    }
  }
  return out;
}

// OT lista para retiro: descuenta del stock sus repuestos e insumos (una sola vez).
export async function consumeWorkOrderStock(workOrderId: number, userId: number | null) {
  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
  if (!wo || wo.stockConsumedAt) return;
  const planned = await plannedConsumption(db, [workOrderId]);
  const partIds = [...new Set(planned.map(p => p.partId))];
  const costs = new Map(partIds.length
    ? (await db.select({ id: partsTable.id, cost: partsTable.costPrice }).from(partsTable).where(inArray(partsTable.id, partIds)))
      .map(p => [p.id, p.cost != null ? Number(p.cost) : null])
    : []);
  for (const p of planned) {
    const unitCost = costs.get(p.partId) ?? null;
    await applyMovement(db, {
      partId: p.partId, kind: "consumption", quantity: -p.quantity, unitCost, workOrderId, workOrderItemId: p.workOrderItemId,
      automatic: true, userId, note: p.fromRecipe ? `Insumo de ${wo.workOrderNumber}` : `Usado en ${wo.workOrderNumber}`,
    });
    if (!p.fromRecipe) {
      await db.update(workOrderItemsTable).set({ stockConsumed: true, unitCost: unitCost != null ? String(unitCost) : null })
        .where(and(eq(workOrderItemsTable.id, p.workOrderItemId), isNull(workOrderItemsTable.unitCost)));
      await db.update(workOrderItemsTable).set({ stockConsumed: true }).where(eq(workOrderItemsTable.id, p.workOrderItemId));
    }
  }
  await db.update(workOrdersTable).set({ stockConsumedAt: new Date() }).where(eq(workOrdersTable.id, workOrderId));
}

// La OT vuelve a reparación: se devuelve al stock lo que se descontó automáticamente.
export async function returnWorkOrderStock(workOrderId: number, userId: number | null) {
  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
  if (!wo?.stockConsumedAt) return;
  const moves = await db.select().from(inventoryMovementsTable).where(and(
    eq(inventoryMovementsTable.workOrderId, workOrderId), eq(inventoryMovementsTable.automatic, true),
  ));
  // Neto por artículo e ítem de lo consumido automáticamente (consumos − devoluciones previas).
  const net = new Map<string, { partId: number; itemId: number | null; qty: number; cost: number | null }>();
  for (const m of moves) {
    const key = `${m.partId}:${m.workOrderItemId ?? ""}`;
    const cur = net.get(key) ?? { partId: m.partId, itemId: m.workOrderItemId, qty: 0, cost: m.unitCost != null ? Number(m.unitCost) : null };
    cur.qty += Number(m.quantity);
    net.set(key, cur);
  }
  for (const n of net.values()) {
    if (n.qty >= 0) continue;
    await applyMovement(db, {
      partId: n.partId, kind: "return", quantity: -n.qty, unitCost: n.cost, workOrderId, workOrderItemId: n.itemId,
      automatic: true, userId, note: `${wo.workOrderNumber} volvió a reparación`,
    });
  }
  const itemIds = [...new Set(moves.map(m => m.workOrderItemId).filter((x): x is number => x != null))];
  if (itemIds.length) {
    await db.update(workOrderItemsTable).set({ stockConsumed: false }).where(inArray(workOrderItemsTable.id, itemIds));
  }
  await db.update(workOrdersTable).set({ stockConsumedAt: null }).where(eq(workOrdersTable.id, workOrderId));
}

// Números de una OT: lo cobrado, lo que costaron repuestos/insumos y la mano de obra, y el margen.
export async function workOrderEconomics(workOrderId: number) {
  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
  if (!wo) return null;
  const settings = await costSettings(db);
  const items = (await db.select().from(workOrderItemsTable)
    .where(and(eq(workOrderItemsTable.workOrderId, workOrderId), eq(workOrderItemsTable.active, true))))
    .filter(i => i.approvalStatus === "approved" && i.status !== "cancelled");

  // Repuestos e insumos: lo realmente descontado (movimientos) + lo que falta descontar (estimado).
  const moves = await db.select().from(inventoryMovementsTable).where(and(
    eq(inventoryMovementsTable.workOrderId, workOrderId),
    inArray(inventoryMovementsTable.kind, ["consumption", "return"]),
  ));
  let materialsCost = moves.reduce((s, m) => s - Number(m.quantity) * Number(m.unitCost ?? 0), 0);
  let missingCosts = moves.some(m => m.unitCost == null && Number(m.quantity) < 0);
  // Ya descontada (lista/entregada): solo cuenta lo real. Si no, se estima lo que falta descontar.
  const pending = wo.stockConsumedAt ? [] : await plannedConsumption(db, [workOrderId]);
  if (pending.length) {
    const ids = [...new Set(pending.map(p => p.partId))];
    const costs = new Map((await db.select({ id: partsTable.id, cost: partsTable.costPrice }).from(partsTable).where(inArray(partsTable.id, ids)))
      .map(p => [p.id, p.cost != null ? Number(p.cost) : null]));
    for (const p of pending) {
      const c = costs.get(p.partId);
      if (c == null) missingCosts = true;
      materialsCost += p.quantity * (c ?? 0);
    }
  }

  const laborHours = items.reduce((s, i) => s + Number(i.estimatedLaborHours ?? 0), 0) || Number(wo.estimatedLaborHours ?? 0);
  const laborCost = settings.laborCostPerHour != null ? laborHours * settings.laborCostPerHour : null;
  const total = computeWorkOrderTotal(items);
  // Con IVA recuperable el taller se queda con el neto de lo que cobra.
  const revenue = settings.recoversVat ? total / (1 + VAT_RATE) : total;
  const margin = revenue - materialsCost - (laborCost ?? 0);
  return {
    total, revenue: round2(revenue), materialsCost: round2(materialsCost), laborHours: round2(laborHours),
    laborCost: laborCost != null ? round2(laborCost) : null, margin: round2(margin),
    marginPct: revenue > 0 ? round2((margin / revenue) * 100) : null,
    recoversVat: settings.recoversVat, missingCosts, missingLaborCost: settings.laborCostPerHour == null,
    stockConsumed: !!wo.stockConsumedAt,
  };
}
