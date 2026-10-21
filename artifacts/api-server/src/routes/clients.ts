import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { clientsTable, bicyclesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

const createClientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateClientSchema = createClientSchema.partial().extend({
  active: z.boolean().optional(),
});

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select({
      id: clientsTable.id,
      name: clientsTable.name,
      phone: clientsTable.phone,
      email: clientsTable.email,
      notes: clientsTable.notes,
      active: clientsTable.active,
      createdAt: clientsTable.createdAt,
      updatedAt: clientsTable.updatedAt,
      bicycleCount: count(bicyclesTable.id),
    })
      .from(clientsTable)
      .leftJoin(bicyclesTable, eq(bicyclesTable.clientId, clientsTable.id))
      .groupBy(clientsTable.id)
      .orderBy(clientsTable.name);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { name, phone, email, notes } = parsed.data;
  try {
    const [row] = await db.insert(clientsTable).values({
      name, phone: phone ?? null, email: email ?? null, notes: notes ?? null,
    }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.email !== undefined) updates.email = data.email;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(clientsTable).set(updates).where(eq(clientsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.update(clientsTable).set({ active: false, updatedAt: new Date() }).where(eq(clientsTable.id, id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
