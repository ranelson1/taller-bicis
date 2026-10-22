import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { partsTable, categoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";
import { applyMovement } from "../helpers/inventory";

// Artículos del inventario: repuestos que se cobran (kind=part) e insumos del taller (kind=supply).
// El stock no se edita aquí: solo cambia con movimientos (compras, consumos, ajustes), así cuadra.
const router = Router();
router.use(requireAuth, adminOnlyWrites);

const money = z.union([z.number().min(0), z.string()]).optional().nullable();
const qty = z.number().min(0).optional().nullable();

const createPartSchema = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().positive().optional().nullable(),
  brand: z.string().optional().nullable(),
  suggestedPrice: money,
  sku: z.string().optional().nullable(),
  kind: z.enum(["part", "supply"]).optional(),
  unit: z.string().trim().min(1).max(10).optional(),
  costPrice: money,
  minStock: qty,
  initialStock: qty,
});
const updatePartSchema = createPartSchema.omit({ initialStock: true }).partial().extend({
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
  kind: partsTable.kind,
  unit: partsTable.unit,
  costPrice: partsTable.costPrice,
  stock: partsTable.stock,
  minStock: partsTable.minStock,
  active: partsTable.active,
  createdAt: partsTable.createdAt,
  updatedAt: partsTable.updatedAt,
} as const;

const view = <T extends { suggestedPrice: string | null; costPrice: string | null; stock: string; minStock: string | null }>(r: T) => ({
  ...r,
  suggestedPrice: r.suggestedPrice != null ? Number(r.suggestedPrice) : null,
  costPrice: r.costPrice != null ? Number(r.costPrice) : null,
  stock: Number(r.stock),
  minStock: r.minStock != null ? Number(r.minStock) : null,
});
const str = (v: number | string | null | undefined) => (v == null || v === "" ? null : String(v));

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select(PART_FIELDS).from(partsTable)
      .leftJoin(categoriesTable, eq(categoriesTable.id, partsTable.categoryId))
      .orderBy(partsTable.name);
    res.json(rows.map(view));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createPartSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const d = parsed.data;
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(partsTable).values({
        name: d.name, categoryId: d.categoryId ?? null, brand: d.brand ?? null, sku: d.sku ?? null,
        suggestedPrice: str(d.suggestedPrice), kind: d.kind ?? "part", unit: d.unit ?? "un",
        costPrice: str(d.costPrice), minStock: str(d.minStock),
      }).returning();
      // Stock inicial: queda como ajuste para que el historial cuadre.
      if (d.initialStock) {
        await applyMovement(tx, {
          partId: created.id, kind: "adjustment", quantity: d.initialStock, unitCost: d.costPrice != null ? Number(d.costPrice) : null,
          note: "Stock inicial", userId: (req.session as any)?.userId ?? null,
        });
      }
      return created;
    });
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
    res.json(view(row));
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
    if (data.suggestedPrice !== undefined) updates.suggestedPrice = str(data.suggestedPrice);
    if (data.sku !== undefined) updates.sku = data.sku;
    if (data.kind !== undefined) updates.kind = data.kind;
    if (data.unit !== undefined) updates.unit = data.unit;
    if (data.costPrice !== undefined) updates.costPrice = str(data.costPrice);
    if (data.minStock !== undefined) updates.minStock = str(data.minStock);
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
