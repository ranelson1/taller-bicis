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
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, asc, count, inArray, isNull, not } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { triggerWorkCaseRecalc, createWorkOrderFromQuoteInternal, recalcOTTotal, isUniqueViolation } from "../helpers/workCase";
import {
  buildPublicWorkOrder, decideWorkOrderItem, ensurePublicToken, formatCLP, ItemDecisionError, logWorkOrderEvent, shareMessage,
} from "../helpers/workOrderPublic";

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Transiciones permitidas de la OT. Retroceder un paso está permitido para
// corregir errores; una OT entregada o cancelada ya no cambia.
const WO_TRANSITIONS: Record<string, string[]> = {
  ready_to_work: ["in_progress", "cancelled"],
  in_progress: ["quality_control", "ready_for_pickup", "ready_to_work", "cancelled"],
  quality_control: ["ready_for_pickup", "in_progress", "cancelled"],
  ready_for_pickup: ["delivered", "in_progress"],
  delivered: [],
  cancelled: [],
};

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

// Progreso de la OT: por checklist si tiene pasos; si no, por ítems aprobados
// completados. Una OT terminada siempre es 100%.
export async function recalcProgress(workOrderId: number) {
  const [wo] = await db.select({ status: workOrdersTable.status }).from(workOrdersTable)
    .where(eq(workOrdersTable.id, workOrderId));

  const checklist = await db.select().from(workOrderChecklistItemsTable)
    .where(and(eq(workOrderChecklistItemsTable.workOrderId, workOrderId), eq(workOrderChecklistItemsTable.active, true)));
  const applicable = checklist.filter(i => i.status !== "not_applicable");

  let pct: number;
  if (wo && ["ready_for_pickup", "delivered"].includes(wo.status)) {
    pct = 100;
  } else if (applicable.length > 0) {
    const completed = applicable.filter(i => i.status === "completed" || i.status === "with_observation");
    pct = Math.round((completed.length / applicable.length) * 100);
  } else {
    const items = (await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.workOrderId, workOrderId), eq(workOrderItemsTable.active, true))))
      .filter(i => i.status !== "cancelled" && i.approvalStatus === "approved" && i.itemType !== "discount");
    const done = items.filter(i => i.status === "completed").length;
    pct = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  }

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
    if (isUniqueViolation(e)) { res.status(409).json({ error: "Ya existe una orden de trabajo activa para este presupuesto" }); return; }
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

    const created = await db.transaction(async (tx) => {
      const wo = await createWorkOrderFromQuoteInternal(tx, quoteId, {
        mechanicId: body.mechanicId ?? null,
        priority: body.priority,
        estimatedDeliveryDate: body.estimatedDeliveryDate ?? null,
        internalNotes: body.internalNotes ?? null,
        customerNotes: body.customerNotes ?? null,
      }, userId);
      // La recepción de origen manda sobre la que el helper encuentra por quoteId,
      // y el TR se hereda del presupuesto o, si no tiene, de la recepción.
      const woWorkCaseId = quote.workCaseId ?? reception.workCaseId ?? null;
      await tx.update(workOrdersTable)
        .set({ receptionId, workCaseId: woWorkCaseId, updatedAt: new Date() })
        .where(eq(workOrdersTable.id, wo.id));
      await tx.update(receptionsTable)
        .set({ workOrderId: wo.id, updatedAt: new Date() })
        .where(eq(receptionsTable.id, receptionId));
      return { ...wo, workCaseId: woWorkCaseId };
    });
    if (created.workCaseId) await triggerWorkCaseRecalc(created.workCaseId, userId);
    const wo = { id: created.id };

    // Re-fetch to get fresh workCaseId in response
    const [freshWo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, wo.id));
    res.status(201).json(await enrichWorkOrder(freshWo));
  } catch (e) {
    if (isUniqueViolation(e)) { res.status(409).json({ error: "Ya existe una orden de trabajo activa para este presupuesto" }); return; }
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

    const target = parsed.data.status;
    if (target !== wo.status && !(WO_TRANSITIONS[wo.status] ?? []).includes(target)) {
      res.status(400).json({ error: `No se puede pasar de "${wo.status}" a "${target}"` });
      return;
    }
    if (target === "in_progress" && !wo.mechanicId) {
      res.status(400).json({ error: "Debes asignar un mecánico antes de iniciar el trabajo." });
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

    await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id));
    await recalcProgress(id);
    await logEvent(id, `status_changed`, userId, wo.status, parsed.data.status, parsed.data.comment);
    await triggerWorkCaseRecalc(wo.workCaseId, userId);

    const [updated] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
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
    if (wo.status === "cancelled" || wo.status === "delivered") {
      res.status(400).json({ error: wo.status === "cancelled" ? "La orden ya está cancelada" : "No se puede cancelar una orden entregada" });
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

    await recalcProgress(workOrderId);
    const [woForTr] = await db.select({ workCaseId: workOrdersTable.workCaseId }).from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    await triggerWorkCaseRecalc(woForTr?.workCaseId, userId);

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

// ── POST /work-orders/:id/items ───────────────────────────────────────────────
// Adicional sobre la OT. Queda pendiente de aprobación del cliente salvo que el
// taller indique que ya lo aprobó por otro medio.
router.post("/:id/items", async (req, res) => {
  const workOrderId = Number(req.params.id);
  const userId = (req.session as any)?.userId ?? null;
  const parsed = z.object({
    itemType: z.enum(["service", "part", "additional_labor", "diagnosis", "discount", "other"]),
    description: z.string().trim().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    serviceId: z.number().int().positive().nullable().optional(),
    partId: z.number().int().positive().nullable().optional(),
    alreadyApproved: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success || !Number.isInteger(workOrderId)) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error?.issues }); return;
  }
  const data = parsed.data;

  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    if (!wo || !wo.active) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    if (wo.status === "delivered" || wo.status === "cancelled") {
      res.status(400).json({ error: "La orden ya está cerrada" }); return;
    }

    const [last] = await db.select({ s: workOrderItemsTable.sortOrder }).from(workOrderItemsTable)
      .where(eq(workOrderItemsTable.workOrderId, workOrderId))
      .orderBy(desc(workOrderItemsTable.sortOrder)).limit(1);
    const total = data.quantity * data.unitPrice;
    const now = new Date();
    const [item] = await db.insert(workOrderItemsTable).values({
      workOrderId,
      itemType: data.itemType,
      description: data.description,
      quantity: String(data.quantity),
      unitPrice: String(data.unitPrice),
      total: String(total),
      origin: "additional",
      approvalStatus: data.alreadyApproved ? "approved" : "pending",
      approvalDecidedAt: data.alreadyApproved ? now : null,
      approvalDecidedBy: data.alreadyApproved ? "staff" : null,
      sortOrder: (last?.s ?? 0) + 1,
    }).returning();

    await logWorkOrderEvent(workOrderId, "additional_item_added", userId, {
      newStatus: item.approvalStatus,
      comment: `${data.description} (${data.itemType === "discount" ? "-" : ""}${formatCLP(total)})`,
      visibleToClient: true,
    });
    await recalcProgress(workOrderId);
    await recalcOTTotal(workOrderId, userId);

    res.status(201).json({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), total: Number(item.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/items/:itemId/approval ──────────────────────────────
// El taller registra la decisión del cliente (p.ej. aprobó por teléfono).
router.post("/:id/items/:itemId/approval", async (req, res) => {
  const workOrderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const userId = (req.session as any)?.userId ?? null;
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Decisión inválida" }); return; }
  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    if (!wo) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    const item = await decideWorkOrderItem(wo, itemId, parsed.data.decision, "staff", userId);
    await recalcProgress(workOrderId);
    res.json({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), total: Number(item.total) });
  } catch (e) {
    if (e instanceof ItemDecisionError) { res.status(400).json({ error: e.message }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/share ───────────────────────────────────────────────
router.post("/:id/share", async (req, res) => {
  const workOrderId = Number(req.params.id);
  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    if (!wo || !wo.active) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    const token = await ensurePublicToken(wo);
    const view = await buildPublicWorkOrder({ ...wo, publicToken: token });
    const [client] = await db.select({ phone: clientsTable.phone }).from(clientsTable).where(eq(clientsTable.id, wo.clientId));
    res.json({
      token,
      path: `/ot/${token}`,
      message: shareMessage(wo, view.clientName, view.pendingApprovalCount),
      clientPhone: client?.phone ?? null,
    });
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
    await recalcProgress(workOrderId);
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
    await recalcProgress(workOrderId);
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
      await recalcProgress(workOrderId);
      await recalcOTTotal(workOrderId, (req.session as any)?.userId ?? null);
    }

    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
