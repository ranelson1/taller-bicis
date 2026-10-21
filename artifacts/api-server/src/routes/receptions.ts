import { Router } from "express";
import { db } from "@workspace/db";
import {
  receptionsTable,
  inspectionFindingsTable,
  clientsTable,
  bicyclesTable,
  quotesTable,
  quoteItemsTable,
  timelineEventsTable,
  usersTable,
  workCasesTable,
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, asc, count } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { autoCreateWorkCase, triggerWorkCaseRecalc, logWorkCaseEvent } from "../helpers/workCase";

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextReceptionNumber(): Promise<string> {
  const [row] = await db.select({ n: count() }).from(receptionsTable);
  const seq = Number(row?.n ?? 0) + 1;
  return `R-${String(seq).padStart(4, "0")}`;
}

async function enrichReception(r: typeof receptionsTable.$inferSelect) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId));
  const [bike] = await db.select({ brand: bicyclesTable.brand, model: bicyclesTable.model })
    .from(bicyclesTable).where(eq(bicyclesTable.id, r.bicycleId));
  let quoteName: string | null = null;
  if (r.quoteId) {
    const [q] = await db.select({ quoteNumber: quotesTable.quoteNumber }).from(quotesTable).where(eq(quotesTable.id, r.quoteId));
    quoteName = q?.quoteNumber ?? null;
  }
  let receivedByName: string | null = null;
  if (r.receivedByUserId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.receivedByUserId));
    receivedByName = u?.name ?? null;
  }
  let workCaseNumber: string | null = null;
  if (r.workCaseId) {
    const { workCasesTable: wct } = await import("@workspace/db");
    const [wc] = await db.select({ workCaseNumber: wct.workCaseNumber }).from(wct).where(eq(wct.id, r.workCaseId));
    workCaseNumber = wc?.workCaseNumber ?? null;
  }
  return {
    ...r,
    clientName: client?.name ?? null,
    bicycleName: bike ? `${bike.brand} ${bike.model}` : null,
    quoteNumber: quoteName,
    receivedByName,
    workCaseNumber,
  };
}

async function logEvent(entityType: string, entityId: number, action: string, userId: number | null, previousStatus?: string, newStatus?: string, comment?: string) {
  await db.insert(timelineEventsTable).values({
    entityType, entityId, userId, action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    comment: comment ?? null,
  });
}

async function recalcQuoteTotals(quoteId: number) {
  const items = await db.select().from(quoteItemsTable)
    .where(and(eq(quoteItemsTable.quoteId, quoteId), eq(quoteItemsTable.active, true)));
  let subtotal = 0, discountTotal = 0, laborHours = 0;
  for (const item of items) {
    const t = Number(item.total);
    if (item.itemType === "discount") discountTotal += Math.abs(t);
    else subtotal += t;
    if (item.estimatedLaborHours) laborHours += Number(item.estimatedLaborHours);
  }
  const total = subtotal - discountTotal;
  await db.update(quotesTable)
    .set({ subtotal: String(subtotal), discountTotal: String(discountTotal), total: String(Math.max(0, total)), estimatedLaborHours: String(laborHours), updatedAt: new Date() })
    .where(eq(quotesTable.id, quoteId));
}

async function markQuoteUpdatedIfSent(quoteId: number, userId: number | null): Promise<void> {
  const [q] = await db.select({ status: quotesTable.status }).from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (q && ["sent", "approved", "partially_approved"].includes(q.status)) {
    await db.update(quotesTable)
      .set({ status: "updated_after_sent", updatedAt: new Date() })
      .where(eq(quotesTable.id, quoteId));
    await logEvent("quote", quoteId, "quote_edited", userId, q.status, "updated_after_sent");
  }
}

// ── GET /receptions ───────────────────────────────────────────────────────────
const listSchema = z.object({
  status: z.string().optional(),
  clientId: z.coerce.number().int().optional(),
  bicycleId: z.coerce.number().int().optional(),
  quoteId: z.coerce.number().int().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
});

