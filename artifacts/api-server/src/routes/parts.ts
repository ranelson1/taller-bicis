import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { partsTable, categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const createPartSchema = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().positive().optional().nullable(),
  brand: z.string().optional().nullable(),
  suggestedPrice: z.union([z.number().min(0), z.string()]).optional().nullable(),
  sku: z.string().optional().nullable(),
});
const updatePartSchema = createPartSchema.partial().extend({
  active: z.boolean().optional(),
});

const PART_FIELDS = {
  id: partsTable.id,
  name: partsTable.name,
  categoryId: partsTable.categoryId,
  categoryName: categoriesTable.name,
  brand: partsTable.brand,
  suggestedPrice: partsTable.suggestedPrice,
  sku: partsTable.sku,
  active: partsTable.active,
  createdAt: partsTable.createdAt,
  updatedAt: partsTable.updatedAt,
} as const;

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select(PART_FIELDS).from(partsTable)
      .leftJoin(categoriesTable, eq(categoriesTable.id, partsTable.categoryId))
      .orderBy(partsTable.name);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createPartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { name, categoryId, brand, suggestedPrice, sku } = parsed.data;
  try {
    const [row] = await db.insert(partsTable).values({
      name,
      categoryId: categoryId ?? null,
      brand: brand ?? null,
      suggestedPrice: suggestedPrice != null ? String(suggestedPrice) : null,
      sku: sku ?? null,
    }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select(PART_FIELDS).from(partsTable)
      .leftJoin(categoriesTable, eq(categoriesTable.id, partsTable.categoryId))
      .where(eq(partsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updatePartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
    if (data.brand !== undefined) updates.brand = data.brand;
    if (data.suggestedPrice !== undefined) updates.suggestedPrice = data.suggestedPrice != null ? String(data.suggestedPrice) : null;
    if (data.sku !== undefined) updates.sku = data.sku;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(partsTable).set(updates).where(eq(partsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(partsTable).set({ active: false, updatedAt: new Date() }).where(eq(partsTable.id, id)).returning({ id: partsTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
