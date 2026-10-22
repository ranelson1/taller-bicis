import { Router } from "express";
import { db } from "@workspace/db";
import {
  workCasesTable,
  quotesTable,
  quoteItemsTable,
  receptionsTable,
  workOrdersTable,
  clientsTable,
  bicyclesTable,
  usersTable,
  servicesTable,
  timelineEventsTable,
} from "@workspace/db";
import { eq, and, desc, count, isNull, isNotNull, or, inArray, gte, lte, ilike } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { nextDocumentNumber } from "../helpers/numbering";
import {
  logWorkCaseEvent,
  recalcWorkCaseStatus as recalcHelper,
  triggerWorkCaseRecalc,
  createWorkOrderFromQuoteInternal,
} from "../helpers/workCase";

const router = Router();
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextWorkCaseNumber(): Promise<string> {
  return nextDocumentNumber(db, "TR");
}

async function enrichWorkCase(wc: typeof workCasesTable.$inferSelect) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, wc.clientId));
  let bicycleName: string | null = null;
  if (wc.bicycleId) {
    const [bike] = await db.select({ brand: bicyclesTable.brand, model: bicyclesTable.model })
      .from(bicyclesTable).where(eq(bicyclesTable.id, wc.bicycleId));
    if (bike) bicycleName = `${bike.brand} ${bike.model}`;
  }
  let mechanicName: string | null = null;
  if (wc.assignedMechanicId) {
    const [mech] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, wc.assignedMechanicId));
    mechanicName = mech?.name ?? null;
  }

  // Load linked documents
  const linkedQuotes = await db.select({
    id: quotesTable.id,
    quoteNumber: quotesTable.quoteNumber,
    status: quotesTable.status,
    total: quotesTable.total,
    createdAt: quotesTable.createdAt,
    customerNotes: quotesTable.customerNotes,
    internalNotes: quotesTable.internalNotes,
  }).from(quotesTable).where(and(eq(quotesTable.workCaseId, wc.id), eq(quotesTable.active, true)));

  const linkedReceptions = await db.select({
    id: receptionsTable.id,
    receptionNumber: receptionsTable.receptionNumber,
    status: receptionsTable.status,
    createdAt: receptionsTable.createdAt,
    customerNotes: receptionsTable.customerNotes,
    internalNotes: receptionsTable.internalNotes,
  }).from(receptionsTable).where(and(eq(receptionsTable.workCaseId, wc.id), eq(receptionsTable.active, true)));

  const linkedWorkOrders = await db.select({
    id: workOrdersTable.id,
    workOrderNumber: workOrdersTable.workOrderNumber,
    status: workOrdersTable.status,
    total: workOrdersTable.total,
    progressPercentage: workOrdersTable.progressPercentage,
    createdAt: workOrdersTable.createdAt,
    customerNotes: workOrdersTable.customerNotes,
    internalNotes: workOrdersTable.internalNotes,
  }).from(workOrdersTable).where(and(eq(workOrdersTable.workCaseId, wc.id), eq(workOrdersTable.active, true)));

  return {
    ...wc,
    clientName: client?.name ?? null,
    bicycleName,
    mechanicName,
    totalEstimatedAmount: wc.totalEstimatedAmount ? Number(wc.totalEstimatedAmount) : null,
    totalEstimatedLaborHours: wc.totalEstimatedLaborHours ? Number(wc.totalEstimatedLaborHours) : null,
    progressPercentage: wc.progressPercentage ? Number(wc.progressPercentage) : null,
    linkedQuotes,
    linkedReceptions,
    linkedWorkOrders,
  };
}

async function logEvent(workCaseId: number, action: string, userId: number | null, previousStatus?: string, newStatus?: string, comment?: string) {
  await db.insert(timelineEventsTable).values({
    entityType: "work_case",
    entityId: workCaseId,
    userId,
    action,
    previousStatus: previousStatus ?? null,
    newStatus: newStatus ?? null,
    comment: comment ?? null,
  });
}

