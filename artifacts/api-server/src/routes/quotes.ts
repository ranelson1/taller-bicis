import { Router } from "express";
import { db } from "@workspace/db";
import {
  quotesTable, quoteItemsTable, quoteVersionsTable, timelineEventsTable,
  clientsTable, bicyclesTable, servicesTable, partsTable, usersTable,
  workCasesTable, workOrdersTable, workOrderItemsTable,
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { autoCreateWorkCase, triggerWorkCaseRecalc, logWorkCaseEvent, recalcOTTotal } from "../helpers/workCase";

const router = Router();
router.use(requireAuth);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function recalcQuoteTotals(quoteId: number) {
  const items = await db.select().from(quoteItemsTable)
    .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)));

  let subtotal = 0;
  let discountTotal = 0;
  let laborHours = 0;

  for (const item of items) {
    const t = Number(item.total);
    if (item.itemType === "discount") {
      discountTotal += Math.abs(t);
    } else {
      subtotal += t;
    }
    if (item.estimatedLaborHours) laborHours += Number(item.estimatedLaborHours);
  }

  const total = subtotal - discountTotal;

  await db.update(quotesTable)
    .set({
      subtotal: String(subtotal),
      discountTotal: String(discountTotal),
      total: String(Math.max(0, total)),
      estimatedLaborHours: String(laborHours),
      updatedAt: new Date(),
    })
    .where(eq(quotesTable.id, quoteId));
}

async function determineQuoteStatus(quoteId: number, currentStatus: string): Promise<string | null> {
  const items = await db.select().from(quoteItemsTable)
    .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)));

  if (items.length === 0) return null;

  const allApproved = items.every(i => i.approvalStatus === "approved");
  const allRejected = items.every(i => i.approvalStatus === "rejected");
  const someApproved = items.some(i => i.approvalStatus === "approved");

  if (allApproved) return "approved";
  if (allRejected) return "rejected";
  if (someApproved) return "partially_approved";
  return null;
}

async function nextQuoteNumber(): Promise<string> {
  const [row] = await db.select({ n: count() }).from(quotesTable);
  const seq = (Number(row?.n ?? 0) + 1);
  return `P-${String(seq).padStart(4, "0")}`;
}

async function enrichQuote(q: typeof quotesTable.$inferSelect) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, q.clientId));
  let bicycleName: string | null = null;
  if (q.bicycleId) {
    const [bike] = await db.select({ brand: bicyclesTable.brand, model: bicyclesTable.model })
      .from(bicyclesTable).where(eq(bicyclesTable.id, q.bicycleId));
    if (bike) bicycleName = `${bike.brand} ${bike.model}`;
  }
  let workCaseNumber: string | null = null;
  if (q.workCaseId) {
    const { workCasesTable: wct } = await import("@workspace/db");
    const [wc] = await db.select({ workCaseNumber: wct.workCaseNumber }).from(wct).where(eq(wct.id, q.workCaseId));
    workCaseNumber = wc?.workCaseNumber ?? null;
  }
  return { ...q, clientName: client?.name ?? null, bicycleName, workCaseNumber };
}

async function logEvent(entityId: number, action: string, userId: number | null, previousStatus?: string, newStatus?: string, comment?: string) {
  await db.insert(timelineEventsTable).values({
    entityType: "quote", entityId, userId, action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    comment: comment ?? null,
  });
}

async function markQuoteUpdatedIfSent(quoteId: number, userId: number | null): Promise<void> {
  const [q] = await db.select({ status: quotesTable.status }).from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (q?.status === "sent") {
    await db.update(quotesTable)
      .set({ status: "updated_after_sent", updatedAt: new Date() })
      .where(eq(quotesTable.id, quoteId));
    await logEvent(quoteId, "quote_edited", userId, "sent", "updated_after_sent");
  }
}

