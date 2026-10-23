import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { servicesTable, serviceStepsTable, categoriesTable, serviceSuppliesTable, partsTable } from "@workspace/db";
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
  followupMonths: z.number().int().min(0).max(60).optional().nullable(),
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
      followupMonths: servicesTable.followupMonths,
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
  const { name, categoryId, basePrice, estimatedHours, clientDescription, internalDescription, followupMonths } = parsed.data;
  try {
    const [row] = await db.insert(servicesTable).values({
      name,
      categoryId: categoryId ?? null,
      basePrice: basePrice != null ? String(basePrice) : null,
      estimatedHours: estimatedHours != null ? String(estimatedHours) : null,
      clientDescription: clientDescription ?? null,
      internalDescription: internalDescription ?? null,
      followupMonths: followupMonths ?? null,
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
    if (data.followupMonths !== undefined) updates.followupMonths = data.followupMonths;
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

// ── Insumos del servicio (receta) ───────────────────────────────────────────────
// Lo que gasta cada vez que se hace (ej.: sangrado de frenos = 50 ml de líquido). Se descuenta del
// stock cuando la OT queda lista y entra en el costo del trabajo.
router.get("/:id/supplies", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const rows = await db.select({
      partId: serviceSuppliesTable.partId, quantity: serviceSuppliesTable.quantity,
      name: partsTable.name, unit: partsTable.unit, costPrice: partsTable.costPrice,
    }).from(serviceSuppliesTable).innerJoin(partsTable, eq(partsTable.id, serviceSuppliesTable.partId))
      .where(eq(serviceSuppliesTable.serviceId, id)).orderBy(partsTable.name);
    res.json(rows.map(r => ({ ...r, quantity: Number(r.quantity), costPrice: r.costPrice != null ? Number(r.costPrice) : null })));
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

router.put("/:id/supplies", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = z.object({
    supplies: z.array(z.object({ partId: z.number().int().positive(), quantity: z.number().positive() })),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Datos inválidos" }); return; }
  try {
    const [svc] = await db.select({ id: servicesTable.id }).from(servicesTable).where(eq(servicesTable.id, id));
    if (!svc) { res.status(404).json({ error: "Not found" }); return; }
    await db.transaction(async (tx) => {
      await tx.delete(serviceSuppliesTable).where(eq(serviceSuppliesTable.serviceId, id));
      const unique = [...new Map(parsed.data.supplies.map(s => [s.partId, s])).values()];
      if (unique.length) {
        await tx.insert(serviceSuppliesTable).values(unique.map(s => ({ serviceId: id, partId: s.partId, quantity: String(s.quantity) })));
      }
    });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal server error" }); }
});

export default router;
