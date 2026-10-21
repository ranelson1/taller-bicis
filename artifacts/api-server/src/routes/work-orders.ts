import { Router } from "express";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  workOrderItemsTable,
  workOrderChecklistItemsTable,
  quotesTable,
  quoteItemsTable,
  receptionsTable,
  clientsTable,
  bicyclesTable,
  usersTable,
  timelineEventsTable,
  serviceStepsTable,
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, asc, count, inArray, isNull, not } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { triggerWorkCaseRecalc, logWorkCaseEvent, createWorkOrderFromQuoteInternal, recalcOTTotal } from "../helpers/workCase";

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextWorkOrderNumber(): Promise<string> {
  const [row] = await db.select({ n: count() }).from(workOrdersTable);
  const seq = Number(row?.n ?? 0) + 1;
  return `OT-${String(seq).padStart(4, "0")}`;
}

async function enrichWorkOrder(wo: typeof workOrdersTable.$inferSelect) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, wo.clientId));
  const [bike] = await db.select({ brand: bicyclesTable.brand, model: bicyclesTable.model })
    .from(bicyclesTable).where(eq(bicyclesTable.id, wo.bicycleId));
  let mechanicName: string | null = null;
  if (wo.mechanicId) {
    const [mech] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, wo.mechanicId));
    mechanicName = mech?.name ?? null;
  }
  let quoteNumber: string | null = null;
  if (wo.quoteId) {
    const [q] = await db.select({ quoteNumber: quotesTable.quoteNumber }).from(quotesTable).where(eq(quotesTable.id, wo.quoteId));
    quoteNumber = q?.quoteNumber ?? null;
  }
  let receptionNumber: string | null = null;
  if (wo.receptionId) {
    const [r] = await db.select({ receptionNumber: receptionsTable.receptionNumber }).from(receptionsTable).where(eq(receptionsTable.id, wo.receptionId));
    receptionNumber = r?.receptionNumber ?? null;
  }
  let workCaseNumber: string | null = null;
  if (wo.workCaseId) {
    const { workCasesTable: wct } = await import("@workspace/db");
    const [wc] = await db.select({ workCaseNumber: wct.workCaseNumber }).from(wct).where(eq(wct.id, wo.workCaseId));
    workCaseNumber = wc?.workCaseNumber ?? null;
  }
  return {
    ...wo,
    clientName: client?.name ?? null,
    bicycleName: bike ? `${bike.brand} ${bike.model}` : null,
    mechanicName,
    quoteNumber,
    receptionNumber,
    workCaseNumber,
    total: wo.total ? Number(wo.total) : 0,
    estimatedLaborHours: wo.estimatedLaborHours ? Number(wo.estimatedLaborHours) : 0,
    progressPercentage: wo.progressPercentage ? Number(wo.progressPercentage) : 0,
  };
}

async function logEvent(entityId: number, action: string, userId: number | null, previousStatus?: string, newStatus?: string, comment?: string) {
  await db.insert(timelineEventsTable).values({
    entityType: "work_order",
    entityId,
    userId,
    action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    comment: comment ?? null,
  });
}

async function recalcProgress(workOrderId: number) {
  const items = await db.select().from(workOrderChecklistItemsTable)
    .where(and(eq(workOrderChecklistItemsTable.workOrderId, workOrderId), eq(workOrderChecklistItemsTable.active, true)));

  const applicable = items.filter(i => i.status !== "not_applicable");
  const completed = applicable.filter(i => i.status === "completed" || i.status === "with_observation");

  const pct = applicable.length === 0 ? 0 : Math.round((completed.length / applicable.length) * 100);

  await db.update(workOrdersTable)
    .set({ progressPercentage: String(pct), updatedAt: new Date() })
    .where(eq(workOrdersTable.id, workOrderId));
}