// Derive work_case status from linked documents
async function recalcWorkCaseStatus(workCaseId: number): Promise<void> {
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

  // Priority: work orders first, then receptions, then quotes
  let newStatus: string = wc.status;
  let mechanicId: number | null = wc.assignedMechanicId;
  let totalAmount: string | null = wc.totalEstimatedAmount;
  let laborHours: string | null = wc.totalEstimatedLaborHours;
  let progress: string | null = wc.progressPercentage;

  // Determine status from highest-priority linked doc
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
    // mechanic comes from WO if not set
    if (!mechanicId) {
      const fullWO = await db.select({ mechanicId: workOrdersTable.mechanicId })
        .from(workOrdersTable)
        .where(and(eq(workOrdersTable.workCaseId, workCaseId), eq(workOrdersTable.active, true)))
        .limit(1);
      mechanicId = fullWO[0]?.mechanicId ?? null;
    }
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

// ── GET /work-cases/summary ────────────────────────────────────────────────
// IMPORTANT: must come BEFORE /:id to avoid matching "summary" as an id
router.get("/summary", async (_req, res) => {
  try {
    const [row] = await db.select({ n: count() }).from(workCasesTable).where(eq(workCasesTable.active, true));
    const total = Number(row?.n ?? 0);

    const byStatus = await db.select({
      status: workCasesTable.status,
      n: count(),
    }).from(workCasesTable)
      .where(eq(workCasesTable.active, true))
      .groupBy(workCasesTable.status);

    res.json({
      total,
      byStatus: byStatus.map(r => ({ status: r.status, count: Number(r.n) })),
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-cases ────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { clientId, status, active = "true", mechanicId, dateFrom, dateTo, search } = req.query as any;
    const conditions: any[] = [];
    if (active !== "all") conditions.push(eq(workCasesTable.active, active !== "false"));
    if (clientId) conditions.push(eq(workCasesTable.clientId, parseInt(clientId)));
    if (status) conditions.push(eq(workCasesTable.status, status));
    if (mechanicId) conditions.push(eq(workCasesTable.assignedMechanicId, parseInt(mechanicId)));
    if (dateFrom) conditions.push(gte(workCasesTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(workCasesTable.createdAt, new Date(dateTo)));

    // Pre-query linked doc numbers for cross-identifier search
    let docMatchWorkCaseIds: Set<number> | null = null;
    if (search) {
      const s = `%${search}%`;
      const [matchQs, matchRs, matchWOs] = await Promise.all([
        db.select({ wcId: quotesTable.workCaseId }).from(quotesTable)
          .where(and(eq(quotesTable.active, true), isNotNull(quotesTable.workCaseId), ilike(quotesTable.quoteNumber, s))),
        db.select({ wcId: receptionsTable.workCaseId }).from(receptionsTable)
          .where(and(eq(receptionsTable.active, true), isNotNull(receptionsTable.workCaseId), ilike(receptionsTable.receptionNumber, s))),
        db.select({ wcId: workOrdersTable.workCaseId }).from(workOrdersTable)
          .where(and(eq(workOrdersTable.active, true), isNotNull(workOrdersTable.workCaseId), ilike(workOrdersTable.workOrderNumber, s))),
      ]);
      const ids = [...matchQs, ...matchRs, ...matchWOs].map(r => r.wcId).filter(Boolean) as number[];
      docMatchWorkCaseIds = new Set(ids);
    }

    let rows = await db
      .select({
        wc: workCasesTable,
        clientName: clientsTable.name,
        bicycleBrand: bicyclesTable.brand,
        bicycleModel: bicyclesTable.model,
      })
      .from(workCasesTable)
      .leftJoin(clientsTable, eq(workCasesTable.clientId, clientsTable.id))
      .leftJoin(bicyclesTable, eq(workCasesTable.bicycleId, bicyclesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workCasesTable.createdAt));

    // In-memory search: workCaseNumber, clientName, bicycle (brand/model), or linked doc match
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r => {
        const bikeName = `${r.bicycleBrand ?? ""} ${r.bicycleModel ?? ""}`.trim().toLowerCase();
        return (
          r.wc.workCaseNumber.toLowerCase().includes(s) ||
          (r.clientName ?? "").toLowerCase().includes(s) ||
          (r.bicycleBrand ?? "").toLowerCase().includes(s) ||
          (r.bicycleModel ?? "").toLowerCase().includes(s) ||
          bikeName.includes(s) ||
          (docMatchWorkCaseIds?.has(r.wc.id) ?? false)
        );
      });
    }

    const enriched = await Promise.all(rows.map(async ({ wc, clientName, bicycleBrand, bicycleModel }) => {
      const bicycleName = bicycleBrand ? `${bicycleBrand} ${bicycleModel ?? ""}`.trim() : null;
      let mechanicName: string | null = null;
      if (wc.assignedMechanicId) {
        const [mech] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, wc.assignedMechanicId));
        mechanicName = mech?.name ?? null;
      }
      const [qCount] = await db.select({ n: count() }).from(quotesTable).where(and(eq(quotesTable.workCaseId, wc.id), eq(quotesTable.active, true)));
      const [rCount] = await db.select({ n: count() }).from(receptionsTable).where(and(eq(receptionsTable.workCaseId, wc.id), eq(receptionsTable.active, true)));
      const [woCount] = await db.select({ n: count() }).from(workOrdersTable).where(and(eq(workOrdersTable.workCaseId, wc.id), eq(workOrdersTable.active, true)));
      const [currentWo] = await db.select({ workOrderNumber: workOrdersTable.workOrderNumber }).from(workOrdersTable)
        .where(and(eq(workOrdersTable.workCaseId, wc.id), eq(workOrdersTable.active, true)))
        .orderBy(desc(workOrdersTable.id)).limit(1);
      return {
        ...wc,
        clientName: clientName ?? null,
        bicycleName,
        mechanicName,
        totalEstimatedAmount: wc.totalEstimatedAmount ? Number(wc.totalEstimatedAmount) : null,
        totalEstimatedLaborHours: wc.totalEstimatedLaborHours ? Number(wc.totalEstimatedLaborHours) : null,
        progressPercentage: wc.progressPercentage ? Number(wc.progressPercentage) : null,
        quoteCount: Number(qCount?.n ?? 0),
        receptionCount: Number(rCount?.n ?? 0),
        workOrderCount: Number(woCount?.n ?? 0),
        workOrderNumber: currentWo?.workOrderNumber ?? null,
      };
    }));

    res.json(enriched);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const userId = (req.session as any).userId ?? null;
    const body = z.object({
      clientId: z.number().int().positive(),
      bicycleId: z.number().int().positive().optional(),
      originChannel: z.string().optional(),
      initialRequirement: z.string().optional(),
      assignedMechanicId: z.number().int().positive().optional(),
    }).parse(req.body);

    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, body.clientId));
    if (!client) { res.status(400).json({ error: "Cliente no existe" }); return; }

    const workCaseNumber = await nextWorkCaseNumber();
    const [wc] = await db.insert(workCasesTable).values({
      workCaseNumber,
      clientId: body.clientId,
      bicycleId: body.bicycleId ?? null,
      status: "lead",
      originChannel: body.originChannel ?? null,
      initialRequirement: body.initialRequirement ?? null,
      assignedMechanicId: body.assignedMechanicId ?? null,
    }).returning();

    await logEvent(wc.id, "work_case_created", userId, undefined, "lead");
    res.status(201).json(await enrichWorkCase(wc));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/quick-create ───────────────────────────────────────────
// IMPORTANT: must come BEFORE /:id routes.
// Creates client (opt), bicycle (opt), TR, Quote (approved items), Reception and OT
// in a single atomic transaction. Reduces clicks for the daily "nuevo trabajo" flow.
class QuickCreateError extends Error {}
const qcBikeTypeEnum = z.enum(["mtb", "road", "gravel", "urban", "ebike", "kids", "other"]);
const qcCurrentYear = new Date().getFullYear();
const quickCreateSchema = z.object({
  client: z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  bicycle: z.object({
    id: z.number().int().positive().optional(),
    brand: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    year: z.number().int().min(1990).max(qcCurrentYear + 1).optional().nullable(),
    type: qcBikeTypeEnum.optional(),
    color: z.string().optional().nullable(),
    serialNumber: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  originChannel: z.string().optional(),
  assignedMechanicId: z.number().int().positive().optional().nullable(),
  customerComment: z.string().optional().nullable(),
  mechanicComment: z.string().optional().nullable(),
  initialVisualCondition: z.string().optional().nullable(),
  accessoriesReceived: z.array(z.string()).optional().nullable(),
  items: z.array(z.object({
    itemType: z.enum(["service", "part", "additional_labor", "diagnosis", "recommendation", "discount", "other"]),
    description: z.string().min(1),
    quantity: z.number().min(0.001),
    unitPrice: z.number(),
    estimatedLaborHours: z.number().min(0).nullable().optional(),
    serviceId: z.number().int().positive().nullable().optional(),
    partId: z.number().int().positive().nullable().optional(),
  })).min(1),
});

router.post("/quick-create", async (req, res) => {
  const userId = (req.session as any).userId ?? null;
  const parsed = quickCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const body = parsed.data;

  if (!body.client.id && !body.client.name) {
    res.status(400).json({ error: "Debes seleccionar un cliente existente o ingresar el nombre de uno nuevo" }); return;
  }
  if (!body.bicycle.id && (!body.bicycle.brand || !body.bicycle.model)) {
    res.status(400).json({ error: "Debes seleccionar una bicicleta existente o ingresar marca y modelo" }); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Client (existing or new)
      let clientId: number;
      if (body.client.id) {
        const [c] = await tx.select().from(clientsTable).where(eq(clientsTable.id, body.client.id));
        if (!c) throw new QuickCreateError("Cliente no encontrado");
        clientId = c.id;
      } else {
        const [c] = await tx.insert(clientsTable).values({
          name: body.client.name!,
          phone: body.client.phone ?? null,
          email: body.client.email ?? null,
          notes: body.client.notes ?? null,
        }).returning();
        clientId = c.id;
      }

      // 2. Bicycle (existing or new; existing must belong to the client)
      let bicycleId: number;
      if (body.bicycle.id) {
        const [b] = await tx.select().from(bicyclesTable).where(eq(bicyclesTable.id, body.bicycle.id));
        if (!b) throw new QuickCreateError("Bicicleta no encontrada");
        if (b.clientId !== clientId) throw new QuickCreateError("La bicicleta seleccionada no pertenece a este cliente");
        bicycleId = b.id;
      } else {
        const [b] = await tx.insert(bicyclesTable).values({
          clientId,
          brand: body.bicycle.brand!,
          model: body.bicycle.model!,
          year: body.bicycle.year ?? null,
          type: body.bicycle.type ?? "mtb",
          color: body.bicycle.color ?? null,
          serialNumber: body.bicycle.serialNumber ?? null,
          notes: body.bicycle.notes ?? null,
        }).returning();
        bicycleId = b.id;
      }

      // 3. Work case (TR)
      const workCaseNumber = await nextDocumentNumber(tx, "TR");
      const [wc] = await tx.insert(workCasesTable).values({
        workCaseNumber,
        clientId,
        bicycleId,
        status: "lead",
        originChannel: body.originChannel ?? null,
        initialRequirement: body.customerComment ?? null,
        assignedMechanicId: body.assignedMechanicId ?? null,
      }).returning();
      await tx.insert(timelineEventsTable).values({
        entityType: "work_case", entityId: wc.id, userId,
        action: "work_case_created", previousStatus: null, newStatus: "lead", comment: null,
      });

      // 4. Quote with approved items. Items without hours take them from the catalog service
      // (needed to estimate the completion date).
      const serviceIds = body.items.filter(i => i.estimatedLaborHours == null && i.serviceId).map(i => i.serviceId!);
      const serviceHours = new Map((serviceIds.length === 0 ? [] : await tx
        .select({ id: servicesTable.id, estimatedHours: servicesTable.estimatedHours })
        .from(servicesTable).where(inArray(servicesTable.id, serviceIds)))
        .map(s => [s.id, s.estimatedHours != null ? Number(s.estimatedHours) : null]));
      const items = body.items.map(i => ({
        ...i,
        estimatedLaborHours: i.estimatedLaborHours ?? (i.serviceId && serviceHours.get(i.serviceId) != null
          ? serviceHours.get(i.serviceId)! * i.quantity : null),
      }));

      const quoteNumber = await nextDocumentNumber(tx, "P");
      const lineTotal = (i: { quantity: number; unitPrice: number }) => i.quantity * i.unitPrice;
      const subtotal = items.filter(i => i.itemType !== "discount").reduce((s, i) => s + lineTotal(i), 0);
      const discountTotal = items.filter(i => i.itemType === "discount").reduce((s, i) => s + Math.abs(lineTotal(i)), 0);
      const laborHours = items.reduce((s, i) => s + (i.estimatedLaborHours ?? 0), 0);
      const [quote] = await tx.insert(quotesTable).values({
        quoteNumber,
        clientId,
        bicycleId,
        originChannel: body.originChannel ?? "presencial",
        initialRequirement: body.customerComment ?? null,
        status: "approved",
        subtotal: String(subtotal),
        discountTotal: String(discountTotal),
        total: String(Math.max(0, subtotal - discountTotal)),
        estimatedLaborHours: String(laborHours),
        approvedAt: new Date(),
        workCaseId: wc.id,
      }).returning();
      await tx.insert(timelineEventsTable).values({
        entityType: "quote", entityId: quote.id, userId,
        action: "quote_created", previousStatus: null, newStatus: "approved",
        comment: "Creado desde Nuevo Trabajo Rápido",
      });
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await tx.insert(quoteItemsTable).values({
          quoteId: quote.id,
          itemType: it.itemType,
          origin: "manual",
          description: it.description,
          quantity: String(it.quantity),
          unitPrice: String(it.unitPrice),
          total: String(it.quantity * it.unitPrice),
          estimatedLaborHours: it.estimatedLaborHours != null ? String(it.estimatedLaborHours) : null,
          approvalStatus: "approved",
          serviceId: it.serviceId ?? null,
          partId: it.partId ?? null,
          sortOrder: i,
        });
      }

      // 5. Reception (already ready for OT)
      const receptionNumber = await nextDocumentNumber(tx, "R");
      const [reception] = await tx.insert(receptionsTable).values({
        receptionNumber,
        clientId,
        bicycleId,
        quoteId: quote.id,
        receivedByUserId: userId,
        customerReportedProblem: body.customerComment ?? null,
        initialVisualCondition: body.initialVisualCondition ?? null,
        accessoriesReceived: body.accessoriesReceived ?? null,
        internalNotes: body.mechanicComment ?? null,
        status: "ready_for_work_order",
        workCaseId: wc.id,
      }).returning();
      await tx.insert(timelineEventsTable).values({
        entityType: "reception", entityId: reception.id, userId,
        action: "reception_created", previousStatus: null, newStatus: "ready_for_work_order",
        comment: "Creado desde Nuevo Trabajo Rápido",
      });

      // 6. Work order from the approved quote (shared helper, same tx)
      const created = await createWorkOrderFromQuoteInternal(tx, quote.id, {
        mechanicId: body.assignedMechanicId ?? null,
      }, userId);

      return {
        workCaseId: wc.id,
        workCaseNumber: wc.workCaseNumber,
        quoteId: quote.id,
        receptionId: reception.id,
        workOrderId: created.id,
        workOrderNumber: created.workOrderNumber,
        estimatedDeliveryDate: created.estimatedDeliveryDate?.toISOString() ?? null,
      };
    });

    // Recalc TR status after commit (OT ready_to_work → TR in_work_order)
    await triggerWorkCaseRecalc(result.workCaseId, userId);

    res.status(201).json(result);
  } catch (e: any) {
    if (e instanceof QuickCreateError) { res.status(400).json({ error: e.message }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/:id/comment ────────────────────────────────────────────
// Adds a manual comment to the work_case timeline. No dedicated comments table:
// it is stored as a timeline_event whose `action` carries the selectable type.
const commentTypeEnum = z.enum([
  "recepcion", "durante_trabajo", "aprobacion_cliente",
  "observacion_tecnica", "entrega", "interno",
]);
const addCommentSchema = z.object({
  commentType: commentTypeEnum,
  comment: z.string().min(1),
  visibleToClient: z.boolean().optional(),
});
router.post("/:id/comment", async (req, res) => {
  const userId = (req.session as any).userId ?? null;
  const wcId = Number(req.params.id);
  if (!Number.isFinite(wcId)) { res.status(400).json({ error: "ID inválido" }); return; }
  const parsed = addCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  try {
    const [wc] = await db.select({ id: workCasesTable.id }).from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Trabajo no encontrado" }); return; }
    const [event] = await db.insert(timelineEventsTable).values({
      entityType: "work_case",
      entityId: wcId,
      userId,
      action: `comment_${parsed.data.commentType}`,
      previousStatus: null,
      newStatus: null,
      comment: parsed.data.comment,
      visibleToClient: parsed.data.visibleToClient ?? false,
    }).returning();
    res.status(201).json(event);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-cases/:id/timeline ────────────────────────────────────────────
// IMPORTANT: before /:id
router.get("/:id/timeline", async (req, res) => {
  try {
    const wcId = Number(req.params.id);

    // Gather linked document IDs
    const linkedQuotes = await db.select({ id: quotesTable.id })
      .from(quotesTable)
      .where(and(eq(quotesTable.workCaseId, wcId), eq(quotesTable.active, true)));
    const linkedReceptions = await db.select({ id: receptionsTable.id })
      .from(receptionsTable)
      .where(and(eq(receptionsTable.workCaseId, wcId), eq(receptionsTable.active, true)));
    const linkedWorkOrders = await db.select({ id: workOrdersTable.id })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.workCaseId, wcId), eq(workOrdersTable.active, true)));

    const quoteIds = linkedQuotes.map(q => q.id);
    const receptionIds = linkedReceptions.map(r => r.id);
    const workOrderIds = linkedWorkOrders.map(wo => wo.id);

    // Build OR conditions for all linked documents + work_case itself
    const whereConditions: any[] = [
      and(eq(timelineEventsTable.entityType, "work_case"), eq(timelineEventsTable.entityId, wcId)),
    ];
    if (quoteIds.length > 0) whereConditions.push(and(eq(timelineEventsTable.entityType, "quote"), inArray(timelineEventsTable.entityId, quoteIds)));
    if (receptionIds.length > 0) whereConditions.push(and(eq(timelineEventsTable.entityType, "reception"), inArray(timelineEventsTable.entityId, receptionIds)));
    if (workOrderIds.length > 0) whereConditions.push(and(eq(timelineEventsTable.entityType, "work_order"), inArray(timelineEventsTable.entityId, workOrderIds)));

    const events = await db
      .select({ event: timelineEventsTable, userName: usersTable.name })
      .from(timelineEventsTable)
      .leftJoin(usersTable, eq(timelineEventsTable.userId, usersTable.id))
      .where(or(...whereConditions))
      .orderBy(desc(timelineEventsTable.createdAt));

    res.json(events.map(e => ({ ...e.event, userName: e.userName ?? null })));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/:id/recalculate-status ─────────────────────────────────
router.post("/:id/recalculate-status", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Not found" }); return; }
    const previousStatus = wc.status;
    await recalcWorkCaseStatus(wcId);
    const [updated] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (updated.status !== previousStatus) {
      await logEvent(wcId, "work_case_status_changed", userId, previousStatus, updated.status);
    }
    res.json(await enrichWorkCase(updated));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/:id/link-quote ─────────────────────────────────────────
router.post("/:id/link-quote", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const { quoteId } = z.object({ quoteId: z.number().int().positive() }).parse(req.body);

    const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Work case not found" }); return; }
    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }
    if (quote.workCaseId) { res.status(400).json({ error: "Este presupuesto ya pertenece a un trabajo" }); return; }

    await db.update(quotesTable).set({ workCaseId: wcId, updatedAt: new Date() }).where(eq(quotesTable.id, quoteId));
    await logWorkCaseEvent(wcId, "quote_linked_to_work_case", userId, undefined, undefined, `Presupuesto ${quote.quoteNumber} vinculado`, "quote", quoteId);
    await recalcHelper(wcId);

    const [updated] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    res.json(await enrichWorkCase(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/:id/link-reception ──────────────────────────────────────
router.post("/:id/link-reception", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const { receptionId } = z.object({ receptionId: z.number().int().positive() }).parse(req.body);

    const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Work case not found" }); return; }
    const [reception] = await db.select().from(receptionsTable).where(eq(receptionsTable.id, receptionId));
    if (!reception) { res.status(404).json({ error: "Reception not found" }); return; }
    if (reception.workCaseId) { res.status(400).json({ error: "Esta recepción ya pertenece a un trabajo" }); return; }

    await db.update(receptionsTable).set({ workCaseId: wcId, updatedAt: new Date() }).where(eq(receptionsTable.id, receptionId));
    await logWorkCaseEvent(wcId, "reception_linked_to_work_case", userId, undefined, undefined, `Recepción ${reception.receptionNumber} vinculada`, "reception", receptionId);
    await recalcHelper(wcId);

    const [updated] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    res.json(await enrichWorkCase(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-cases/:id/link-work-order ──────────────────────────────────────
router.post("/:id/link-work-order", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const { workOrderId } = z.object({ workOrderId: z.number().int().positive() }).parse(req.body);

    const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Work case not found" }); return; }
    const [workOrder] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    if (!workOrder) { res.status(404).json({ error: "Work order not found" }); return; }
    if (workOrder.workCaseId) { res.status(400).json({ error: "Esta OT ya pertenece a un trabajo" }); return; }

    await db.update(workOrdersTable).set({ workCaseId: wcId, updatedAt: new Date() }).where(eq(workOrdersTable.id, workOrderId));
    await logWorkCaseEvent(wcId, "work_order_linked_to_work_case", userId, undefined, undefined, `OT ${workOrder.workOrderNumber} vinculada`, "work_order", workOrderId);
    await recalcHelper(wcId);

    const [updated] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    res.json(await enrichWorkCase(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-cases/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const [wc] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!wc) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichWorkCase(wc));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /work-cases/:id ───────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const userId = (req.session as any).userId ?? null;
    const body = z.object({
      status: z.string().optional(),
      originChannel: z.string().optional(),
      initialRequirement: z.string().optional(),
      assignedMechanicId: z.number().int().nullable().optional(),
      bicycleId: z.number().int().nullable().optional(),
      active: z.boolean().optional(),
    }).parse(req.body);

    const [existing] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: Partial<typeof workCasesTable.$inferInsert> = { updatedAt: new Date() };
    if (body.status !== undefined) updates.status = body.status as any;
    if (body.originChannel !== undefined) updates.originChannel = body.originChannel;
    if (body.initialRequirement !== undefined) updates.initialRequirement = body.initialRequirement;
    if (body.assignedMechanicId !== undefined) updates.assignedMechanicId = body.assignedMechanicId;
    if (body.bicycleId !== undefined) updates.bicycleId = body.bicycleId;
    if (body.active !== undefined) updates.active = body.active;

    const [updated] = await db.update(workCasesTable).set(updates).where(eq(workCasesTable.id, wcId)).returning();

    if (body.status && body.status !== existing.status) {
      await logEvent(wcId, "work_case_status_changed", userId, existing.status, body.status);
    }

    res.json(await enrichWorkCase(updated));
  } catch (e: any) {
    if (e?.issues) { res.status(400).json({ error: e.message }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /work-cases/:id ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const wcId = Number(req.params.id);
    const [existing] = await db.select().from(workCasesTable).where(eq(workCasesTable.id, wcId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.update(workCasesTable).set({ active: false, updatedAt: new Date() }).where(eq(workCasesTable.id, wcId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export { recalcWorkCaseStatus };
export default router;
