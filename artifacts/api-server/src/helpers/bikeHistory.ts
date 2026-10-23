import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, workOrdersTable, workOrderItemsTable, type Bicycle } from "@workspace/db";
import { workshopInfo } from "./workOrderPublic";

// Historial de mantención de una bicicleta para mostrar fuera del taller (dueño, comprador, otro taller).
// Solo trabajos entregados; sin precios, sin datos del dueño y sin notas internas.

// Lo que le importa a quien lee un historial: qué se hizo y qué se cambió.
const VISIBLE_TYPES = ["service", "part", "additional_labor", "other"];

export async function buildBikeHistory(bike: Bicycle) {
  const orders = await db.select({ id: workOrdersTable.id, deliveredAt: workOrdersTable.deliveredAt })
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.bicycleId, bike.id), eq(workOrdersTable.status, "delivered"), eq(workOrdersTable.active, true)))
    .orderBy(desc(workOrdersTable.deliveredAt));

  const items = orders.length === 0 ? [] : await db.select({
    workOrderId: workOrderItemsTable.workOrderId, itemType: workOrderItemsTable.itemType,
    description: workOrderItemsTable.description, quantity: workOrderItemsTable.quantity,
  }).from(workOrderItemsTable).where(and(
    inArray(workOrderItemsTable.workOrderId, orders.map(o => o.id)),
    eq(workOrderItemsTable.active, true), eq(workOrderItemsTable.approvalStatus, "approved"),
    ne(workOrderItemsTable.status, "cancelled"), inArray(workOrderItemsTable.itemType, VISIBLE_TYPES),
  ));

  const entries = orders.filter(o => o.deliveredAt).map(o => ({
    date: o.deliveredAt!.toISOString(),
    items: items.filter(i => i.workOrderId === o.id).map(i => ({
      kind: i.itemType === "part" ? "part" : "service",
      description: i.description,
      quantity: Number(i.quantity),
    })),
  })).filter(e => e.items.length > 0);

  return {
    ...(await workshopInfo()),
    bicycle: { brand: bike.brand, model: bike.model, year: bike.year, type: bike.type, color: bike.color, rimSize: bike.rimSize },
    setupNotes: bike.setupNotes ?? null,
    setupUpdatedAt: bike.setupUpdatedAt?.toISOString() ?? null,
    serviceCount: entries.length,
    firstServiceOn: entries.length ? entries[entries.length - 1].date : null,
    lastServiceOn: entries.length ? entries[0].date : null,
    entries,
  };
}