// ── POST /work-orders/from-quote/:quoteId ─────────────────────────────────────
router.post("/from-quote/:quoteId", async (req, res) => {
  const quoteId = parseInt(req.params.quoteId);
  const userId = (req.session as any)?.userId ?? null;

  const bodySchema = z.object({
    mechanicId: z.number().int().optional().nullable(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    estimatedDeliveryDate: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    customerNotes: z.string().optional().nullable(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  try {
    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!quote) {
      res.status(404).json({ error: "Presupuesto no encontrado" });
      return;
    }
    if (!["approved", "partially_approved", "ready_for_work_order"].includes(quote.status)) {
      res.status(400).json({ error: "El presupuesto debe estar aprobado o listo para OT para crear una orden de trabajo" });
      return;
    }
    if (!quote.bicycleId) {
      res.status(400).json({ error: "El presupuesto debe tener una bicicleta asociada" });
      return;
    }

    // Check no active OT for this quote
    const [existing] = await db.select({ id: workOrdersTable.id }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quoteId), eq(workOrdersTable.active, true)));
    if (existing) {
      res.status(400).json({ error: "Ya existe una orden de trabajo activa para este presupuesto" });
      return;
    }

    // Get approved items
    const approvedItems = await db.select().from(quoteItemsTable)
      .where(and(
        eq(quoteItemsTable.quoteId, quoteId),
        eq(quoteItemsTable.active, true),
        eq(quoteItemsTable.approvalStatus, "approved"),
      ));

    if (approvedItems.length === 0) {
      res.status(400).json({ error: "No hay ítems aprobados en este presupuesto" });
      return;
    }

    // Create the OT atomically (all-or-nothing) via shared helper
    const created = await db.transaction((tx) =>
      createWorkOrderFromQuoteInternal(tx, quoteId, {
        mechanicId: body.mechanicId ?? null,
        priority: body.priority,
        estimatedDeliveryDate: body.estimatedDeliveryDate ?? null,
        internalNotes: body.internalNotes ?? null,
        customerNotes: body.customerNotes ?? null,
      }, userId),
    );

    // Recalc TR status after commit
    if (created.workCaseId) {
      await triggerWorkCaseRecalc(created.workCaseId, userId);
    }

    const [freshWo2] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, created.id));
    if (!freshWo2) { res.status(500).json({ error: "Internal server error" }); return; }
    res.status(201).json(await enrichWorkOrder(freshWo2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/from-reception/:receptionId ────────────────────────────
router.post("/from-reception/:receptionId", async (req, res) => {
  const receptionId = parseInt(req.params.receptionId);
  const userId = (req.session as any)?.userId ?? null;

  const bodySchema = z.object({
    mechanicId: z.number().int().optional().nullable(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    estimatedDeliveryDate: z.string().optional().nullable(),
    internalNotes: z.string().optional().nullable(),
    customerNotes: z.string().optional().nullable(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  try {
    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, receptionId));
    if (!reception) {
      res.status(404).json({ error: "Recepción no encontrada" });
      return;
    }
    if (!reception.quoteId) {
      res.status(400).json({ error: "La recepción no tiene presupuesto asociado" });
      return;
    }

    // Delegate to quote-based creation logic by calling the same DB logic
    const quoteId = reception.quoteId;

    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!quote) {
      res.status(404).json({ error: "Presupuesto no encontrado" });
      return;
    }
    if (!["approved", "partially_approved", "ready_for_work_order"].includes(quote.status)) {
      res.status(400).json({ error: "El presupuesto debe estar aprobado para crear una orden de trabajo" });
      return;
    }

    const [existing] = await db.select({ id: workOrdersTable.id }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quoteId), eq(workOrdersTable.active, true)));
    if (existing) {
      res.status(400).json({ error: "Ya existe una orden de trabajo activa para este presupuesto" });
      return;
    }

    const approvedItems = await db.select().from(quoteItemsTable)
      .where(and(
        eq(quoteItemsTable.quoteId, quoteId),
        eq(quoteItemsTable.active, true),
        eq(quoteItemsTable.approvalStatus, "approved"),
      ));

    if (approvedItems.length === 0) {
      res.status(400).json({ error: "No hay ítems aprobados en el presupuesto asociado" });
      return;
    }

    const workOrderNumber = await nextWorkOrderNumber();
    const totalValue = approvedItems.reduce((sum, i) => sum + Number(i.total), 0);
    const laborHours = approvedItems.reduce((sum, i) => sum + (i.estimatedLaborHours ? Number(i.estimatedLaborHours) : 0), 0);

    const [wo] = await db.insert(workOrdersTable).values({
      workOrderNumber,
      quoteId,
      receptionId,
      clientId: quote.clientId,
      bicycleId: quote.bicycleId!,
      mechanicId: body.mechanicId ?? null,
      priority: body.priority ?? "normal",
      internalNotes: body.internalNotes ?? null,
      customerNotes: body.customerNotes ?? null,
      estimatedDeliveryDate: body.estimatedDeliveryDate ? new Date(body.estimatedDeliveryDate) : null,
      total: String(totalValue),
      estimatedLaborHours: String(laborHours),
    }).returning();

    for (let i = 0; i < approvedItems.length; i++) {
      const qi = approvedItems[i];
      await db.insert(workOrderItemsTable).values({
        workOrderId: wo.id,
        quoteItemId: qi.id,
        itemType: qi.itemType,
        description: qi.description,
        quantity: qi.quantity,
        unitPrice: qi.unitPrice,
        total: qi.total,
        estimatedLaborHours: qi.estimatedLaborHours ?? null,
        sortOrder: i,
      });

      if (qi.serviceId) {
        const steps = await db.select().from(serviceStepsTable)
          .where(and(eq(serviceStepsTable.serviceId, qi.serviceId), eq(serviceStepsTable.active, true)))
          .orderBy(asc(serviceStepsTable.order));

        const [woItem] = await db.select({ id: workOrderItemsTable.id }).from(workOrderItemsTable)
          .where(and(eq(workOrderItemsTable.workOrderId, wo.id), eq(workOrderItemsTable.quoteItemId, qi.id)));

        for (let j = 0; j < steps.length; j++) {
          const step = steps[j];
          await db.insert(workOrderChecklistItemsTable).values({
            workOrderId: wo.id,
            workOrderItemId: woItem?.id ?? null,
            serviceStepId: step.id,
            description: step.description,
            sortOrder: j,
          });
        }
      }
    }

    // Update quote status and work_order_id
    await db.update(quotesTable)
      .set({ status: "converted_to_work_order", workOrderId: wo.id, updatedAt: new Date() })
      .where(eq(quotesTable.id, quoteId));

    // Inherit TR from quote (preferred) or reception, link WO to it
    const woWorkCaseId = quote.workCaseId ?? reception.workCaseId;
    if (woWorkCaseId) {
      await db.update(workOrdersTable).set({ workCaseId: woWorkCaseId, updatedAt: new Date() }).where(eq(workOrdersTable.id, wo.id));
      await logWorkCaseEvent(woWorkCaseId, "work_order_linked_to_work_case", userId, undefined, undefined, `Orden ${wo.workOrderNumber} vinculada`, "work_order", wo.id);
      await triggerWorkCaseRecalc(woWorkCaseId, userId);
    }

    // Update reception work_order_id
    await db.update(receptionsTable)
      .set({ workOrderId: wo.id, updatedAt: new Date() })
      .where(eq(receptionsTable.id, receptionId));

    await logEvent(wo.id, "work_order_created", userId, undefined, "ready_to_work");

    // Re-fetch to get fresh workCaseId in response
    const [freshWo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, wo.id));
    res.status(201).json(await enrichWorkOrder(freshWo ?? wo));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /work-orders/:id (soft-delete) ─────────────────────────────────────
router.delete("/from-quote/:quoteId", (req, res) => { res.status(400).json({ error: "Use DELETE /work-orders/:id" }); });
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }
    const [updated] = await db.update(workOrdersTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(workOrdersTable.id, id))
      .returning();
    await logEvent(id, "work_order_deleted", userId);
    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders ──────────────────────────────────────────────────────────
const listSchema = z.object({
  status: z.string().optional(),
  mechanicId: z.coerce.number().int().optional(),
  clientId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
});

router.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { status, mechanicId, clientId, search, dateFrom, dateTo, active } = parsed.data;

  try {
    let rows = await db.select().from(workOrdersTable)
      .where(
        and(
          active !== "false" ? eq(workOrdersTable.active, true) : undefined,
          status ? eq(workOrdersTable.status, status as any) : undefined,
          mechanicId ? eq(workOrdersTable.mechanicId, mechanicId) : undefined,
          clientId ? eq(workOrdersTable.clientId, clientId) : undefined,
          dateFrom ? gte(workOrdersTable.createdAt, new Date(dateFrom)) : undefined,
          dateTo ? lte(workOrdersTable.createdAt, new Date(dateTo)) : undefined,
        )
      )
      .orderBy(desc(workOrdersTable.createdAt));

    const enriched = await Promise.all(rows.map(enrichWorkOrder));

    // Filter by search (client name, bicycle name, work order number)
    const filtered = search
      ? enriched.filter(wo =>
          wo.workOrderNumber.toLowerCase().includes(search.toLowerCase()) ||
          (wo.clientName ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (wo.bicycleName ?? "").toLowerCase().includes(search.toLowerCase())
        )
      : enriched;

    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }
    const enriched = await enrichWorkOrder(wo);

    const items = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.workOrderId, id), eq(workOrderItemsTable.active, true)))
      .orderBy(asc(workOrderItemsTable.sortOrder));

    const checklist = await db.select().from(workOrderChecklistItemsTable)
      .where(and(eq(workOrderChecklistItemsTable.workOrderId, id), eq(workOrderChecklistItemsTable.active, true)))
      .orderBy(asc(workOrderChecklistItemsTable.sortOrder));

    // Enrich checklist with completed-by name
    const enrichedChecklist = await Promise.all(checklist.map(async (ci) => {
      let completedByName: string | null = null;
      if (ci.completedByUserId) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ci.completedByUserId));
        completedByName = u?.name ?? null;
      }
      return { ...ci, completedByName };
    }));

    res.json({
      ...enriched,
      items: items.map(i => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), total: Number(i.total), estimatedLaborHours: i.estimatedLaborHours ? Number(i.estimatedLaborHours) : null })),
      checklist: enrichedChecklist,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /work-orders/:id ────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const bodySchema = z.object({
    mechanicId: z.number().int().nullable().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    estimatedDeliveryDate: z.string().nullable().optional(),
    internalNotes: z.string().nullable().optional(),
    customerNotes: z.string().nullable().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    if (parsed.data.mechanicId !== undefined) updates.mechanicId = parsed.data.mechanicId;
    if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
    if (parsed.data.estimatedDeliveryDate !== undefined) {
      updates.estimatedDeliveryDate = parsed.data.estimatedDeliveryDate ? new Date(parsed.data.estimatedDeliveryDate) : null;
    }
    if (parsed.data.internalNotes !== undefined) updates.internalNotes = parsed.data.internalNotes;
    if (parsed.data.customerNotes !== undefined) updates.customerNotes = parsed.data.customerNotes;

    const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();
    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/status ──────────────────────────────────────────────
router.post("/:id/status", async (req, res) => {
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;

  const bodySchema = z.object({
    status: z.enum(["ready_to_work", "in_progress", "quality_control", "ready_for_pickup", "delivered", "cancelled"]),
    comment: z.string().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }

    const now = new Date();

    // Cascade: when advancing to ready_for_pickup, complete all pending items and their checklists
    if (parsed.data.status === "ready_for_pickup") {
      const TERMINAL_CHECKLIST = ["completed", "with_observation", "not_applicable"] as const;
      await db.update(workOrderChecklistItemsTable)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(and(
          eq(workOrderChecklistItemsTable.workOrderId, id),
          eq(workOrderChecklistItemsTable.active, true),
          not(inArray(workOrderChecklistItemsTable.status, TERMINAL_CHECKLIST))
        ));
      await db.update(workOrderItemsTable)
        .set({ status: "completed", updatedAt: now })
        .where(and(
          eq(workOrderItemsTable.workOrderId, id),
          not(inArray(workOrderItemsTable.status, ["completed", "cancelled"] as const))
        ));
      await recalcProgress(id);
    }

    const updates: any = { status: parsed.data.status, updatedAt: now };
    if (parsed.data.status === "in_progress" && !wo.startedAt) updates.startedAt = now;
    if (parsed.data.status === "ready_for_pickup") updates.completedAt = now;
    if (parsed.data.status === "delivered") updates.deliveredAt = now;

    const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();
    await logEvent(id, `status_changed`, userId, wo.status, parsed.data.status, parsed.data.comment);
    await triggerWorkCaseRecalc(wo.workCaseId, userId);

    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/cancel ──────────────────────────────────────────────
router.post("/:id/cancel", async (req, res) => {
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;
  const { comment } = req.body ?? {};

  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }
    if (wo.status === "cancelled") {
      res.status(400).json({ error: "La orden ya está cancelada" });
      return;
    }

    const [updated] = await db.update(workOrdersTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(workOrdersTable.id, id))
      .returning();

    await logEvent(id, "work_order_cancelled", userId, wo.status, "cancelled", comment);
    await triggerWorkCaseRecalc(wo.workCaseId, userId);
    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/assign-mechanic ─────────────────────────────────────
router.post("/:id/assign-mechanic", async (req, res) => {
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;

  const bodySchema = z.object({ mechanicId: z.number().int().nullable() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }

    const [updated] = await db.update(workOrdersTable)
      .set({ mechanicId: parsed.data.mechanicId, updatedAt: new Date() })
      .where(eq(workOrdersTable.id, id))
      .returning();

    await logEvent(id, "mechanic_assigned", userId);
    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id/checklist ────────────────────────────────────────────
router.get("/:id/checklist", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const items = await db.select().from(workOrderChecklistItemsTable)
      .where(and(eq(workOrderChecklistItemsTable.workOrderId, id), eq(workOrderChecklistItemsTable.active, true)))
      .orderBy(asc(workOrderChecklistItemsTable.sortOrder));

    const enriched = await Promise.all(items.map(async (ci) => {
      let completedByName: string | null = null;
      if (ci.completedByUserId) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ci.completedByUserId));
        completedByName = u?.name ?? null;
      }
      return { ...ci, completedByName };
    }));

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /work-orders/:id/checklist/:checklistItemId ─────────────────────────
router.patch("/:id/checklist/:checklistItemId", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const checklistItemId = parseInt(req.params.checklistItemId);
  const userId = (req.session as any)?.userId ?? null;

  const bodySchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "not_applicable", "with_observation"]),
    mechanicNote: z.string().nullable().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [ci] = await db.select().from(workOrderChecklistItemsTable)
      .where(and(eq(workOrderChecklistItemsTable.id, checklistItemId), eq(workOrderChecklistItemsTable.workOrderId, workOrderId)));
    if (!ci) {
      res.status(404).json({ error: "Ítem de checklist no encontrado" });
      return;
    }

    const now = new Date();
    const isDone = ["completed", "with_observation", "not_applicable"].includes(parsed.data.status);
    const updates: any = {
      status: parsed.data.status,
      updatedAt: now,
      mechanicNote: parsed.data.mechanicNote !== undefined ? parsed.data.mechanicNote : ci.mechanicNote,
    };
    if (isDone) {
      updates.completedByUserId = userId;
      updates.completedAt = now;
    } else {
      updates.completedByUserId = null;
      updates.completedAt = null;
    }

    const [updated] = await db.update(workOrderChecklistItemsTable)
      .set(updates)
      .where(eq(workOrderChecklistItemsTable.id, checklistItemId))
      .returning();

    await recalcProgress(workOrderId);

    // Cascade: if all checklist items for the parent service item are terminal, complete the parent
    if (ci.workOrderItemId != null) {
      const TERMINAL_CHECKLIST = ["completed", "with_observation", "not_applicable"] as const;
      const siblings = await db.select()
        .from(workOrderChecklistItemsTable)
        .where(and(
          eq(workOrderChecklistItemsTable.workOrderItemId, ci.workOrderItemId),
          eq(workOrderChecklistItemsTable.active, true)
        ));
      if (siblings.length > 0 && siblings.every(s => (TERMINAL_CHECKLIST as readonly string[]).includes(s.status))) {
        await db.update(workOrderItemsTable)
          .set({ status: "completed", updatedAt: now })
          .where(and(
            eq(workOrderItemsTable.id, ci.workOrderItemId),
            not(inArray(workOrderItemsTable.status, ["completed", "cancelled"]))
          ));
      }
    }

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id/timeline ─────────────────────────────────────────────
router.get("/:id/timeline", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const events = await db.select().from(timelineEventsTable)
      .where(and(eq(timelineEventsTable.entityType, "work_order"), eq(timelineEventsTable.entityId, id)))
      .orderBy(desc(timelineEventsTable.createdAt));

    const enriched = await Promise.all(events.map(async (ev) => {
      let userName: string | null = null;
      if (ev.userId) {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, ev.userId));
        userName = u?.name ?? null;
      }
      return { ...ev, userName };
    }));

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id/items ────────────────────────────────────────────────
router.get("/:id/items", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  try {
    const items = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.workOrderId, workOrderId), eq(workOrderItemsTable.active, true)))
      .orderBy(asc(workOrderItemsTable.sortOrder));
    res.json(items.map(i => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), total: Number(i.total), estimatedLaborHours: i.estimatedLaborHours ? Number(i.estimatedLaborHours) : null })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/items/:itemId/start ──────────────────────────────────
router.post("/:id/items/:itemId/start", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [item] = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.id, itemId), eq(workOrderItemsTable.workOrderId, workOrderId)));
    if (!item) { res.status(404).json({ error: "Ítem no encontrado" }); return; }
    const [updated] = await db.update(workOrderItemsTable)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(workOrderItemsTable.id, itemId))
      .returning();
    await logEvent(workOrderId, "item_started", userId, item.status, "in_progress");
    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/items/:itemId/complete ───────────────────────────────
