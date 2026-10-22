import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const createCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});
const updateCategorySchema = createCategorySchema.partial().extend({
  active: z.boolean().optional(),
});

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { name, description } = parsed.data;
  try {
    const [row] = await db.insert(categoriesTable).values({ name, description: description ?? null }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(categoriesTable).set(updates).where(eq(categoriesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(categoriesTable).set({ active: false, updatedAt: new Date() }).where(eq(categoriesTable.id, id)).returning({ id: categoriesTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
