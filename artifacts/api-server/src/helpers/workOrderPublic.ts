import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  workOrderItemsTable,
  quoteItemsTable,
  receptionsTable,
  clientsTable,
  bicyclesTable,
  timelineEventsTable,
  workOrderPhotosTable,
} from "@workspace/db";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { recalcOTTotal, computeWorkOrderTotal } from "./workCase";
import { getWorkshopSettings } from "./settings";

type WorkOrder = typeof workOrdersTable.$inferSelect;

// Precios en Chile incluyen IVA; el desglose neto/IVA es solo informativo.
const TAX_RATE = 0.19;

export const workshopInfo = async () => {
  const s = await getWorkshopSettings();
  return { workshopName: s.name, workshopPhone: s.phone, workshopAddress: s.address, workshopLogoUrl: s.logoUrl };
};

export class ItemDecisionError extends Error {}

// Devuelve el token público de la OT, creándolo la primera vez que se comparte.
export async function ensurePublicToken(wo: WorkOrder): Promise<string> {
  if (wo.publicToken) return wo.publicToken;
  const token = crypto.randomBytes(12).toString("base64url");
  const [updated] = await db.update(workOrdersTable)
    .set({ publicToken: token, updatedAt: new Date() })
    .where(and(eq(workOrdersTable.id, wo.id), isNull(workOrdersTable.publicToken)))
    .returning({ publicToken: workOrdersTable.publicToken });
  if (updated?.publicToken) return updated.publicToken;
  // Otro request lo creó en paralelo.
  const [fresh] = await db.select({ publicToken: workOrdersTable.publicToken })
    .from(workOrdersTable).where(eq(workOrdersTable.id, wo.id));
  return fresh!.publicToken!;
}

export async function logWorkOrderEvent(
  workOrderId: number,
  action: string,
  userId: number | null,
  opts: { previousStatus?: string; newStatus?: string; comment?: string; visibleToClient?: boolean } = {},
) {
  await db.insert(timelineEventsTable).values({
    entityType: "work_order",
    entityId: workOrderId,
    userId,
    action,
    previousStatus: opts.previousStatus ?? null,
    newStatus: opts.newStatus ?? null,
    comment: opts.comment ?? null,
    visibleToClient: opts.visibleToClient ?? false,
  });
}

// Aprueba o rechaza un ítem de la OT. El cliente solo puede decidir ítems pendientes;
// el taller puede corregir una decisión ya tomada.
export async function decideWorkOrderItem(
  wo: WorkOrder,
  itemId: number,
  decision: "approved" | "rejected",
  by: "client" | "staff",
  userId: number | null,
) {
  if (wo.status === "delivered" || wo.status === "cancelled") {
    throw new ItemDecisionError("La orden ya está cerrada");
  }
  const [item] = await db.select().from(workOrderItemsTable).where(and(
    eq(workOrderItemsTable.id, itemId),
    eq(workOrderItemsTable.workOrderId, wo.id),
    eq(workOrderItemsTable.active, true),
  ));
  if (!item) throw new ItemDecisionError("Ítem no encontrado");
  if (by === "client" && item.approvalStatus !== "pending") {
    throw new ItemDecisionError("Este ítem ya fue respondido");
  }

  const now = new Date();
  const [updated] = await db.update(workOrderItemsTable)
    .set({ approvalStatus: decision, approvalDecidedAt: now, approvalDecidedBy: by, updatedAt: now })
    .where(eq(workOrderItemsTable.id, itemId))
    .returning();

  // Mantener el presupuesto interno alineado con la OT.
  if (item.quoteItemId) {
    await db.update(quoteItemsTable)
      .set({ approvalStatus: decision, updatedAt: now })
      .where(eq(quoteItemsTable.id, item.quoteItemId));
  }

  await recalcOTTotal(wo.id, userId);
  await logWorkOrderEvent(wo.id, "item_decision", userId, {
    previousStatus: by,
    newStatus: decision,
    comment: item.description,
    visibleToClient: true,
  });
  return updated;
}

