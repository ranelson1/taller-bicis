import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { serviceStepsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const createStepSchema = z.object({
  serviceId: z.number().int().positive(),
  description: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const updateStepSchema = z.object({
  description: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

const moveStepSchema = z.object({
  direction: z.enum(["up", "down"]),
});

router.post("/", async (req, res) => {
  const parsed = createStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { serviceId, description, notes } = parsed.data;
  try {
    const existing = await db.select({ order: serviceStepsTable.order })
      .from(serviceStepsTable)
      .where(eq(serviceStepsTable.serviceId, serviceId))
      .orderBy(asc(serviceStepsTable.order));
    const nextOrder = existing.length > 0 ? (existing[existing.length - 1]?.order ?? 0) + 1 : 0;
    const [row] = await db.insert(serviceStepsTable).values({
      serviceId, description, notes: notes ?? null, order: nextOrder,
    }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.description !== undefined) updates.description = data.description;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(serviceStepsTable).set(updates).where(eq(serviceStepsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(serviceStepsTable).where(eq(serviceStepsTable.id, id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id/move", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = moveStepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "direction must be 'up' or 'down'" }); return;
  }
  const { direction } = parsed.data;

  try {
    const [step] = await db.select().from(serviceStepsTable).where(eq(serviceStepsTable.id, id));
    if (!step) { res.status(404).json({ error: "Not found" }); return; }

    const allSteps = await db.select().from(serviceStepsTable)
      .where(eq(serviceStepsTable.serviceId, step.serviceId))
      .orderBy(asc(serviceStepsTable.order));

    const currentIndex = allSteps.findIndex(s => s.id === id);
    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (swapIndex < 0 || swapIndex >= allSteps.length) {
      res.json(allSteps); return;
    }

    const swapStep = allSteps[swapIndex]!;
    const currentOrder = step.order;
    const swapOrder = swapStep.order;

    const tempOrder = -1 * (currentOrder + 1);
    await db.update(serviceStepsTable).set({ order: tempOrder }).where(eq(serviceStepsTable.id, id));
    await db.update(serviceStepsTable).set({ order: currentOrder }).where(eq(serviceStepsTable.id, swapStep.id));
    await db.update(serviceStepsTable).set({ order: swapOrder }).where(eq(serviceStepsTable.id, id));

    const updatedSteps = await db.select().from(serviceStepsTable)
      .where(eq(serviceStepsTable.serviceId, step.serviceId))
      .orderBy(asc(serviceStepsTable.order));

    res.json(updatedSteps);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
