import { db } from "@workspace/db";
import {
  workCasesTable,
  workOrdersTable,
  workOrderItemsTable,
  workOrderChecklistItemsTable,
  receptionsTable,
  quotesTable,
  quoteItemsTable,
  serviceStepsTable,
  timelineEventsTable,
} from "@workspace/db";
import { eq, and, asc, count } from "drizzle-orm";
import { estimateCompletionDate } from "./completionEstimate";
import { nextDocumentNumber } from "./numbering";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Postgres 23505: choque con un índice único (p.ej. doble clic al crear una OT).
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

// Total cobrable de una OT: solo ítems aprobados por el cliente y no cancelados.
// Los descuentos siempre restan, se hayan ingresado con signo positivo o negativo.
export function computeWorkOrderTotal(items: Array<{
  itemType: string;
  total: string | number;
  status?: string;
  approvalStatus?: string;
  active?: boolean;
}>): number {
  const total = items
    .filter(i => i.active !== false && i.status !== "cancelled" && (i.approvalStatus ?? "approved") === "approved")
    .reduce((sum, i) => {
      const t = Number(i.total);
      return i.itemType === "discount" ? sum - Math.abs(t) : sum + t;
    }, 0);
  return Math.max(0, total);
}

export async function nextWorkCaseNumber(): Promise<string> {
  return nextDocumentNumber(db, "TR");
}

export async function logWorkCaseEvent(
  workCaseId: number,
  action: string,
  userId: number | null,
  previousStatus?: string,
  newStatus?: string,
  comment?: string,
  entityType: "work_case" | "quote" | "reception" | "work_order" = "work_case",
  linkedEntityId?: number,
): Promise<void> {
  await db.insert(timelineEventsTable).values({
    entityType,
    entityId: linkedEntityId ?? workCaseId,
    userId,
    action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    comment: comment ?? null,
  });
}

export async function recalcWorkCaseStatus(workCaseId: number): Promise<void> {
  const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, workCaseId));
  if (!wc) return;

  const workOrders = await db.select({
    status: workOrdersTable.status,
    mechanicId: workOrdersTable.mechanicId,
    total: workOrdersTable.total,
    estimatedLaborHours: workOrdersTable.estimatedLaborHours,
    progressPercentage: workOrdersTable.progressPercentage,
  }).from(workOrdersTable).where(and(eq(workOrdersTable.workCaseId, workCaseId), eq(workOrdersTable.active, true)));

  const receptions = await db.select({
    status: receptionsTable.status,
  }).from(receptionsTable).where(and(eq(receptionsTable.workCaseId, workCaseId), eq(receptionsTable.active, true)));

  const quotes = await db.select({
    status: quotesTable.status,
    total: quotesTable.total,
    estimatedLaborHours: quotesTable.estimatedLaborHours,
  }).from(quotesTable).where(and(eq(quotesTable.workCaseId, workCaseId), eq(quotesTable.active, true)));

  let newStatus: string = wc.status;
  let mechanicId: number | null = wc.assignedMechanicId;
  let totalAmount: string | null = wc.totalEstimatedAmount;
  let laborHours: string | null = wc.totalEstimatedLaborHours;
  let progress: string | null = wc.progressPercentage;

  const activeWO = workOrders.filter(wo => wo.status !== "cancelled");
  if (activeWO.length > 0) {
    const wo = activeWO[0];
    const woStatusMap: Record<string, string> = {
      ready_to_work: "in_work_order",
      in_progress: "in_progress",
      quality_control: "quality_control",
      ready_for_pickup: "ready_for_pickup",
      delivered: "delivered",
      cancelled: "cancelled",
    };
    newStatus = woStatusMap[wo.status] ?? wc.status;
    totalAmount = wo.total ? String(Number(wo.total)) : totalAmount;
    laborHours = wo.estimatedLaborHours ? String(Number(wo.estimatedLaborHours)) : laborHours;
    progress = wo.progressPercentage ? String(Number(wo.progressPercentage)) : null;
    if (!mechanicId && wo.mechanicId) mechanicId = wo.mechanicId;
  } else if (receptions.length > 0) {
    const activeRec = receptions.filter(r => r.status !== "cancelled");
    if (activeRec.length > 0) {
      const rec = activeRec[0];
      const recStatusMap: Record<string, string> = {
        received: "bike_received",
        in_inspection: "in_inspection",
        inspection_completed: "in_inspection",
        waiting_quote_approval: "quote_sent",
        ready_for_work_order: "ready_for_work_order",
        cancelled: "cancelled",
      };
      newStatus = recStatusMap[rec.status] ?? wc.status;
    }
  } else if (quotes.length > 0) {
    const activeQ = quotes.filter(q => q.status !== "rejected" && q.status !== "converted_to_work_order");
    if (activeQ.length > 0) {
      const q = activeQ[0];
      const qStatusMap: Record<string, string> = {
        draft: "lead",
        sent: "quote_sent",
        updated_after_sent: "quote_sent",
        approved: "quote_approved",
        partially_approved: "quote_approved",
        ready_for_work_order: "ready_for_work_order",
        converted_to_work_order: "in_work_order",
        rejected: "cancelled",
      };
      newStatus = qStatusMap[q.status] ?? wc.status;
      totalAmount = q.total ? String(Number(q.total)) : totalAmount;
      laborHours = q.estimatedLaborHours ? String(Number(q.estimatedLaborHours)) : laborHours;
    }
  }

  await db.update(workCasesTable).set({
    status: newStatus as any,
    assignedMechanicId: mechanicId,
    totalEstimatedAmount: totalAmount,
    totalEstimatedLaborHours: laborHours,
    progressPercentage: progress,
    updatedAt: new Date(),
  }).where(eq(workCasesTable.id, workCaseId));
}