// ── GET /quotes/summary ────────────────────────────────────────────────────
router.get("/summary", async (_req, res) => {
  try {
    const statuses = ["draft", "sent", "partially_approved", "approved", "rejected", "updated_after_sent", "ready_for_work_order"] as const;
    const rows = await db.select({ status: quotesTable.status, n: count() })
      .from(quotesTable)
      .where(eq(quotesTable.active, true))
      .groupBy(quotesTable.status);

    const map: Record<string, number> = {};
    for (const r of rows) map[r.status] = Number(r.n);

    res.json({
      draft: map["draft"] ?? 0,
      sent: map["sent"] ?? 0,
      approved: map["approved"] ?? 0,
      partiallyApproved: map["partially_approved"] ?? 0,
      rejected: map["rejected"] ?? 0,
      readyForWorkOrder: map["ready_for_work_order"] ?? 0,
      pendingApproval: (map["sent"] ?? 0) + (map["updated_after_sent"] ?? 0) + (map["partially_approved"] ?? 0),
    });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /quotes ────────────────────────────────────────────────────────────
const listSchema = z.object({
  status: z.string().optional(),
  clientId: z.coerce.number().int().optional(),
  originChannel: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

router.get("/", async (req, res) => {
  try {
    const q = listSchema.parse(req.query);
    const conditions: ReturnType<typeof eq>[] = [];

    if (q.active !== "false") conditions.push(eq(quotesTable.active, true));
    if (q.status) conditions.push(eq(quotesTable.status, q.status as any));
    if (q.clientId) conditions.push(eq(quotesTable.clientId, q.clientId));
    if (q.originChannel) conditions.push(eq(quotesTable.originChannel, q.originChannel));
    if (q.dateFrom) conditions.push(gte(quotesTable.createdAt, new Date(q.dateFrom)));
    if (q.dateTo) conditions.push(lte(quotesTable.createdAt, new Date(q.dateTo)));

    let rows = await db
      .select({
        q: quotesTable,
        clientName: clientsTable.name,
        bicycleBrand: bicyclesTable.brand,
        bicycleModel: bicyclesTable.model,
        workCaseNumber: workCasesTable.workCaseNumber,
      })
      .from(quotesTable)
      .leftJoin(clientsTable, eq(quotesTable.clientId, clientsTable.id))
      .leftJoin(bicyclesTable, eq(quotesTable.bicycleId, bicyclesTable.id))
      .leftJoin(workCasesTable, eq(quotesTable.workCaseId, workCasesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(quotesTable.createdAt));

    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(r =>
        r.q.quoteNumber.toLowerCase().includes(s) ||
        (r.clientName ?? "").toLowerCase().includes(s) ||
        (r.q.initialRequirement ?? "").toLowerCase().includes(s)
      );
    }

    const result = rows.map(r => ({
      ...r.q,
      clientName: r.clientName ?? null,
      bicycleName: r.bicycleBrand && r.bicycleModel ? `${r.bicycleBrand} ${r.bicycleModel}` : null,
      workCaseNumber: r.workCaseNumber ?? null,
    }));

    res.json(result);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /quotes ───────────────────────────────────────────────────────────
const createSchema = z.object({
  clientId: z.number().int(),
  bicycleId: z.number().int().nullable().optional(),
  originChannel: z.string().min(1),
  initialRequirement: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
});

router.post("/", async (req, res) => {
  try {
    const data = createSchema.parse(req.body);
    const quoteNumber = await nextQuoteNumber();
    const userId = (req.session as any).userId ?? null;

    // Create TR first so quote is always linked from creation
    const wcId = await autoCreateWorkCase(data.clientId, data.bicycleId ?? null, userId);

    const [quote] = await db.insert(quotesTable).values({
      quoteNumber,
      clientId: data.clientId,
      bicycleId: data.bicycleId ?? null,
      originChannel: data.originChannel,
      initialRequirement: data.initialRequirement ?? null,
      customerNotes: data.customerNotes ?? null,
      internalNotes: data.internalNotes ?? null,
      status: "draft",
      workCaseId: wcId,
    }).returning();

    await logEvent(quote.id, "quote_created", userId, undefined, "draft");
    await logWorkCaseEvent(wcId, "quote_linked_to_work_case", userId, undefined, undefined, `Presupuesto ${quoteNumber} vinculado`, "quote", quote.id);

    res.status(201).json(await enrichQuote(quote));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /quotes/:id ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!quote) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, id), eq(quoteItemsTable.active, true)))
      .orderBy(asc(quoteItemsTable.sortOrder), asc(quoteItemsTable.id));

    res.json({ ...(await enrichQuote(quote)), items });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── PATCH /quotes/:id ──────────────────────────────────────────────────────
const updateSchema = z.object({
  bicycleId: z.number().int().nullable().optional(),
  originChannel: z.string().optional(),
  initialRequirement: z.string().nullable().optional(),
  customerNotes: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const userId = (req.session as any).userId ?? null;

    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const wasAlreadySent = ["sent", "partially_approved", "approved", "rejected", "ready_for_work_order"].includes(existing.status);

    const [updated] = await db.update(quotesTable)
      .set({
        ...data,
        status: wasAlreadySent && existing.status === "sent" ? "updated_after_sent" : existing.status,
        updatedAt: new Date(),
      })
      .where(eq(quotesTable.id, id))
      .returning();

    if (wasAlreadySent && existing.status === "sent") {
      await logEvent(id, "quote_edited", userId, "sent", "updated_after_sent");
    } else {
      await logEvent(id, "quote_edited", userId);
    }

    res.json(await enrichQuote(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /quotes/:id ─────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(quotesTable).set({ active: false, updatedAt: new Date() }).where(eq(quotesTable.id, id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/send ──────────────────────────────────────────────────
router.post("/:id/send", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, id), eq(quoteItemsTable.active, true)));

    const newVersion = existing.currentVersion + (existing.sentAt ? 1 : 0);
    const previousStatus = existing.status;

    await db.insert(quoteVersionsTable).values({
      quoteId: id,
      versionNumber: newVersion,
      status: "sent",
      subtotal: existing.subtotal,
      discountTotal: existing.discountTotal,
      total: existing.total,
      estimatedLaborHours: existing.estimatedLaborHours,
      itemsSnapshot: items.map(i => ({
        id: i.id, description: i.description,
        quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), total: Number(i.total),
        itemType: i.itemType, approvalStatus: i.approvalStatus,
      })),
      customerNotesSnapshot: existing.customerNotes,
      internalNotesSnapshot: existing.internalNotes,
      sentAt: new Date(),
    });

    const [updated] = await db.update(quotesTable)
      .set({
        status: "sent",
        currentVersion: newVersion,
        sentAt: existing.sentAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(quotesTable.id, id))
      .returning();

    await logEvent(id, "quote_sent", userId, previousStatus, "sent");
    await triggerWorkCaseRecalc(existing.workCaseId, userId);

    res.json(await enrichQuote(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/approve ───────────────────────────────────────────────
router.post("/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Approve all pending items
    await db.update(quoteItemsTable)
      .set({ approvalStatus: "approved", updatedAt: new Date() })
      .where(and(eq(quoteItemsTable.quoteId, id), eq(quoteItemsTable.active, true), eq(quoteItemsTable.approvalStatus, "pending")));

    const [updated] = await db.update(quotesTable)
      .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotesTable.id, id))
      .returning();

    await logEvent(id, "quote_approved", userId, existing.status, "approved");
    await triggerWorkCaseRecalc(existing.workCaseId, userId);

    res.json(await enrichQuote(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/reject ────────────────────────────────────────────────
router.post("/:id/reject", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const body = z.object({ comment: z.string().optional() }).parse(req.body);
    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(quotesTable)
      .set({ status: "rejected", rejectedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotesTable.id, id))
      .returning();

    await logEvent(id, "quote_rejected", userId, existing.status, "rejected", body.comment);
    await triggerWorkCaseRecalc(existing.workCaseId, userId);

    res.json(await enrichQuote(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/mark-ready-for-work-order ────────────────────────────
router.post("/:id/mark-ready-for-work-order", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Validate at least one approved item
    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, id), eq(quoteItemsTable.active, true), eq(quoteItemsTable.approvalStatus, "approved")));

    if (items.length === 0) {
      res.status(400).json({ error: "El presupuesto necesita al menos un ítem aprobado." }); return;
    }

    const [updated] = await db.update(quotesTable)
      .set({ status: "ready_for_work_order", updatedAt: new Date() })
      .where(eq(quotesTable.id, id))
      .returning();

    await logEvent(id, "quote_ready_for_work_order", userId, existing.status, "ready_for_work_order");
    await triggerWorkCaseRecalc(existing.workCaseId, userId);

    res.json(await enrichQuote(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/items ─────────────────────────────────────────────────
const itemCreateSchema = z.object({
  itemType: z.enum(["service", "part", "additional_labor", "diagnosis", "recommendation", "discount", "other"]),
  origin: z.enum(["customer_request", "mechanic_recommendation", "visual_inspection", "during_work", "warranty_correction", "manual"]).optional(),
  description: z.string().min(1),
  quantity: z.number().min(0.001),
  unitPrice: z.number(),
  estimatedLaborHours: z.number().min(0).nullable().optional(),
  serviceId: z.number().int().nullable().optional(),
  partId: z.number().int().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

router.post("/:id/items", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const data = itemCreateSchema.parse(req.body);

    const total = data.quantity * data.unitPrice;

    // Get max sortOrder
    const existing = await db.select({ s: quoteItemsTable.sortOrder })
      .from(quoteItemsTable).where(eq(quoteItemsTable.quoteId, quoteId))
      .orderBy(desc(quoteItemsTable.sortOrder)).limit(1);
    const nextOrder = (existing[0]?.s ?? 0) + 1;

    const [item] = await db.insert(quoteItemsTable).values({
      quoteId,
      itemType: data.itemType,
      origin: data.origin ?? "manual",
      description: data.description,
      quantity: String(data.quantity),
      unitPrice: String(data.unitPrice),
      total: String(total),
      estimatedLaborHours: data.estimatedLaborHours != null ? String(data.estimatedLaborHours) : null,
      approvalStatus: "pending",
      serviceId: data.serviceId ?? null,
      partId: data.partId ?? null,
      sortOrder: data.sortOrder ?? nextOrder,
      active: true,
    }).returning();

    await recalcQuoteTotals(quoteId);
    await logEvent(quoteId, "item_added", userId, undefined, undefined, data.description);
    await markQuoteUpdatedIfSent(quoteId, userId);

    // Propagate new item to linked active OT
    const [activeOTForAdd] = await db.select({ id: workOrdersTable.id })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quoteId), eq(workOrdersTable.active, true)));
    if (activeOTForAdd) {
      const otExisting = await db.select({ s: workOrderItemsTable.sortOrder })
        .from(workOrderItemsTable)
        .where(eq(workOrderItemsTable.workOrderId, activeOTForAdd.id))
        .orderBy(desc(workOrderItemsTable.sortOrder))
        .limit(1);
      const nextOtOrder = (otExisting[0]?.s ?? 0) + 1;
      await db.insert(workOrderItemsTable).values({
        workOrderId: activeOTForAdd.id,
        quoteItemId: item.id,
        itemType: data.itemType,
        description: data.description,
        quantity: String(data.quantity),
        unitPrice: String(data.unitPrice),
        total: String(total),
        estimatedLaborHours: data.estimatedLaborHours != null ? String(data.estimatedLaborHours) : null,
        sortOrder: nextOtOrder,
      });
      await recalcOTTotal(activeOTForAdd.id, userId);
    }

    res.status(201).json(item);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /quotes/:id/items/:itemId ───────────────────────────────────────
const itemUpdateSchema = z.object({
  description: z.string().optional(),
  quantity: z.number().min(0.001).optional(),
  unitPrice: z.number().optional(),
  estimatedLaborHours: z.number().min(0).nullable().optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  sortOrder: z.number().int().optional(),
});

router.patch("/:id/items/:itemId", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const userId = (req.session as any).userId ?? null;
    const data = itemUpdateSchema.parse(req.body);

    const [existing] = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const newQty = data.quantity ?? Number(existing.quantity);
    const newPrice = data.unitPrice ?? Number(existing.unitPrice);
    const total = newQty * newPrice;

    const [updated] = await db.update(quoteItemsTable)
      .set({
        ...data,
        quantity: String(newQty),
        unitPrice: String(newPrice),
        total: String(total),
        estimatedLaborHours: data.estimatedLaborHours != null ? String(data.estimatedLaborHours) : existing.estimatedLaborHours,
        updatedAt: new Date(),
      })
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)))
      .returning();

    await recalcQuoteTotals(quoteId);
    await markQuoteUpdatedIfSent(quoteId, userId);

    // Update linked OT item and recalc OT if active OT exists
    const [activeOTForPatch] = await db.select({ id: workOrdersTable.id })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quoteId), eq(workOrdersTable.active, true)));
    if (activeOTForPatch) {
      await db.update(workOrderItemsTable)
        .set({ quantity: String(newQty), unitPrice: String(newPrice), total: String(total), updatedAt: new Date() })
        .where(and(
          eq(workOrderItemsTable.workOrderId, activeOTForPatch.id),
          eq(workOrderItemsTable.quoteItemId, itemId),
          eq(workOrderItemsTable.active, true),
        ));
      await recalcOTTotal(activeOTForPatch.id, userId);
    }

    res.json(updated);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /quotes/:id/items/:itemId ──────────────────────────────────────
router.delete("/:id/items/:itemId", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const userId = (req.session as any).userId ?? null;
    const [item] = await db.select({ id: quoteItemsTable.id }).from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    await db.update(quoteItemsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));
    await recalcQuoteTotals(quoteId);
    await markQuoteUpdatedIfSent(quoteId, userId);

    // Deactivate linked OT item and recalc OT if active OT exists
    const [activeOTForDel] = await db.select({ id: workOrdersTable.id })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quoteId), eq(workOrdersTable.active, true)));
    if (activeOTForDel) {
      await db.update(workOrderItemsTable)
        .set({ active: false, updatedAt: new Date() })
        .where(and(
          eq(workOrderItemsTable.workOrderId, activeOTForDel.id),
          eq(workOrderItemsTable.quoteItemId, itemId),
          eq(workOrderItemsTable.active, true),
        ));
      await recalcOTTotal(activeOTForDel.id, userId);
    }

    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/items/:itemId/approve ─────────────────────────────────
router.post("/:id/items/:itemId/approve", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const userId = (req.session as any).userId ?? null;

    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [itemCheck] = await db.select({ id: quoteItemsTable.id }).from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));
    if (!itemCheck) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(quoteItemsTable)
      .set({ approvalStatus: "approved", updatedAt: new Date() })
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));

    await logEvent(quoteId, "item_approved", userId);

    // Auto-update quote status
    const newStatus = await determineQuoteStatus(quoteId, existing.status);
    if (newStatus && newStatus !== existing.status) {
      await db.update(quotesTable)
        .set({
          status: newStatus as any,
          approvedAt: newStatus === "approved" ? new Date() : existing.approvedAt,
          updatedAt: new Date(),
        })
        .where(eq(quotesTable.id, quoteId));
      await logEvent(quoteId, `quote_${newStatus}`, userId, existing.status, newStatus);
    }

    const [updatedQuote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)))
      .orderBy(asc(quoteItemsTable.sortOrder));

    res.json({ ...(await enrichQuote(updatedQuote)), items });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/items/:itemId/reject ──────────────────────────────────
router.post("/:id/items/:itemId/reject", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const userId = (req.session as any).userId ?? null;

    const [existing] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [itemCheckR] = await db.select({ id: quoteItemsTable.id }).from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));
    if (!itemCheckR) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(quoteItemsTable)
      .set({ approvalStatus: "rejected", updatedAt: new Date() })
      .where(and(eq(quoteItemsTable.id, itemId), eq(quoteItemsTable.quoteId, quoteId)));

    await logEvent(quoteId, "item_rejected", userId);

    const newStatus = await determineQuoteStatus(quoteId, existing.status);
    if (newStatus && newStatus !== existing.status) {
      await db.update(quotesTable)
        .set({
          status: newStatus as any,
          rejectedAt: newStatus === "rejected" ? new Date() : existing.rejectedAt,
          updatedAt: new Date(),
        })
        .where(eq(quotesTable.id, quoteId));
      await logEvent(quoteId, `quote_${newStatus}`, userId, existing.status, newStatus);
    }

    const [updatedQuote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)))
      .orderBy(asc(quoteItemsTable.sortOrder));

    res.json({ ...(await enrichQuote(updatedQuote)), items });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /quotes/:id/items/reorder ─────────────────────────────────────────
router.post("/:id/items/reorder", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const { order } = z.object({ order: z.array(z.number().int()) }).parse(req.body);

    for (let i = 0; i < order.length; i++) {
      await db.update(quoteItemsTable)
        .set({ sortOrder: i + 1, updatedAt: new Date() })
        .where(and(eq(quoteItemsTable.id, order[i]), eq(quoteItemsTable.quoteId, quoteId)));
    }

    await markQuoteUpdatedIfSent(quoteId, userId);

    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)))
      .orderBy(asc(quoteItemsTable.sortOrder));

    res.json(items);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /quotes/:id/versions ───────────────────────────────────────────────
