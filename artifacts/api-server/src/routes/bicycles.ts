import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { bicyclesTable, clientsTable, workOrdersTable, workOrderItemsTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

const bikeTypeEnum = z.enum(["mtb", "road", "gravel", "urban", "ebike", "kids", "other"]);

const currentYear = new Date().getFullYear();
const createBicycleSchema = z.object({
  clientId: z.number().int().positive(),
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(currentYear + 1).optional().nullable(),
  type: bikeTypeEnum,
  color: z.string().optional().nullable(),
  rimSize: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const updateBicycleSchema = createBicycleSchema.partial().extend({
  active: z.boolean().optional(),
});

const BIKE_FIELDS = {
  id: bicyclesTable.id,
  clientId: bicyclesTable.clientId,
  clientName: clientsTable.name,
  brand: bicyclesTable.brand,
  model: bicyclesTable.model,
  year: bicyclesTable.year,
  type: bicyclesTable.type,
  color: bicyclesTable.color,
  rimSize: bicyclesTable.rimSize,
  serialNumber: bicyclesTable.serialNumber,
  notes: bicyclesTable.notes,
  setupNotes: bicyclesTable.setupNotes,
  setupUpdatedAt: bicyclesTable.setupUpdatedAt,
  active: bicyclesTable.active,
  createdAt: bicyclesTable.createdAt,
  updatedAt: bicyclesTable.updatedAt,
} as const;

router.get("/", async (req, res) => {
  try {
    const clientIdParam = req.query.clientId ? parseInt(req.query.clientId as string) : null;
    const conditions = [];
    if (clientIdParam && !isNaN(clientIdParam)) {
      conditions.push(eq(bicyclesTable.clientId, clientIdParam));
    }
    const rows = await db.select(BIKE_FIELDS)
      .from(bicyclesTable)
      .leftJoin(clientsTable, eq(clientsTable.id, bicyclesTable.clientId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(bicyclesTable.brand);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createBicycleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { clientId, brand, model, year, type, color, rimSize, serialNumber, notes } = parsed.data;
  try {
    const [row] = await db.insert(bicyclesTable).values({
      clientId, brand, model, type,
      year: year ?? null,
      color: color ?? null, rimSize: rimSize ?? null, serialNumber: serialNumber ?? null, notes: notes ?? null,
    }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select(BIKE_FIELDS).from(bicyclesTable)
      .leftJoin(clientsTable, eq(clientsTable.id, bicyclesTable.clientId))
      .where(eq(bicyclesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

// GET /bicycles/:id/history — trabajos de la bici, con sus servicios, y cuándo fue el último de cada tipo.
router.get("/:id/history", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [bike] = await db.select(BIKE_FIELDS).from(bicyclesTable)
      .leftJoin(clientsTable, eq(clientsTable.id, bicyclesTable.clientId)).where(eq(bicyclesTable.id, id));
    if (!bike) { res.status(404).json({ error: "Not found" }); return; }

    const orders = await db.select({
      id: workOrdersTable.id, number: workOrdersTable.workOrderNumber, workCaseId: workOrdersTable.workCaseId, status: workOrdersTable.status,
      createdAt: workOrdersTable.createdAt, completedAt: workOrdersTable.completedAt, deliveredAt: workOrdersTable.deliveredAt,
      total: workOrdersTable.total, mechanicName: usersTable.name,
    }).from(workOrdersTable).leftJoin(usersTable, eq(usersTable.id, workOrdersTable.mechanicId))
      .where(and(eq(workOrdersTable.bicycleId, id), eq(workOrdersTable.active, true)))
      .orderBy(desc(workOrdersTable.createdAt));

    const items = orders.length ? await db.select({
      workOrderId: workOrderItemsTable.workOrderId, description: workOrderItemsTable.description, itemType: workOrderItemsTable.itemType,
      total: workOrderItemsTable.total, serviceId: workOrderItemsTable.serviceId,
    }).from(workOrderItemsTable).where(and(
      inArray(workOrderItemsTable.workOrderId, orders.map(o => o.id)),
      eq(workOrderItemsTable.active, true), eq(workOrderItemsTable.approvalStatus, "approved"),
    )).orderBy(asc(workOrderItemsTable.sortOrder), asc(workOrderItemsTable.id)) : [];
    const live = items.filter(i => Number(i.total) >= 0);

    const jobs = orders.filter(o => o.status !== "cancelled").map(o => ({
      workOrderId: o.id, workCaseId: o.workCaseId, workOrderNumber: o.number, status: o.status,
      receivedAt: o.createdAt.toISOString(), deliveredAt: o.deliveredAt?.toISOString() ?? null,
      total: Number(o.total ?? 0), mechanicName: o.mechanicName ?? null,
      items: live.filter(i => i.workOrderId === o.id).map(i => ({ description: i.description, itemType: i.itemType, total: Number(i.total), serviceId: i.serviceId })),
    }));

    // Último servicio de cada tipo, solo de trabajos ya terminados (lista para retiro o entregada).
    const done = new Map(orders.filter(o => o.status === "delivered" || o.status === "ready_for_pickup")
      .map(o => [o.id, (o.deliveredAt ?? o.completedAt ?? o.createdAt) as Date]));
    const byKey = new Map<string, { label: string; serviceId: number | null; lastOn: Date; count: number }>();
    for (const i of live) {
      const when = done.get(i.workOrderId);
      if (!when || i.itemType !== "service") continue;
      const label = i.description.split(" · ")[0].trim();
      const key = i.serviceId ? `s${i.serviceId}` : label.toLowerCase();
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { label, serviceId: i.serviceId ?? null, lastOn: when, count: 1 });
      else { cur.count += 1; if (when > cur.lastOn) cur.lastOn = when; }
    }
    const now = Date.now();
    const lastServices = [...byKey.values()].sort((a, b) => b.lastOn.getTime() - a.lastOn.getTime()).map(s => ({
      label: s.label, serviceId: s.serviceId, count: s.count, lastOn: s.lastOn.toISOString(),
      daysAgo: Math.max(0, Math.floor((now - s.lastOn.getTime()) / 86_400_000)),
    }));

    res.json({
      bicycle: bike, jobs, lastServices,
      totalSpent: jobs.filter(j => j.status === "delivered").reduce((s, j) => s + j.total, 0),
      deliveredCount: jobs.filter(j => j.status === "delivered").length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /bicycles/:id/setup — ficha de ajustes de la bici (queda como punto de partida del próximo servicio).
router.put("/:id/setup", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = z.object({ setupNotes: z.string().trim().max(1500).nullable() }).safeParse(req.body);
  if (isNaN(id) || !parsed.success) { res.status(400).json({ error: "Los ajustes son demasiado largos (máx. 1500 caracteres)" }); return; }
  try {
    const text = parsed.data.setupNotes || null;
    const [updated] = await db.update(bicyclesTable)
      .set({ setupNotes: text, setupUpdatedAt: text ? new Date() : null, updatedAt: new Date() })
      .where(eq(bicyclesTable.id, id)).returning({ id: bicyclesTable.id });
    if (!updated) { res.status(404).json({ error: "Bicicleta no encontrada" }); return; }
    const [row] = await db.select(BIKE_FIELDS).from(bicyclesTable)
      .leftJoin(clientsTable, eq(clientsTable.id, bicyclesTable.clientId)).where(eq(bicyclesTable.id, id));
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateBicycleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.clientId !== undefined) updates.clientId = data.clientId;
    if (data.brand !== undefined) updates.brand = data.brand;
    if (data.model !== undefined) updates.model = data.model;
    if (data.year !== undefined) updates.year = data.year;
    if (data.type !== undefined) updates.type = data.type;
    if (data.color !== undefined) updates.color = data.color;
    if (data.rimSize !== undefined) updates.rimSize = data.rimSize;
    if (data.serialNumber !== undefined) updates.serialNumber = data.serialNumber;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(bicyclesTable).set(updates).where(eq(bicyclesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(bicyclesTable).set({ active: false, updatedAt: new Date() }).where(eq(bicyclesTable.id, id)).returning({ id: bicyclesTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