const STATUS_TITLES: Record<string, string> = {
  ready_to_work: "Bicicleta recibida en el taller",
  in_progress: "Comenzamos a trabajar en tu bicicleta",
  quality_control: "Tu bicicleta está en control de calidad",
  ready_for_pickup: "¡Tu bicicleta está lista para retirar!",
  delivered: "Bicicleta entregada",
  cancelled: "Orden cancelada",
};

export const formatCLP = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

function publicTimelineEntry(ev: typeof timelineEventsTable.$inferSelect) {
  const base = { id: ev.id, createdAt: ev.createdAt.toISOString() };
  switch (ev.action) {
    case "work_order_created":
      return { ...base, title: "Orden de trabajo creada", detail: null };
    case "status_changed":
      return ev.newStatus && STATUS_TITLES[ev.newStatus]
        ? { ...base, title: STATUS_TITLES[ev.newStatus], detail: null }
        : null;
    case "additional_item_added":
      return { ...base, title: "Agregamos un trabajo adicional", detail: ev.comment };
    case "item_decision": {
      const approved = ev.newStatus === "approved";
      const who = ev.previousStatus === "client" ? (approved ? "Aprobaste" : "Rechazaste") : (approved ? "Aprobado" : "Rechazado");
      return { ...base, title: `${who}: ${ev.comment ?? "ítem"}`, detail: null };
    }
    default:
      return ev.visibleToClient && ev.comment ? { ...base, title: "Nota del taller", detail: ev.comment } : null;
  }
}

// Vista del cliente: solo datos de su OT, sin notas internas ni datos de contacto.
export async function buildPublicWorkOrder(wo: WorkOrder) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, wo.clientId));
  const [bike] = await db.select().from(bicyclesTable).where(eq(bicyclesTable.id, wo.bicycleId));
  const [reception] = wo.receptionId
    ? await db.select().from(receptionsTable).where(eq(receptionsTable.id, wo.receptionId))
    : [];

  const items = await db.select().from(workOrderItemsTable)
    .where(and(eq(workOrderItemsTable.workOrderId, wo.id), eq(workOrderItemsTable.active, true)))
    .orderBy(asc(workOrderItemsTable.sortOrder), asc(workOrderItemsTable.id));
  const visibleItems = items.filter(i => i.status !== "cancelled");

  const billable = visibleItems.filter(i => i.approvalStatus === "approved");
  const subtotal = billable.filter(i => i.itemType !== "discount").reduce((s, i) => s + Number(i.total), 0);
  const total = computeWorkOrderTotal(billable);
  const net = Math.round(total / (1 + TAX_RATE));

  const conditions = [and(eq(timelineEventsTable.entityType, "work_order"), eq(timelineEventsTable.entityId, wo.id))];
  if (wo.workCaseId) {
    conditions.push(and(
      eq(timelineEventsTable.entityType, "work_case"),
      eq(timelineEventsTable.entityId, wo.workCaseId),
      eq(timelineEventsTable.visibleToClient, true),
    ));
  }
  const photos = await db.select().from(workOrderPhotosTable).where(and(
    eq(workOrderPhotosTable.workOrderId, wo.id),
    eq(workOrderPhotosTable.active, true),
    eq(workOrderPhotosTable.visibleToClient, true),
  )).orderBy(asc(workOrderPhotosTable.createdAt));

  const events = await db.select().from(timelineEventsTable)
    .where(or(...conditions))
    .orderBy(asc(timelineEventsTable.createdAt), asc(timelineEventsTable.id));

  return {
    ...(await workshopInfo()),
    workOrderNumber: wo.workOrderNumber,
    status: wo.status,
    progressPercentage: Number(wo.progressPercentage ?? 0),
    receivedAt: (reception?.receivedAt ?? wo.createdAt).toISOString(),
    estimatedDeliveryDate: wo.estimatedDeliveryDate?.toISOString() ?? null,
    deliveredAt: wo.deliveredAt?.toISOString() ?? null,
    completedAt: wo.completedAt?.toISOString() ?? null,
    paidAt: wo.paidAt?.toISOString() ?? null,
    quoteApprovedAt: wo.quoteApprovedAt?.toISOString() ?? null,
    paymentInfo: (wo.status === "ready_for_pickup" || wo.status === "delivered")
      && Number(wo.total) - (wo.paidAt ? Number(wo.paidAmount ?? wo.total) : 0) > 0.5
      ? (await getWorkshopSettings()).paymentInfo : null,
    paidAmount: wo.paidAt && wo.paidAmount != null ? Number(wo.paidAmount) : null,
    clientName: client?.name ?? "",
    bicycle: bike ? {
      brand: bike.brand, model: bike.model, year: bike.year, type: bike.type,
      color: bike.color, rimSize: bike.rimSize,
      setupNotes: (wo.status === "ready_for_pickup" || wo.status === "delivered") ? bike.setupNotes ?? null : null,
      setupUpdatedAt: (wo.status === "ready_for_pickup" || wo.status === "delivered") ? bike.setupUpdatedAt?.toISOString() ?? null : null,
    } : null,
    reportedProblem: reception?.customerReportedProblem ?? null,
    customerNotes: wo.customerNotes,
    items: visibleItems.map(i => ({
      id: i.id,
      itemType: i.itemType,
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      total: Number(i.total),
      origin: i.origin,
      approvalStatus: i.approvalStatus,
      status: i.status,
    })),
    subtotal,
    discountTotal: Math.max(0, subtotal - total),
    total,
    net,
    tax: total - net,
    pendingApprovalCount: visibleItems.filter(i => i.approvalStatus === "pending").length,
    photos: wo.publicToken ? photos.map(p => ({
      id: p.id,
      note: p.note,
      mimeType: p.mimeType,
      createdAt: p.createdAt.toISOString(),
      url: `/api/public/ot/${wo.publicToken}/photos/${p.id}`,
    })) : [],
    timeline: events.map(publicTimelineEntry).filter((e): e is NonNullable<typeof e> => e !== null),
  };
}

