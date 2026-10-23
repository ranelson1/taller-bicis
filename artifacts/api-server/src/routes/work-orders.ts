import express, { Router } from "express";
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
  servicesTable,
  paymentMethodsTable,
  workCasesTable,
  workOrderPhotosTable,
  timelineEventsTable,
} from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, asc, count, inArray, isNull, not } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth";
import { triggerWorkCaseRecalc, createWorkOrderFromQuoteInternal, recalcOTTotal, isUniqueViolation } from "../helpers/workCase";
import {
  buildPublicWorkOrder, decideWorkOrderItem, ensurePublicToken, formatCLP, ItemDecisionError, logWorkOrderEvent, shareMessage,
} from "../helpers/workOrderPublic";
import { estimateCompletionDate } from "../helpers/completionEstimate";
import { buildWorkOrderPdf, sendPdf } from "../helpers/workOrderPdfFile";
import { consumeWorkOrderStock, returnWorkOrderStock, workOrderEconomics } from "../helpers/inventory";
import { ALLOWED_TYPES, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, VIDEO_TYPES, AUDIO_TYPES, deletePhotoFile, photoPath, savePhoto, sniffImageType, sniffVideoType, sniffAudioType } from "../helpers/photoStorage";

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

// Datos relacionados de varias OT con una consulta por tabla (no una por OT): la lista de un
// taller con historial trae cientos de OT y todas sus consultas comparten la conexión del request.
async function enrichWorkOrders(rows: (typeof workOrdersTable.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = (pick: (wo: typeof rows[number]) => number | null) =>
    [...new Set(rows.map(pick).filter((x): x is number => x != null))];
  const byId = async <T extends { id: number }>(list: number[], load: (ids: number[]) => Promise<T[]>) =>
    new Map((list.length ? await load(list) : []).map(r => [r.id, r]));

  const clients = await byId(ids(w => w.clientId), l => db.select({ id: clientsTable.id, name: clientsTable.name, phone: clientsTable.phone }).from(clientsTable).where(inArray(clientsTable.id, l)));
  const bikes = await byId(ids(w => w.bicycleId), l => db.select({ id: bicyclesTable.id, brand: bicyclesTable.brand, model: bicyclesTable.model }).from(bicyclesTable).where(inArray(bicyclesTable.id, l)));
  const mechanics = await byId(ids(w => w.mechanicId), l => db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, l)));
  const quotes = await byId(ids(w => w.quoteId), l => db.select({ id: quotesTable.id, number: quotesTable.quoteNumber }).from(quotesTable).where(inArray(quotesTable.id, l)));
  const receptions = await byId(ids(w => w.receptionId), l => db.select({ id: receptionsTable.id, number: receptionsTable.receptionNumber }).from(receptionsTable).where(inArray(receptionsTable.id, l)));
  const methods = await byId(ids(w => w.paymentMethodId), l => db.select({ id: paymentMethodsTable.id, name: paymentMethodsTable.name }).from(paymentMethodsTable).where(inArray(paymentMethodsTable.id, l)));
  const cases = await byId(ids(w => w.workCaseId), l => db.select({ id: workCasesTable.id, number: workCasesTable.workCaseNumber }).from(workCasesTable).where(inArray(workCasesTable.id, l)));
  // Adicionales que esperan la decisión del cliente.
  const pending = new Map((await db.select({ id: workOrderItemsTable.workOrderId, n: count() }).from(workOrderItemsTable).where(and(
    inArray(workOrderItemsTable.workOrderId, rows.map(w => w.id)),
    eq(workOrderItemsTable.active, true),
    eq(workOrderItemsTable.approvalStatus, "pending"),
    not(eq(workOrderItemsTable.status, "cancelled")),
  )).groupBy(workOrderItemsTable.workOrderId)).map(r => [r.id, Number(r.n)]));

  return rows.map(wo => {
    const client = clients.get(wo.clientId);
    const bike = bikes.get(wo.bicycleId);
    return {
      ...wo,
      clientName: client?.name ?? null,
      clientPhone: client?.phone ?? null,
      paymentMethodName: wo.paymentMethodId ? methods.get(wo.paymentMethodId)?.name ?? null : null,
      paidAmount: wo.paidAmount != null ? Number(wo.paidAmount) : null,
      pendingApprovalCount: pending.get(wo.id) ?? 0,
      bicycleName: bike ? `${bike.brand} ${bike.model}` : null,
      mechanicName: wo.mechanicId ? mechanics.get(wo.mechanicId)?.name ?? null : null,
      quoteNumber: wo.quoteId ? quotes.get(wo.quoteId)?.number ?? null : null,
      receptionNumber: wo.receptionId ? receptions.get(wo.receptionId)?.number ?? null : null,
      workCaseNumber: wo.workCaseId ? cases.get(wo.workCaseId)?.number ?? null : null,
      total: wo.total ? Number(wo.total) : 0,
      estimatedLaborHours: wo.estimatedLaborHours ? Number(wo.estimatedLaborHours) : 0,
      progressPercentage: wo.progressPercentage ? Number(wo.progressPercentage) : 0,
    };
  });
}