router.get("/", async (req, res) => {
  try {
    const q = listSchema.parse(req.query);
    const conditions: any[] = [];

    if (q.active !== "false") conditions.push(eq(receptionsTable.active, true));
    if (q.status) conditions.push(eq(receptionsTable.status, q.status as any));
    if (q.clientId) conditions.push(eq(receptionsTable.clientId, q.clientId));
    if (q.bicycleId) conditions.push(eq(receptionsTable.bicycleId, q.bicycleId));
    if (q.quoteId) conditions.push(eq(receptionsTable.quoteId, q.quoteId));
    if (q.dateFrom) conditions.push(gte(receptionsTable.receivedAt, new Date(q.dateFrom)));
    if (q.dateTo) conditions.push(lte(receptionsTable.receivedAt, new Date(q.dateTo)));

    let rows = await db
      .select({
        r: receptionsTable,
        clientName: clientsTable.name,
        bicycleBrand: bicyclesTable.brand,
        bicycleModel: bicyclesTable.model,
        quoteNumber: quotesTable.quoteNumber,
        workCaseNumber: workCasesTable.workCaseNumber,
      })
      .from(receptionsTable)
      .leftJoin(clientsTable, eq(receptionsTable.clientId, clientsTable.id))
      .leftJoin(bicyclesTable, eq(receptionsTable.bicycleId, bicyclesTable.id))
      .leftJoin(quotesTable, eq(receptionsTable.quoteId, quotesTable.id))
      .leftJoin(workCasesTable, eq(receptionsTable.workCaseId, workCasesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(receptionsTable.createdAt));

    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter(r =>
        r.r.receptionNumber.toLowerCase().includes(s) ||
        (r.clientName ?? "").toLowerCase().includes(s) ||
        (r.bicycleBrand ?? "").toLowerCase().includes(s) ||
        (r.bicycleModel ?? "").toLowerCase().includes(s) ||
        (r.r.customerReportedProblem ?? "").toLowerCase().includes(s)
      );
    }

    const result = rows.map(r => ({
      ...r.r,
      clientName: r.clientName ?? null,
      bicycleName: r.bicycleBrand && r.bicycleModel ? `${r.bicycleBrand} ${r.bicycleModel}` : null,
      quoteNumber: r.quoteNumber ?? null,
      workCaseNumber: r.workCaseNumber ?? null,
    }));

    res.json(result);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /receptions ──────────────────────────────────────────────────────────
const createSchema = z.object({
  clientId: z.number().int(),
  bicycleId: z.number().int(),
  quoteId: z.number().int().nullable().optional(),
  receivedByUserId: z.number().int().nullable().optional(),
  receivedAt: z.string().optional(),
  customerReportedProblem: z.string().nullable().optional(),
  initialVisualCondition: z.string().nullable().optional(),
  accessoriesReceived: z.any().optional(),
  internalNotes: z.string().nullable().optional(),
  customerNotes: z.string().nullable().optional(),
});

router.post("/", async (req, res) => {
  try {
    const data = createSchema.parse(req.body);
    const userId = (req.session as any).userId ?? null;

    // Validate bicycle belongs to client
    const [bike] = await db.select().from(bicyclesTable)
      .where(and(eq(bicyclesTable.id, data.bicycleId), eq(bicyclesTable.clientId, data.clientId)));
    if (!bike) { res.status(400).json({ error: "La bicicleta no pertenece al cliente seleccionado." }); return; }

    // Validate quote belongs to same client if provided
    if (data.quoteId) {
      const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, data.quoteId));
      if (!q || q.clientId !== data.clientId) { res.status(400).json({ error: "El presupuesto no pertenece al mismo cliente." }); return; }
    }

    const receptionNumber = await nextReceptionNumber();

    // Inherit or create TR first so reception is always linked from creation
    let workCaseId: number | null = null;
    if (data.quoteId) {
      const [q] = await db.select({ workCaseId: quotesTable.workCaseId }).from(quotesTable).where(eq(quotesTable.id, data.quoteId));
      workCaseId = q?.workCaseId ?? null;
    }
    if (!workCaseId) {
      workCaseId = await autoCreateWorkCase(data.clientId, data.bicycleId, userId);
    }

    const [reception] = await db.insert(receptionsTable).values({
      receptionNumber,
      clientId: data.clientId,
      bicycleId: data.bicycleId,
      quoteId: data.quoteId ?? null,
      workCaseId,
      receivedByUserId: data.receivedByUserId ?? userId,
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date(),
      customerReportedProblem: data.customerReportedProblem ?? null,
      initialVisualCondition: data.initialVisualCondition ?? null,
      accessoriesReceived: data.accessoriesReceived ?? null,
      internalNotes: data.internalNotes ?? null,
      customerNotes: data.customerNotes ?? null,
      status: "received",
    }).returning();

    await logWorkCaseEvent(workCaseId, "reception_linked_to_work_case", userId, undefined, undefined, `Recepción ${receptionNumber} vinculada`, "reception", reception.id);
    await triggerWorkCaseRecalc(workCaseId, userId);
    await logEvent("reception", reception.id, "reception_created", userId, undefined, "received");

    res.status(201).json(await enrichReception(reception));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /receptions/:id ───────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!reception) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichReception(reception));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── PATCH /receptions/:id ─────────────────────────────────────────────────────
const updateSchema = z.object({
  quoteId: z.number().int().nullable().optional(),
  receivedByUserId: z.number().int().nullable().optional(),
  receivedAt: z.string().optional(),
  customerReportedProblem: z.string().nullable().optional(),
  initialVisualCondition: z.string().nullable().optional(),
  accessoriesReceived: z.any().optional(),
  internalNotes: z.string().nullable().optional(),
  customerNotes: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const userId = (req.session as any).userId ?? null;

    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Validate quoteId belongs to same client
    if (data.quoteId !== undefined && data.quoteId !== null) {
      const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, data.quoteId));
      if (!q || q.clientId !== existing.clientId) { res.status(400).json({ error: "El presupuesto no pertenece al mismo cliente." }); return; }
    }

    const updateData: any = { ...data, updatedAt: new Date() };
    if (data.receivedAt) updateData.receivedAt = new Date(data.receivedAt);

    const [updated] = await db.update(receptionsTable).set(updateData).where(eq(receptionsTable.id, id)).returning();
    await logEvent("reception", id, "reception_edited", userId);

    res.json(await enrichReception(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /receptions/:id ────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(receptionsTable).set({ active: false, updatedAt: new Date() }).where(eq(receptionsTable.id, id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/start-inspection ─────────────────────────────────────
router.post("/:id/start-inspection", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(receptionsTable)
      .set({ status: "in_inspection", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "inspection_started", userId, existing.status, "in_inspection");
    await triggerWorkCaseRecalc(updated.workCaseId, userId);
    res.json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/complete-inspection ──────────────────────────────────
router.post("/:id/complete-inspection", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(receptionsTable)
      .set({ status: "inspection_completed", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "inspection_completed", userId, existing.status, "inspection_completed");
    await triggerWorkCaseRecalc(updated.workCaseId, userId);
    res.json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/mark-ready-for-work-order ───────────────────────────
router.post("/:id/mark-ready-for-work-order", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(receptionsTable)
      .set({ status: "ready_for_work_order", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "reception_ready_for_work_order", userId, existing.status, "ready_for_work_order");
    await triggerWorkCaseRecalc(updated.workCaseId, userId);
    res.json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/create-quote ────────────────────────────────────────
router.post("/:id/create-quote", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!reception) { res.status(404).json({ error: "Not found" }); return; }
    if (reception.quoteId) { res.status(400).json({ error: "Esta recepción ya tiene presupuesto asociado." }); return; }

    // Get next quote number
    const [countRow] = await db.select({ n: count() }).from(quotesTable);
    const seq = Number(countRow?.n ?? 0) + 1;
    const quoteNumber = `P-${String(seq).padStart(4, "0")}`;

    // Inherit workCaseId from reception
    const quoteWorkCaseId = reception.workCaseId ?? null;

    const [quote] = await db.insert(quotesTable).values({
      quoteNumber,
      clientId: reception.clientId,
      bicycleId: reception.bicycleId,
      originChannel: "presencial",
      initialRequirement: reception.customerReportedProblem ?? null,
      status: "draft",
      workCaseId: quoteWorkCaseId,
    }).returning();

    await logEvent("quote", quote.id, "quote_created", userId, undefined, "draft", "Creado desde recepción");
    await logEvent("reception", id, "quote_created_from_reception", userId, undefined, undefined, `Presupuesto ${quoteNumber} creado`);

    // Log link event on the work case timeline
    if (quoteWorkCaseId) {
      await logWorkCaseEvent(quoteWorkCaseId, "quote_linked_to_work_case", userId, undefined, undefined, `Presupuesto ${quoteNumber} vinculado desde recepción`, "quote", quote.id);
    }

    // Link quote to reception and transition to waiting_quote_approval
    const [updated] = await db.update(receptionsTable)
      .set({ quoteId: quote.id, status: "waiting_quote_approval", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "reception_waiting_quote_approval", userId, reception.status, "waiting_quote_approval", `Esperando aprobación de ${quoteNumber}`);

    // Recalc TR status after reception status change
    if (quoteWorkCaseId) {
      await triggerWorkCaseRecalc(quoteWorkCaseId, userId);
    }

    res.status(201).json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/cancel ───────────────────────────────────────────────
router.post("/:id/cancel", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.status === "cancelled") { res.status(400).json({ error: "La recepción ya está cancelada." }); return; }

    const [updated] = await db.update(receptionsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "reception_cancelled", userId, existing.status, "cancelled");
    await triggerWorkCaseRecalc(updated.workCaseId, userId);
    res.json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/mark-waiting-quote-approval ─────────────────────────
router.post("/:id/mark-waiting-quote-approval", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [existing] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db.update(receptionsTable)
      .set({ status: "waiting_quote_approval", updatedAt: new Date() })
      .where(eq(receptionsTable.id, id)).returning();

    await logEvent("reception", id, "reception_waiting_quote_approval", userId, existing.status, "waiting_quote_approval");
    await triggerWorkCaseRecalc(updated.workCaseId, userId);
    res.json(await enrichReception(updated));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /receptions/:id/findings ──────────────────────────────────────────────
router.get("/:id/findings", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const findings = await db.select().from(inspectionFindingsTable)
      .where(and(eq(inspectionFindingsTable.receptionId, receptionId), eq(inspectionFindingsTable.active, true)))
      .orderBy(asc(inspectionFindingsTable.createdAt));
    res.json(findings);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/findings ─────────────────────────────────────────────
const findingCreateSchema = z.object({
  area: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  finding: z.string().min(1),
  recommendation: z.string().nullable().optional(),
  shouldCreateQuoteItem: z.boolean().optional(),
  itemType: z.string().nullable().optional(),
  serviceId: z.number().int().nullable().optional(),
  partId: z.number().int().nullable().optional(),
  quoteItemDescription: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  estimatedLaborHours: z.number().nullable().optional(),
  mechanicId: z.number().int().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
});

router.post("/:id/findings", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const data = findingCreateSchema.parse(req.body);

    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, receptionId));
    if (!reception) { res.status(404).json({ error: "Not found" }); return; }

    const [finding] = await db.insert(inspectionFindingsTable).values({
      receptionId,
      quoteId: reception.quoteId ?? null,
      mechanicId: data.mechanicId ?? null,
      area: data.area,
      severity: data.severity,
      finding: data.finding,
      recommendation: data.recommendation ?? null,
      shouldCreateQuoteItem: data.shouldCreateQuoteItem ?? false,
      itemType: data.itemType ?? null,
      serviceId: data.serviceId ?? null,
      partId: data.partId ?? null,
      quoteItemDescription: data.quoteItemDescription ?? null,
      quantity: data.quantity != null ? String(data.quantity) : null,
      unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
      estimatedLaborHours: data.estimatedLaborHours != null ? String(data.estimatedLaborHours) : null,
      internalNotes: data.internalNotes ?? null,
    }).returning();

    await logEvent("reception", receptionId, "finding_added", userId, undefined, undefined, data.finding);

    res.status(201).json(finding);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /receptions/:id/findings/:findingId ─────────────────────────────────
const findingUpdateSchema = z.object({
  area: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  finding: z.string().optional(),
  recommendation: z.string().nullable().optional(),
  shouldCreateQuoteItem: z.boolean().optional(),
  itemType: z.string().nullable().optional(),
  serviceId: z.number().int().nullable().optional(),
  partId: z.number().int().nullable().optional(),
  quoteItemDescription: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  estimatedLaborHours: z.number().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
});

router.patch("/:id/findings/:findingId", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const findingId = Number(req.params.findingId);
    const userId = (req.session as any).userId ?? null;
    const data = findingUpdateSchema.parse(req.body);

    const [existing] = await db.select().from(inspectionFindingsTable)
      .where(and(eq(inspectionFindingsTable.id, findingId), eq(inspectionFindingsTable.receptionId, receptionId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updateData: any = { ...data, updatedAt: new Date() };
    if (data.quantity != null) updateData.quantity = String(data.quantity);
    if (data.unitPrice != null) updateData.unitPrice = String(data.unitPrice);
    if (data.estimatedLaborHours != null) updateData.estimatedLaborHours = String(data.estimatedLaborHours);

    const [updated] = await db.update(inspectionFindingsTable)
      .set(updateData)
      .where(and(eq(inspectionFindingsTable.id, findingId), eq(inspectionFindingsTable.receptionId, receptionId)))
      .returning();

    await logEvent("reception", receptionId, "finding_edited", userId);
    res.json(updated);
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /receptions/:id/findings/:findingId ────────────────────────────────
router.delete("/:id/findings/:findingId", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const findingId = Number(req.params.findingId);
    const [existing] = await db.select().from(inspectionFindingsTable)
      .where(and(eq(inspectionFindingsTable.id, findingId), eq(inspectionFindingsTable.receptionId, receptionId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.update(inspectionFindingsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(inspectionFindingsTable.id, findingId));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── POST /receptions/:id/findings/:findingId/create-quote-item ───────────────
router.post("/:id/findings/:findingId/create-quote-item", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const findingId = Number(req.params.findingId);
    const userId = (req.session as any).userId ?? null;

    const [finding] = await db.select().from(inspectionFindingsTable)
      .where(and(eq(inspectionFindingsTable.id, findingId), eq(inspectionFindingsTable.receptionId, receptionId)));
    if (!finding) { res.status(404).json({ error: "Not found" }); return; }

    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, receptionId));
    if (!reception?.quoteId) { res.status(400).json({ error: "La recepción no tiene presupuesto asociado." }); return; }

    if (finding.createdQuoteItemId) { res.status(400).json({ error: "Ya se creó un ítem de presupuesto para este hallazgo." }); return; }

    const quoteId = reception.quoteId;
    const description = finding.quoteItemDescription || finding.recommendation || finding.finding;
    const qty = finding.quantity ? Number(finding.quantity) : 1;
    const price = finding.unitPrice ? Number(finding.unitPrice) : 0;
    const total = qty * price;
    const itemType = (finding.itemType as any) ?? "other";

    // Get max sortOrder
    const [lastOrder] = await db.select({ s: quoteItemsTable.sortOrder })
      .from(quoteItemsTable).where(eq(quoteItemsTable.quoteId, quoteId))
      .orderBy(desc(quoteItemsTable.sortOrder)).limit(1);
    const nextOrder = (lastOrder?.s ?? 0) + 1;

    const [quoteItem] = await db.insert(quoteItemsTable).values({
      quoteId,
      itemType,
      origin: "visual_inspection",
      description,
      quantity: String(qty),
      unitPrice: String(price),
      total: String(total),
      estimatedLaborHours: finding.estimatedLaborHours ?? null,
      approvalStatus: "pending",
      serviceId: finding.serviceId ?? null,
      partId: finding.partId ?? null,
      sortOrder: nextOrder,
      active: true,
    }).returning();

    await recalcQuoteTotals(quoteId);
    await markQuoteUpdatedIfSent(quoteId, userId);

    // Update finding to mark item created
    const [updatedFinding] = await db.update(inspectionFindingsTable)
      .set({ createdQuoteItemId: quoteItem.id, shouldCreateQuoteItem: true, updatedAt: new Date() })
      .where(eq(inspectionFindingsTable.id, findingId))
      .returning();

    await logEvent("reception", receptionId, "finding_converted_to_quote_item", userId, undefined, undefined, `Ítem "${description}" agregado al presupuesto`);
    await logEvent("quote", quoteId, "item_added_from_inspection", userId, undefined, undefined, `Adicional desde inspección visual: "${description}"`);

    res.status(201).json(updatedFinding);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// ── GET /receptions/:id/timeline ──────────────────────────────────────────────
router.get("/:id/timeline", async (req, res) => {
  try {
    const receptionId = Number(req.params.id);
    const events = await db
      .select({ event: timelineEventsTable, userName: usersTable.name })
      .from(timelineEventsTable)
      .leftJoin(usersTable, eq(timelineEventsTable.userId, usersTable.id))
      .where(and(eq(timelineEventsTable.entityType, "reception"), eq(timelineEventsTable.entityId, receptionId)))
      .orderBy(desc(timelineEventsTable.createdAt));
    res.json(events.map(e => ({ ...e.event, userName: e.userName ?? null })));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
