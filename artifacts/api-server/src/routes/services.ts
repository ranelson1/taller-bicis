import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { servicesTable, serviceStepsTable, categoriesTable } from "@workspace/db";
import { eq, count, asc } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const createServiceSchema = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().positive().optional().nullable(),
  basePrice: z.union([z.number().min(0), z.string()]).optional().nullable(),
  estimatedHours: z.union([z.number().min(0), z.string()]).optional().nullable(),
  clientDescription: z.string().optional().nullable(),
  internalDescription: z.string().optional().nullable(),
});
const updateServiceSchema = createServiceSchema.partial().extend({
  active: z.boolean().optional(),
});

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select({
      id: servicesTable.id,
      name: servicesTable.name,
      categoryId: servicesTable.categoryId,
      categoryName: categoriesTable.name,
      basePrice: servicesTable.basePrice,
      estimatedHours: servicesTable.estimatedHours,
      clientDescription: servicesTable.clientDescription,
      internalDescription: servicesTable.internalDescription,
      active: servicesTable.active,
      createdAt: servicesTable.createdAt,
      updatedAt: servicesTable.updatedAt,
      stepCount: count(serviceStepsTable.id),
    })
      .from(servicesTable)
      .leftJoin(categoriesTable, eq(categoriesTable.id, servicesTable.categoryId))
      .leftJoin(serviceStepsTable, eq(serviceStepsTable.serviceId, servicesTable.id))
      .groupBy(servicesTable.id, categoriesTable.name)
      .orderBy(servicesTable.name);
    res.json(rows);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/", async (req, res) => {
  const parsed = createServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const { name, categoryId, basePrice, estimatedHours, clientDescription, internalDescription } = parsed.data;
  try {
    const [row] = await db.insert(servicesTable).values({
      name,
      categoryId: categoryId ?? null,
      basePrice: basePrice != null ? String(basePrice) : null,
      estimatedHours: estimatedHours != null ? String(estimatedHours) : null,
      clientDescription: clientDescription ?? null,
      internalDescription: internalDescription ?? null,
    }).returning();
    res.status(201).json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [service] = await db.select({
      id: servicesTable.id,
      name: servicesTable.name,
      categoryId: servicesTable.categoryId,
      categoryName: categoriesTable.name,
      basePrice: servicesTable.basePrice,
      estimatedHours: servicesTable.estimatedHours,
      clientDescription: servicesTable.clientDescription,
      internalDescription: servicesTable.internalDescription,
      active: servicesTable.active,
      createdAt: servicesTable.createdAt,
      updatedAt: servicesTable.updatedAt,
    }).from(servicesTable)
      .leftJoin(categoriesTable, eq(categoriesTable.id, servicesTable.categoryId))
      .where(eq(servicesTable.id, id));
    if (!service) { res.status(404).json({ error: "Not found" }); return; }

    const steps = await db.select().from(serviceStepsTable)
      .where(eq(serviceStepsTable.serviceId, id))
      .orderBy(asc(serviceStepsTable.order));

    res.json({ ...service, steps });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateServiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues }); return;
  }
  const data = parsed.data;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.categoryId !== undefined) updates.categoryId = data.categoryId;
    if (data.basePrice !== undefined) updates.basePrice = data.basePrice != null ? String(data.basePrice) : null;
    if (data.estimatedHours !== undefined) updates.estimatedHours = data.estimatedHours != null ? String(data.estimatedHours) : null;
    if (data.clientDescription !== undefined) updates.clientDescription = data.clientDescription;
    if (data.internalDescription !== undefined) updates.internalDescription = data.internalDescription;
    if (data.active !== undefined) updates.active = data.active;
    const [row] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(servicesTable).set({ active: false, updatedAt: new Date() }).where(eq(servicesTable.id, id)).returning({ id: servicesTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