async function enrichWorkOrder(wo: typeof workOrdersTable.$inferSelect) {
  return (await enrichWorkOrders([wo]))[0];
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

    const enriched = await enrichWorkOrders(rows);

    // Filter by search (work order number, client name or phone, bicycle name)
    const q = search?.toLowerCase().trim() ?? "";
    const qDigits = q.replace(/\D/g, "");
    const filtered = q
      ? enriched.filter(wo =>
          wo.workOrderNumber.toLowerCase().includes(q) ||
          (wo.clientName ?? "").toLowerCase().includes(q) ||
          (wo.bicycleName ?? "").toLowerCase().includes(q) ||
          (qDigits.length >= 3 && (wo.clientPhone ?? "").replace(/\D/g, "").includes(qDigits))
        )
      : enriched;

    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id ──────────────────────────────────────────────────────
// GET /work-orders/:id/pdf — comprobante en PDF, igual al que recibe el cliente.
router.get("/:id/pdf", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!row) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    const url = row.publicToken ? `${req.protocol}://${req.get("host")}/ot/${row.publicToken}` : undefined;
    sendPdf(res, await buildWorkOrderPdf(row, url));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
    paidAt: z.string().nullable().optional(),
    paymentMethodId: z.number().int().positive().nullable().optional(),
    paidAmount: z.number().min(0).nullable().optional(),
    internalNotes: z.string().nullable().optional(),
    customerNotes: z.string().nullable().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const userId = (req.session as any)?.userId ?? null;

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
    if (parsed.data.paidAt !== undefined) {
      updates.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;
      // Anular el pago borra también su método y monto.
      if (!parsed.data.paidAt) { updates.paymentMethodId = null; updates.paidAmount = null; }
    }
    if (parsed.data.paidAt && parsed.data.paymentMethodId !== undefined) updates.paymentMethodId = parsed.data.paymentMethodId;
    if (parsed.data.paidAt && parsed.data.paidAmount !== undefined) {
      updates.paidAmount = parsed.data.paidAmount != null ? String(parsed.data.paidAmount) : null;
    }
    if (parsed.data.internalNotes !== undefined) updates.internalNotes = parsed.data.internalNotes;
    if (parsed.data.customerNotes !== undefined) updates.customerNotes = parsed.data.customerNotes;

    const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();
    if (parsed.data.paidAt !== undefined && Boolean(wo.paidAt) !== Boolean(updated.paidAt)) {
      const enrichedPaid = await enrichWorkOrder(updated);
      const detail = updated.paidAt
        ? [enrichedPaid.paymentMethodName, updated.paidAmount != null ? formatCLP(Number(updated.paidAmount)) : null].filter(Boolean).join(" · ") || undefined
        : undefined;
      await logEvent(id, updated.paidAt ? "payment_registered" : "payment_removed", userId, undefined, undefined, detail);
    }
    res.json(await enrichWorkOrder(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Fotos de la OT ────────────────────────────────────────────────────────────
// El celular sube cada foto ya reducida (image/jpeg|png|webp) o un video (mp4|mov|webm) como cuerpo binario.

const photoView = (p: typeof workOrderPhotosTable.$inferSelect) => ({
  id: p.id,
  workOrderId: p.workOrderId,
  note: p.note,
  visibleToClient: p.visibleToClient,
  sizeBytes: p.sizeBytes,
  mimeType: p.mimeType,
  createdAt: p.createdAt.toISOString(),
  url: `/api/work-orders/${p.workOrderId}/photos/${p.id}/file`,
});

router.get("/:id/photos", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const photos = await db.select().from(workOrderPhotosTable)
      .where(and(eq(workOrderPhotosTable.workOrderId, id), eq(workOrderPhotosTable.active, true)))
      .orderBy(asc(workOrderPhotosTable.createdAt));
    res.json(photos.map(photoView));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/photos",
  express.raw({ type: [...Object.keys(ALLOWED_TYPES), ...Object.keys(VIDEO_TYPES), ...Object.keys(AUDIO_TYPES)], limit: MAX_VIDEO_BYTES }),
  async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = (req.session as any)?.userId ?? null;
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Envía una imagen (JPG, PNG, WebP), un video (MP4, MOV, WebM) o una nota de voz" });
      return;
    }
    const declared = String(req.headers["content-type"] ?? "");
    const imageType = sniffImageType(body);
    const audioType = declared.toLowerCase().startsWith("audio/") ? sniffAudioType(body, declared) : null;
    const mimeType = imageType ?? audioType ?? (declared.toLowerCase().startsWith("audio/") ? null : sniffVideoType(body));
    if (!mimeType) {
      res.status(400).json({ error: "El archivo no es una imagen, un video ni un audio válido" });
      return;
    }
    if (audioType && body.length > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: "El audio pesa más de 25 MB" });
      return;
    }
    if (imageType && body.length > MAX_PHOTO_BYTES) {
      res.status(413).json({ error: "La foto pesa más de 8 MB" });
      return;
    }
    const note = typeof req.query.note === "string" ? req.query.note.trim().slice(0, 500) || null : null;
    try {
      const [wo] = await db.select({ id: workOrdersTable.id, workshopId: workOrdersTable.workshopId }).from(workOrdersTable).where(eq(workOrdersTable.id, id));
      if (!wo) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
      const storageKey = await savePhoto(wo.workshopId, id, body, mimeType);
      const [photo] = await db.insert(workOrderPhotosTable).values({
        workOrderId: id, storageKey, mimeType, sizeBytes: body.length, note, uploadedByUserId: userId,
      }).returning();
      await logEvent(id, "photo_added", userId, undefined, undefined, note ?? undefined);
      res.status(201).json(photoView(photo));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

router.patch("/:id/photos/:photoId", async (req, res) => {
  const id = parseInt(req.params.id);
  const photoId = parseInt(req.params.photoId);
  const parsed = z.object({
    note: z.string().max(500).nullable().optional(),
    visibleToClient: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.note !== undefined) updates.note = parsed.data.note?.trim() || null;
    if (parsed.data.visibleToClient !== undefined) updates.visibleToClient = parsed.data.visibleToClient;
    const [photo] = await db.update(workOrderPhotosTable).set(updates)
      .where(and(eq(workOrderPhotosTable.id, photoId), eq(workOrderPhotosTable.workOrderId, id), eq(workOrderPhotosTable.active, true)))
      .returning();
    if (!photo) { res.status(404).json({ error: "Foto no encontrada" }); return; }
    res.json(photoView(photo));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id/photos/:photoId", async (req, res) => {
  const id = parseInt(req.params.id);
  const photoId = parseInt(req.params.photoId);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [photo] = await db.update(workOrderPhotosTable).set({ active: false, updatedAt: new Date() })
      .where(and(eq(workOrderPhotosTable.id, photoId), eq(workOrderPhotosTable.workOrderId, id), eq(workOrderPhotosTable.active, true)))
      .returning();
    if (!photo) { res.status(404).json({ error: "Foto no encontrada" }); return; }
    await deletePhotoFile(photo.storageKey);
    await logEvent(id, "photo_deleted", userId, undefined, undefined, photo.note ?? undefined);
    res.json(photoView(photo));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/photos/:photoId/file", async (req, res) => {
  const id = parseInt(req.params.id);
  const photoId = parseInt(req.params.photoId);
  try {
    const [photo] = await db.select().from(workOrderPhotosTable)
      .where(and(eq(workOrderPhotosTable.id, photoId), eq(workOrderPhotosTable.workOrderId, id), eq(workOrderPhotosTable.active, true)));
    if (!photo) { res.status(404).end(); return; }
    res.type(photo.mimeType).set("Cache-Control", "private, no-cache").sendFile(photoPath(photo.storageKey));
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// ── POST /work-orders/:id/quote-approval ─────────────────────────────────────
// El taller registra que el cliente aprobó la cotización (en persona, por teléfono o WhatsApp), o lo deshace.
router.post("/:id/quote-approval", async (req, res) => {
  const parsed = z.object({ approved: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [row] = await db.update(workOrdersTable)
      .set({ quoteApprovedAt: parsed.data.approved ? new Date() : null, quoteApprovedBy: parsed.data.approved ? "staff" : null, updatedAt: new Date() })
      .where(eq(workOrdersTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    await logEvent(id, "quote_approved", userId, "staff", undefined, parsed.data.approved ? "El taller registró la aprobación de la cotización" : "El taller quitó la aprobación de la cotización");
    res.json((await enrichWorkOrders([row]))[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /work-orders/:id/economics ────────────────────────────────────────────
// Lo cobrado, lo que costaron repuestos/insumos y la mano de obra, y el margen. Solo admin.
router.get("/:id/economics", async (req, res) => {
  if (res.locals.userRole !== "admin") { res.status(403).json({ error: "Solo un administrador ve los márgenes" }); return; }
  try {
    const eco = await workOrderEconomics(parseInt(req.params.id));
    if (!eco) { res.status(404).json({ error: "Orden de trabajo no encontrada" }); return; }
    res.json(eco);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/estimate-preview ────────────────────────────────────────
// Término estimado de un trabajo que aún no se crea (Nuevo trabajo). No guarda nada.
router.post("/estimate-preview", async (req, res) => {
  const parsed = z.object({
    laborHours: z.number().min(0),
    mechanicId: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const e = await estimateCompletionDate(db, parsed.data);
    res.json({
      date: e.date.toISOString(),
      backlogHours: Math.round(e.backlogHours * 10) / 10,
      jobHours: e.jobHours,
      dailyCapacityHours: Math.round(e.dailyCapacityHours * 10) / 10,
      workdays: e.workdays,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/estimate ────────────────────────────────────────────
// Recalcula el término estimado según la carga actual del taller (excluyendo esta OT).
router.post("/:id/estimate", async (req, res) => {
  const id = parseInt(req.params.id);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!wo) {
      res.status(404).json({ error: "Orden de trabajo no encontrada" });
      return;
    }
    if (wo.status === "delivered" || wo.status === "cancelled" || wo.completedAt) {
      res.status(400).json({ error: "La orden ya está terminada" });
      return;
    }

    // Horas de lo que falta: ítems aprobados no cancelados ni descuentos, descontando el avance.
    const items = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.workOrderId, id), eq(workOrderItemsTable.active, true)));
    const billable = items.filter(i => i.approvalStatus === "approved" && i.status !== "cancelled" && i.itemType !== "discount");
    // Ítems sin horas (OT antiguas): se usan las del servicio de catálogo del que vienen o,
    // si no quedó el vínculo, las del servicio con el mismo nombre.
    const missing = billable.filter(i => i.estimatedLaborHours == null && i.quoteItemId).map(i => i.quoteItemId!);
    const hoursByQuoteItem = new Map((missing.length === 0 ? [] : await db
      .select({ quoteItemId: quoteItemsTable.id, hours: servicesTable.estimatedHours })
      .from(quoteItemsTable)
      .innerJoin(servicesTable, eq(servicesTable.id, quoteItemsTable.serviceId))
      .where(inArray(quoteItemsTable.id, missing)))
      .map(r => [r.quoteItemId, Number(r.hours ?? 0)]));
    const hoursByName = new Map((await db
      .select({ name: servicesTable.name, hours: servicesTable.estimatedHours })
      .from(servicesTable).where(eq(servicesTable.active, true)))
      .map(s => [s.name.trim().toLowerCase(), Number(s.hours ?? 0)]));
    const itemHours = (i: typeof billable[number]) => {
      if (i.estimatedLaborHours != null) return Number(i.estimatedLaborHours);
      const perUnit = hoursByQuoteItem.get(i.quoteItemId ?? -1)
        ?? (i.itemType === "service" ? hoursByName.get(i.description.trim().toLowerCase()) : undefined) ?? 0;
      return perUnit * Number(i.quantity);
    };
    const hours = billable.reduce((s, i) => s + itemHours(i), 0);
    const remaining = hours * (1 - Number(wo.progressPercentage ?? 0) / 100);

    const estimate = await estimateCompletionDate(db, { laborHours: remaining, mechanicId: wo.mechanicId, excludeWorkOrderId: id });
    const [updated] = await db.update(workOrdersTable)
      .set({ estimatedDeliveryDate: estimate.date, updatedAt: new Date() })
      .where(eq(workOrdersTable.id, id))
      .returning();
    await logEvent(id, "estimate_recalculated", userId, undefined, undefined,
      `${estimate.date.toLocaleDateString("es-CL")} · ${estimate.backlogHours.toFixed(1)} h en cola + ${estimate.jobHours.toFixed(1)} h de este trabajo`);
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
    // Iniciar sin mecánico: lo toma quien aprieta el botón si hace trabajos, o el único que los hace
    // (taller de una persona). Solo se pide elegir cuando hay varios.
    let assignedMechanicId: number | null = null;
    if (target === "in_progress" && !wo.mechanicId) {
      const workers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.active, true), eq(usersTable.doesJobs, true)));
      assignedMechanicId = workers.find(w => w.id === userId)?.id ?? (workers.length === 1 ? workers[0].id : null);
      if (!assignedMechanicId) {
        res.status(400).json({ error: "Debes asignar un mecánico antes de iniciar el trabajo." });
        return;
      }
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
    if (assignedMechanicId) updates.mechanicId = assignedMechanicId;
    if (parsed.data.status === "ready_for_pickup") updates.completedAt = now;
    // Volver a trabajar una OT terminada: el término real será cuando vuelva a quedar lista.
    if (["ready_to_work", "in_progress", "quality_control"].includes(parsed.data.status)) updates.completedAt = null;
    if (parsed.data.status === "delivered") updates.deliveredAt = now;

    await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id));
    // Stock: al quedar lista se descuentan repuestos e insumos; si vuelve a reparación, se devuelven.
    if (target === "ready_for_pickup") await consumeWorkOrderStock(id, userId);
    if (wo.status === "ready_for_pickup" && ["in_progress", "quality_control", "ready_to_work"].includes(target)) {
      await returnWorkOrderStock(id, userId);
    }
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
      // Enlace al catálogo: el repuesto sale del stock y el servicio gasta sus insumos.
      partId: data.partId ?? null,
      serviceId: data.serviceId ?? null,
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
      message: shareMessage(wo, view.clientName, view.pendingApprovalCount, view.workshopName),
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
    // Sus pasos del checklist ya no se harán: no deben frenar el avance.
    await db.update(workOrderChecklistItemsTable)
      .set({ status: "not_applicable", updatedAt: new Date() })
      .where(and(
        eq(workOrderChecklistItemsTable.workOrderItemId, itemId),
        not(inArray(workOrderChecklistItemsTable.status, ["completed", "with_observation", "not_applicable"] as const)),
      ));
    await logEvent(workOrderId, "item_cancelled", userId, item.status, "cancelled", item.description);
    await recalcProgress(workOrderId);
    await recalcOTTotal(workOrderId, userId);
    res.json({ ...updated, quantity: Number(updated.quantity), unitPrice: Number(updated.unitPrice), total: Number(updated.total) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /work-orders/:id/items/:itemId/warranty ───────────────────────────────
// Pasa el ítem por garantía: queda en $0 para el cliente (el costo de los materiales sigue contando en tus números)
// y en la descripción queda cuánto valía.
router.post("/:id/items/:itemId/warranty", async (req, res) => {
  const workOrderId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  const userId = (req.session as any)?.userId ?? null;
  try {
    const [item] = await db.select().from(workOrderItemsTable)
      .where(and(eq(workOrderItemsTable.id, itemId), eq(workOrderItemsTable.workOrderId, workOrderId), eq(workOrderItemsTable.active, true)));
    if (!item) { res.status(404).json({ error: "Ítem no encontrado" }); return; }
    if (Number(item.total) <= 0) { res.status(400).json({ error: "Este ítem ya está sin cobro" }); return; }
    const worth = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(item.total));
    const [updated] = await db.update(workOrderItemsTable)
      .set({ unitPrice: "0", total: "0", description: `${item.description} · por garantía (valor ${worth})`, updatedAt: new Date() })
      .where(eq(workOrderItemsTable.id, itemId)).returning();
    await logEvent(workOrderId, "item_warranty", userId, undefined, undefined, `${item.description} (${worth})`);
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
