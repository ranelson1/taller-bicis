import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable, bicyclesTable, servicesTable, usersTable, quotesTable, receptionsTable, workOrdersTable, timelineEventsTable } from "@workspace/db";
import { and, desc, eq, count, inArray, isNull, or, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

// GET /dashboard/activity — lo que respondieron los clientes desde su link (aprobaron o rechazaron un adicional, aprobaron
// la cotización), de los últimos 14 días, para enterarse sin revisar el chat.
router.get("/activity", async (_req, res) => {
  try {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await db.select({
      id: timelineEventsTable.id, action: timelineEventsTable.action, newStatus: timelineEventsTable.newStatus,
      comment: timelineEventsTable.comment, createdAt: timelineEventsTable.createdAt,
      workOrderId: workOrdersTable.id, workOrderNumber: workOrdersTable.workOrderNumber, workCaseId: workOrdersTable.workCaseId,
      clientName: clientsTable.name,
    }).from(timelineEventsTable)
      .innerJoin(workOrdersTable, eq(workOrdersTable.id, timelineEventsTable.entityId))
      .leftJoin(clientsTable, eq(clientsTable.id, workOrdersTable.clientId))
      .where(and(
        eq(timelineEventsTable.entityType, "work_order"),
        eq(timelineEventsTable.previousStatus, "client"),
        or(eq(timelineEventsTable.action, "item_decision"), eq(timelineEventsTable.action, "quote_approved")),
        gte(timelineEventsTable.createdAt, since),
      ))
      .orderBy(desc(timelineEventsTable.createdAt)).limit(15);
    res.json(rows.map(r => ({
      id: r.id,
      kind: r.action === "quote_approved" ? "quote_approved" : r.newStatus === "approved" ? "item_approved" : "item_rejected",
      detail: r.action === "quote_approved" ? null : r.comment,
      workOrderId: r.workOrderId, workOrderNumber: r.workOrderNumber, workCaseId: r.workCaseId,
      clientName: r.clientName, createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const [clientsResult] = await db.select({ c: count() }).from(clientsTable).where(eq(clientsTable.active, true));
    const [bicyclesResult] = await db.select({ c: count() }).from(bicyclesTable).where(eq(bicyclesTable.active, true));
    const [servicesResult] = await db.select({ c: count() }).from(servicesTable).where(eq(servicesTable.active, true));
    const [mechanicsResult] = await db.select({ c: count() }).from(usersTable)
      .where(and(eq(usersTable.active, true), eq(usersTable.doesJobs, true)));

    const [draftResult] = await db.select({ c: count() }).from(quotesTable)
      .where(and(eq(quotesTable.active, true), eq(quotesTable.status, "draft")));
    const [sentResult] = await db.select({ c: count() }).from(quotesTable)
      .where(and(eq(quotesTable.active, true), eq(quotesTable.status, "sent")));
    const [approvedResult] = await db.select({ c: count() }).from(quotesTable)
      .where(and(eq(quotesTable.active, true), eq(quotesTable.status, "approved")));
    const [partialResult] = await db.select({ c: count() }).from(quotesTable)
      .where(and(eq(quotesTable.active, true), eq(quotesTable.status, "partially_approved")));
    const [updatedSentResult] = await db.select({ c: count() }).from(quotesTable)
      .where(and(eq(quotesTable.active, true), eq(quotesTable.status, "updated_after_sent")));

    const [receptionsReceived] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), eq(receptionsTable.status, "received")));
    const [receptionsInspection] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), eq(receptionsTable.status, "in_inspection")));
    const [receptionsCompleted] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), eq(receptionsTable.status, "inspection_completed")));
    const [receptionsWaiting] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), eq(receptionsTable.status, "waiting_quote_approval")));
    const [receptionsReadyForOT] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), eq(receptionsTable.status, "ready_for_work_order")));
    const [receptionsTotal] = await db.select({ c: count() }).from(receptionsTable)
      .where(and(eq(receptionsTable.active, true), inArray(receptionsTable.status, ["received", "in_inspection", "inspection_completed", "waiting_quote_approval", "ready_for_work_order"])));

    // Work order counters
    const activeWOStatuses = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"] as const;
    const [woTotalActive] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), inArray(workOrdersTable.status, activeWOStatuses as any)));
    const [woReadyToWork] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), eq(workOrdersTable.status, "ready_to_work")));
    const [woInProgress] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), eq(workOrdersTable.status, "in_progress")));
    const [woQualityControl] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), eq(workOrdersTable.status, "quality_control")));
    const [woReadyForPickup] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), eq(workOrdersTable.status, "ready_for_pickup")));
    const [woNoMechanic] = await db.select({ c: count() }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), isNull(workOrdersTable.mechanicId), inArray(workOrdersTable.status, activeWOStatuses as any)));

    res.json({
      activeClients: Number(clientsResult?.c ?? 0),
      totalBicycles: Number(bicyclesResult?.c ?? 0),
      activeServices: Number(servicesResult?.c ?? 0),
      activeMechanics: Number(mechanicsResult?.c ?? 0),
      quotesDraft: Number(draftResult?.c ?? 0),
      quotesSent: Number(sentResult?.c ?? 0),
      quotesApproved: Number(approvedResult?.c ?? 0),
      quotesPendingApproval: Number(sentResult?.c ?? 0) + Number(partialResult?.c ?? 0) + Number(updatedSentResult?.c ?? 0),
      receptionsReceived: Number(receptionsReceived?.c ?? 0),
      receptionsInInspection: Number(receptionsInspection?.c ?? 0),
      receptionsInspectionCompleted: Number(receptionsCompleted?.c ?? 0),
      receptionsTotalActive: Number(receptionsTotal?.c ?? 0),
      receptionsEsperandoAprobacion: Number(receptionsWaiting?.c ?? 0),
      receptionsListasParaOT: Number(receptionsReadyForOT?.c ?? 0),
      workOrdersTotalActive: Number(woTotalActive?.c ?? 0),
      workOrdersReadyToWork: Number(woReadyToWork?.c ?? 0),
      workOrdersInProgress: Number(woInProgress?.c ?? 0),
      workOrdersQualityControl: Number(woQualityControl?.c ?? 0),
      workOrdersReadyForPickup: Number(woReadyForPickup?.c ?? 0),
      workOrdersNoMechanic: Number(woNoMechanic?.c ?? 0),
    });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
