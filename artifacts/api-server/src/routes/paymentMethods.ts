import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { paymentMethodsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const createPaymentMethodSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional().nullable(),
});
const updatePaymentMethodSchema = createPaymentMethodSchema.partial().extend({
  active: z.boolean().optional(),
});

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(paymentMethodsTable).orderBy(paymentMethodsTable.name);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createPaymentMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { name, notes } = parsed.data;
  try {
    const [row] = await db.insert(paymentMethodsTable).values({ name, notes: notes ?? null }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updatePaymentMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(paymentMethodsTable).set(updates).where(eq(paymentMethodsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(paymentMethodsTable).set({ active: false, updatedAt: new Date() }).where(eq(paymentMethodsTable.id, id)).returning({ id: paymentMethodsTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