router.get("/:id/versions", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const versions = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, quoteId))
      .orderBy(desc(quoteVersionsTable.versionNumber));
    res.json(versions);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /quotes/:id/versions/:versionNumber ────────────────────────────────
router.get("/:id/versions/:versionNumber", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const versionNumber = Number(req.params.versionNumber);
    const [version] = await db.select().from(quoteVersionsTable)
      .where(and(eq(quoteVersionsTable.quoteId, quoteId), eq(quoteVersionsTable.versionNumber, versionNumber)));
    if (!version) { res.status(404).json({ error: "Not found" }); return; }
    res.json(version);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /quotes/:id/summary ────────────────────────────────────────────────
router.get("/:id/summary", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!quote) { res.status(404).json({ error: "Not found" }); return; }

    const enriched = await enrichQuote(quote);
    const items = await db.select().from(quoteItemsTable)
      .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)))
      .orderBy(asc(quoteItemsTable.sortOrder), asc(quoteItemsTable.id));

    const lines: string[] = [];
    lines.push(`*Presupuesto ${quote.quoteNumber}*`);
    if (enriched.clientName) lines.push(`Cliente: ${enriched.clientName}`);
    if (enriched.bicycleName) lines.push(`Bicicleta: ${enriched.bicycleName}`);
    lines.push("");
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unitPrice);
      const total = Number(item.total);
      lines.push(`• ${item.description} (x${qty}) — $${price.toFixed(2)} c/u = *$${total.toFixed(2)}*`);
    }
    lines.push("");
    if (Number(quote.subtotal) !== Number(quote.total)) {
      lines.push(`Subtotal: $${Number(quote.subtotal).toFixed(2)}`);
      lines.push(`Descuento: $${Number(quote.discountTotal).toFixed(2)}`);
    }
    lines.push(`*TOTAL: $${Number(quote.total).toFixed(2)}*`);
    if (quote.customerNotes) { lines.push(""); lines.push(quote.customerNotes); }

    res.json({ quoteId, quoteNumber: quote.quoteNumber, text: lines.join("\n"), items });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /quotes/:id/timeline ───────────────────────────────────────────────
router.get("/:id/timeline", async (req, res) => {
  try {
    const quoteId = Number(req.params.id);
    const events = await db
      .select({
        event: timelineEventsTable,
        userName: usersTable.name,
      })
      .from(timelineEventsTable)
      .leftJoin(usersTable, eq(timelineEventsTable.userId, usersTable.id))
      .where(and(eq(timelineEventsTable.entityType, "quote"), eq(timelineEventsTable.entityId, quoteId)))
      .orderBy(desc(timelineEventsTable.createdAt));

    res.json(events.map(e => ({ ...e.event, userName: e.userName ?? null })));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