// Mensaje de WhatsApp según el momento del trabajo: lo que el cliente tiene que saber o hacer.
export function shareMessage(wo: WorkOrder, clientName: string, pendingCount: number, workshopName: string) {
  const firstName = clientName.split(" ")[0] ?? "";
  const hello = `Hola ${firstName}, te escribimos de ${workshopName}.`;
  // Una fecha estimada que ya pasó no se le promete al cliente.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const eta = wo.estimatedDeliveryDate && wo.estimatedDeliveryDate >= startOfToday
    ? wo.estimatedDeliveryDate.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }).replace(",", "")
    : null;

  if (pendingCount > 0 && wo.status !== "delivered" && wo.status !== "cancelled") {
    return `${hello} Encontramos ${pendingCount === 1 ? "un trabajo adicional" : `${pendingCount} trabajos adicionales`} para tu bicicleta. Revísalo y apruébalo o recházalo aquí (orden ${wo.workOrderNumber}):`;
  }
  switch (wo.status) {
    case "ready_for_pickup":
      return `${hello} ¡Tu bicicleta está lista para retirar! Total: ${formatCLP(Number(wo.total))}. Detalle de la orden ${wo.workOrderNumber}:`;
    case "delivered":
      return `${hello} Gracias por confiar en nosotros. Aquí queda el detalle de la orden ${wo.workOrderNumber}:`;
    case "ready_to_work":
      return `${hello} Recibimos tu bicicleta${eta ? ` y estimamos tenerla lista el ${eta}` : ""}. Sigue su estado aquí (orden ${wo.workOrderNumber}):`;
    default:
      return `${hello} Estamos trabajando en tu bicicleta${eta ? `; estimamos tenerla lista el ${eta}` : ""}. Sigue su estado aquí (orden ${wo.workOrderNumber}):`;
  }
}
