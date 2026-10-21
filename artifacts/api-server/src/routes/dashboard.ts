import { Router } from "express";
import { db } from "@workspace/db";
import { clientsTable, bicyclesTable, servicesTable, usersTable, quotesTable, receptionsTable, workOrdersTable } from "@workspace/db";
import { and, eq, count, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/summary", async (_req, res) => {
  try {
    const [clientsResult] = await db.select({ c: count() }).from(clientsTable).where(eq(clientsTable.active, true));
    const [bicyclesResult] = await db.select({ c: count() }).from(bicyclesTable).where(eq(bicyclesTable.active, true));
    const [servicesResult] = await db.select({ c: count() }).from(servicesTable).where(eq(servicesTable.active, true));
    const [mechanicsResult] = await db.select({ c: count() }).from(usersTable)
      .where(and(eq(usersTable.active, true), eq(usersTable.role, "mechanic")));

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