export async function autoCreateWorkCase(
  clientId: number,
  bicycleId: number | null | undefined,
  userId: number | null,
): Promise<number> {
  const workCaseNumber = await nextWorkCaseNumber();
  const [wc] = await db.insert(workCasesTable).values({
    workCaseNumber,
    clientId,
    bicycleId: bicycleId ?? null,
    status: "lead",
  }).returning();
  await logWorkCaseEvent(wc.id, "work_case_created", userId, undefined, "lead");
  return wc.id;
}

export async function triggerWorkCaseRecalc(
  workCaseId: number | null | undefined,
  userId: number | null,
  previousStatus?: string,
): Promise<void> {
  if (!workCaseId) return;
  const [wc] = await db.select({ status: workCasesTable.status }).from(workCasesTable).where(eq(workCasesTable.id, workCaseId));
  const statusBefore = previousStatus ?? wc?.status;
  await recalcWorkCaseStatus(workCaseId);
  const [updated] = await db.select({ status: workCasesTable.status }).from(workCasesTable).where(eq(workCasesTable.id, workCaseId));
  if (updated && statusBefore && updated.status !== statusBefore) {
    await logWorkCaseEvent(workCaseId, "work_case_status_changed", userId, statusBefore, updated.status);
  }
}

// Create a work order from an approved quote inside a transaction.
// Shared by POST /work-orders/from-quote/:quoteId and POST /work-cases/quick-create.
// Uses ONLY the provided transaction handle so the whole operation rolls back on failure.
// Does NOT recalc the work_case status — the caller must run triggerWorkCaseRecalc after commit.
export async function createWorkOrderFromQuoteInternal(
  tx: Tx,
  quoteId: number,
  opts: {
    mechanicId?: number | null;
    priority?: "low" | "normal" | "high" | "urgent";
    estimatedDeliveryDate?: string | null;
    internalNotes?: string | null;
    customerNotes?: string | null;
    // Reserva que se convierte en este trabajo (no debe atrasar su propia fecha).
    reservationId?: number | null;
  },
  userId: number | null,
): Promise<{ id: number; workOrderNumber: string; workCaseId: number | null; estimatedDeliveryDate: Date | null }> {
  const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!quote) throw new Error("Presupuesto no encontrado");
  if (!quote.bicycleId) throw new Error("El presupuesto debe tener una bicicleta asociada");

  const approvedItems = await tx.select().from(quoteItemsTable).where(and(
    eq(quoteItemsTable.quoteId, quoteId),
    eq(quoteItemsTable.active, true),
    eq(quoteItemsTable.approvalStatus, "approved"),
  ));
  if (approvedItems.length === 0) throw new Error("No hay ítems aprobados en este presupuesto");

  const [reception] = await tx.select().from(receptionsTable).where(and(
    eq(receptionsTable.quoteId, quoteId),
    eq(receptionsTable.active, true),
  ));

  const workOrderNumber = await nextDocumentNumber(tx, "OT");

  const totalValue = computeWorkOrderTotal(approvedItems);
  const laborHours = approvedItems.reduce((sum, i) => sum + (i.estimatedLaborHours ? Number(i.estimatedLaborHours) : 0), 0);

  // Sin fecha indicada, se estima según la carga actual del taller.
  const estimatedDeliveryDate = opts.estimatedDeliveryDate
    ? new Date(opts.estimatedDeliveryDate)
    : (await estimateCompletionDate(tx, { laborHours, mechanicId: opts.mechanicId, excludeReservationId: opts.reservationId ?? undefined })).date;

  const [wo] = await tx.insert(workOrdersTable).values({
    workOrderNumber,
    quoteId,
    receptionId: reception?.id ?? null,
    clientId: quote.clientId,
    bicycleId: quote.bicycleId,
    mechanicId: opts.mechanicId ?? null,
    priority: opts.priority ?? "normal",
    internalNotes: opts.internalNotes ?? null,
    customerNotes: opts.customerNotes ?? null,
    estimatedDeliveryDate,
    total: String(totalValue),
    estimatedLaborHours: String(laborHours),
    workCaseId: quote.workCaseId ?? null,
  }).returning();

  // Copy approved items, and for service items copy their steps as checklist items
  for (let i = 0; i < approvedItems.length; i++) {
    const qi = approvedItems[i];
    const [woItem] = await tx.insert(workOrderItemsTable).values({
      workOrderId: wo.id,
      quoteItemId: qi.id,
      itemType: qi.itemType,
      description: qi.description,
      quantity: qi.quantity,
      unitPrice: qi.unitPrice,
      total: qi.total,
      estimatedLaborHours: qi.estimatedLaborHours ?? null,
      partId: qi.partId ?? null,
      serviceId: qi.serviceId ?? null,
      sortOrder: i,
    }).returning();

    if (qi.serviceId) {
      const steps = await tx.select().from(serviceStepsTable).where(and(
        eq(serviceStepsTable.serviceId, qi.serviceId),
        eq(serviceStepsTable.active, true),
      )).orderBy(asc(serviceStepsTable.order));

      for (let j = 0; j < steps.length; j++) {
        const step = steps[j];
        await tx.insert(workOrderChecklistItemsTable).values({
          workOrderId: wo.id,
          workOrderItemId: woItem?.id ?? null,
          serviceStepId: step.id,
          description: step.description,
          sortOrder: j,
        });
      }
    }
  }

  // Convert quote and link reception to the new OT
  await tx.update(quotesTable)
    .set({ status: "converted_to_work_order", workOrderId: wo.id, updatedAt: new Date() })
    .where(eq(quotesTable.id, quoteId));

  if (reception) {
    await tx.update(receptionsTable)
      .set({ workOrderId: wo.id, updatedAt: new Date() })
      .where(eq(receptionsTable.id, reception.id));
  }

  // Timeline events (within the transaction)
  await tx.insert(timelineEventsTable).values({
    entityType: "work_order",
    entityId: wo.id,
    userId,
    action: "work_order_created",
    previousStatus: null,
    newStatus: "ready_to_work",
    comment: null,
  });
  if (quote.workCaseId) {
    await tx.insert(timelineEventsTable).values({
      entityType: "work_case",
      entityId: quote.workCaseId,
      userId,
      action: "work_order_linked_to_work_case",
      previousStatus: null,
      newStatus: null,
      comment: `Orden ${wo.workOrderNumber} vinculada`,
    });
  }

  return { id: wo.id, workOrderNumber: wo.workOrderNumber, workCaseId: quote.workCaseId ?? null, estimatedDeliveryDate };
}

export async function recalcOTTotal(workOrderId: number, userId: number | null = null): Promise<void> {
  const [wo] = await db.select({ workCaseId: workOrdersTable.workCaseId })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.id, workOrderId));

  const items = await db.select({
    itemType: workOrderItemsTable.itemType,
    total: workOrderItemsTable.total,
    status: workOrderItemsTable.status,
    approvalStatus: workOrderItemsTable.approvalStatus,
  })
    .from(workOrderItemsTable)
    .where(and(eq(workOrderItemsTable.workOrderId, workOrderId), eq(workOrderItemsTable.active, true)));

  const newTotal = computeWorkOrderTotal(items);

  await db.update(workOrdersTable)
    .set({ total: String(newTotal), updatedAt: new Date() })
    .where(eq(workOrdersTable.id, workOrderId));

  if (wo?.workCaseId) {
    await triggerWorkCaseRecalc(wo.workCaseId, userId);
  }
}
