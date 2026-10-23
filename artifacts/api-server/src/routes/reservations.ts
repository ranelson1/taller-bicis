import { Router } from "express";
import { z } from "zod/v4";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, reservationsTable, clientsTable, servicesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { estimateCompletionDate, MIN_JOB_HOURS } from "../helpers/completionEstimate";

// Reservas: espacio apartado para una bici que va a llegar. No consumen número de OT.
const router = Router();
router.use(requireAuth);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const quoteItemSchema = z.object({
  itemType: z.enum(["service", "part", "additional_labor", "other"]),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().min(0.001).max(999).default(1),
  unitPrice: z.number().min(0).max(100_000_000),
  hours: z.number().min(0).max(200).default(0),
  serviceId: z.number().int().positive().nullable().optional(),
});
const baseSchema = z.object({
  clientId: z.number().int().positive().nullable().optional(),
  clientName: z.string().trim().min(1, "Falta el nombre del cliente").optional(),
  clientPhone: z.string().trim().nullable().optional(),
  bicycleText: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
  serviceId: z.number().int().positive().nullable().optional(),
  estimatedHours: z.number().min(0).max(200).nullable().optional(),
  quoteItems: z.array(quoteItemSchema).max(30).optional(),
  expectedOn: day,
  expectedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

type Row = typeof reservationsTable.$inferSelect;

// Horas de la reserva: las indicadas o, si no, las del servicio elegido.
async function hoursFor(serviceId: number | null | undefined, hours: number | null | undefined, items?: { hours: number; quantity: number }[]) {
  if (hours != null) return hours;
  const fromItems = (items ?? []).reduce((s, i) => s + i.hours * i.quantity, 0);
  if (fromItems > 0) return fromItems;
  if (!serviceId) return null;
  const [s] = await db.select({ h: servicesTable.estimatedHours }).from(servicesTable).where(eq(servicesTable.id, serviceId));
  return s?.h != null ? Number(s.h) : null;
}

async function view(r: Row) {
  const open = r.status === "reserved";
  const est = open
    ? await estimateCompletionDate(db, { laborHours: Number(r.estimatedHours ?? 0), arrival: new Date(`${r.expectedOn}T12:00:00`), excludeReservationId: r.id })
    : null;
  return {
    id: r.id, clientId: r.clientId, clientName: r.clientName, clientPhone: r.clientPhone, bicycleText: r.bicycleText, note: r.note,
    serviceId: r.serviceId, quoteItems: r.quoteItems ?? [],
    quoteTotal: (r.quoteItems ?? []).reduce((s, i) => s + i.quantity * i.unitPrice, 0),
    estimatedHours: r.estimatedHours != null ? Number(r.estimatedHours) : null,
    expectedOn: r.expectedOn, expectedTime: r.expectedTime, status: r.status, workCaseId: r.workCaseId, workOrderId: r.workOrderId,
    createdAt: r.createdAt.toISOString(),
    startsOn: est?.startDate.toISOString() ?? null,
    estimatedDeliveryDate: est?.date.toISOString() ?? null,
  };
}

// GET /reservations — las que esperan al cliente, por día de llegada.
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(reservationsTable)
      .where(eq(reservationsTable.status, "reserved"))
      .orderBy(asc(reservationsTable.expectedOn), asc(reservationsTable.expectedTime), asc(reservationsTable.id));
    res.json(await Promise.all(rows.map(view)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /reservations/preview — fechas de ingreso y entrega de una reserva que todavía no se guarda.
router.post("/preview", async (req, res) => {
  const parsed = z.object({
    expectedOn: day, serviceId: z.number().int().positive().nullable().optional(), estimatedHours: z.number().min(0).nullable().optional(),
    excludeReservationId: z.number().int().positive().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const hours = (await hoursFor(parsed.data.serviceId, parsed.data.estimatedHours)) ?? 0;
    const e = await estimateCompletionDate(db, {
      laborHours: hours, arrival: new Date(`${parsed.data.expectedOn}T12:00:00`), excludeReservationId: parsed.data.excludeReservationId,
    });
    res.json({
      startsOn: e.startDate.toISOString(), estimatedDeliveryDate: e.date.toISOString(),
      jobHours: Math.max(hours, MIN_JOB_HOURS), backlogHours: Math.round(e.backlogHours * 10) / 10,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /reservations
router.post("/", async (req, res) => {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }); return; }
  const d = parsed.data;
  try {
    let name = d.clientName ?? null;
    let phone = d.clientPhone ?? null;
    if (d.clientId) {
      const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, d.clientId));
      if (!c) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
      name = c.name; phone = phone ?? c.phone ?? null;
    }
    if (!name) { res.status(400).json({ error: "Falta el nombre del cliente" }); return; }
    const items = d.quoteItems ?? [];
    const firstService = items.find(i => i.itemType === "service" && i.serviceId)?.serviceId ?? null;
    const hours = await hoursFor(d.serviceId ?? firstService, d.estimatedHours, items);
    const [row] = await db.insert(reservationsTable).values({
      clientId: d.clientId ?? null, clientName: name, clientPhone: phone, bicycleText: d.bicycleText || null, note: d.note || null,
      serviceId: d.serviceId ?? firstService, quoteItems: items, estimatedHours: hours != null ? String(hours) : null,
      expectedOn: d.expectedOn, expectedTime: d.expectedTime ?? null, createdByUserId: (req.session as any)?.userId ?? null,
    }).returning();
    res.status(201).json(await view(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /reservations/:id — cambia lo acordado o la cierra (cancelada / no llegó).
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = baseSchema.partial().extend({ status: z.enum(["reserved", "cancelled", "no_show"]).optional() }).safeParse(req.body);
  if (!parsed.success || isNaN(id)) { res.status(400).json({ error: "Invalid input" }); return; }
  const d = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["clientName", "clientPhone", "bicycleText", "note", "serviceId", "expectedOn", "expectedTime", "status", "clientId"] as const) {
      if (d[k] !== undefined) updates[k] = d[k];
    }
    if (d.quoteItems !== undefined) updates.quoteItems = d.quoteItems;
    if (d.estimatedHours !== undefined || d.serviceId !== undefined || d.quoteItems !== undefined) {
      const hours = await hoursFor(d.serviceId, d.estimatedHours, d.quoteItems);
      if (d.estimatedHours !== undefined || hours != null) updates.estimatedHours = hours != null ? String(hours) : null;
    }
    const [row] = await db.update(reservationsTable).set(updates)
      .where(and(eq(reservationsTable.id, id), inArray(reservationsTable.status, ["reserved", "cancelled", "no_show"]))).returning();
    if (!row) { res.status(404).json({ error: "Reserva no encontrada" }); return; }
    res.json(await view(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reservations/:id — para precargar Nuevo trabajo cuando llega el cliente.
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(reservationsTable).where(eq(reservationsTable.id, id));
    if (!row) { res.status(404).json({ error: "Reserva no encontrada" }); return; }
    res.json(await view(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