router.post("/:id/items/:itemId/complete", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [item] = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.id, itemId), eq(workOrderItemsTable.workOrderId, workOrderId)));
    if (!item) { res.status(404).json({ error: "Ítem no encontrado" }); return; }
    const [updated] = await db.update(workOrderItemsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(workOrderItemsTable.id, itemId))
      .returning();
    await recalcOTTotal(workOrderId, userId);
    await logEvent(workOrderId, "item_completed", userId, item.status, "completed");
    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/items/:itemId/cancel ────────────────────────────────
router.post("/:id/items/:itemId/cancel", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [item] = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.id, itemId), eq(workOrderItemsTable.workOrderId, workOrderId)));
    if (!item) { res.status(404).json({ error: "Ítem no encontrado" }); return; }
    const [updated] = await db.update(workOrderItemsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(workOrderItemsTable.id, itemId))
      .returning();
    await logEvent(workOrderId, "item_cancelled", userId, item.status, "cancelled");
    await recalcOTTotal(workOrderId, userId);
    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /work-orders/:id/items/:itemId ──────────────────────────────────────
router.patch("/:id/items/:itemId", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);

  const bodySchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [item] = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.id, itemId), eq(workOrderItemsTable.workOrderId, workOrderId)));
    if (!item) {
      res.status(404).json({ error: "Ítem no encontrado" });
      return;
    }

    const [updated] = await db.update(workOrderItemsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(workOrderItemsTable.id, itemId))
      .returning();

    // Cascade: when service is marked completed, auto-complete all its non-terminal checklist items
    if (parsed.data.status === "completed") {
      const TERMINAL_CHECKLIST = ["completed", "with_observation", "not_applicable"] as const;
      await db.update(workOrderChecklistItemsTable)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(workOrderChecklistItemsTable.workOrderItemId, itemId),
          eq(workOrderChecklistItemsTable.active, true),
          not(inArray(workOrderChecklistItemsTable.status, TERMINAL_CHECKLIST))
        ));
      await recalcProgress(workOrderId);
    }

    if (parsed.data.status !== undefined) {
      await recalcOTTotal(workOrderId, (req.session as any)?.userId ?? null);
    }

    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
