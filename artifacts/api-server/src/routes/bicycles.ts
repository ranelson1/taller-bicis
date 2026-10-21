import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { bicyclesTable, clientsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
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
    await db.update(bicyclesTable).set({ active: false, updatedAt: new Date() }).where(eq(bicyclesTable.id, id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
