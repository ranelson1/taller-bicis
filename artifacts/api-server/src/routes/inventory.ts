import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db, partsTable, categoriesTable, inventoryMovementsTable, workOrdersTable, suppliersTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { applyMovement, plannedConsumption } from "../helpers/inventory";

const router = Router();
router.use(requireAuth);

const OPEN = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"] as const;

// ── GET /inventory ─────────────────────────────────────────────────────────────
// Stock de cada artículo, lo comprometido por trabajos abiertos y cuánto conviene comprar.
router.get("/", async (_req, res) => {
  try {
    const parts = await db.select({
      id: partsTable.id, name: partsTable.name, kind: partsTable.kind, unit: partsTable.unit, sku: partsTable.sku,
      brand: partsTable.brand, categoryName: categoriesTable.name, costPrice: partsTable.costPrice,
      salePrice: partsTable.suggestedPrice, stock: partsTable.stock, minStock: partsTable.minStock,
    }).from(partsTable).leftJoin(categoriesTable, eq(categoriesTable.id, partsTable.categoryId))
      .where(eq(partsTable.active, true)).orderBy(partsTable.name);

    // Comprometido: lo que van a sacar las OT abiertas que aún no descontaron su stock.
    const openOrders = await db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(and(
      eq(workOrdersTable.active, true), inArray(workOrdersTable.status, [...OPEN]), isNull(workOrdersTable.stockConsumedAt),
    ));
    const planned = await plannedConsumption(db, openOrders.map(o => o.id));
    const reserved = new Map<number, number>();
    for (const p of planned) reserved.set(p.partId, (reserved.get(p.partId) ?? 0) + p.quantity);

    res.json(parts.map(p => {
      const stock = Number(p.stock);
      const min = p.minStock != null ? Number(p.minStock) : null;
      const res_ = reserved.get(p.id) ?? 0;
      const available = stock - res_;
      // Comprar lo necesario para cubrir lo comprometido y volver al punto de recompra.
      const toBuy = Math.max(0, (min ?? 0) + res_ - stock);
      return {
        ...p,
        costPrice: p.costPrice != null ? Number(p.costPrice) : null,
        salePrice: p.salePrice != null ? Number(p.salePrice) : null,
        stock, minStock: min, reserved: res_, available,
        needsReorder: toBuy > 0, suggestedQuantity: Math.ceil(toBuy),
      };
    }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /inventory/:partId/adjust ─────────────────────────────────────────────
// Corrige el stock (conteo físico, pérdida, regalo…). Se indica el stock contado o la diferencia.
router.post("/:partId/adjust", async (req, res) => {
  const partId = parseInt(req.params.partId);
  const parsed = z.object({
    countedStock: z.number().min(0).optional(),
    delta: z.number().optional(),
    note: z.string().trim().max(200).optional(),
  }).refine(d => d.countedStock != null || d.delta != null, "Indica el stock contado o la diferencia").safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }); return; }
  try {
    const [part] = await db.select().from(partsTable).where(eq(partsTable.id, partId));
    if (!part) { res.status(404).json({ error: "Artículo no encontrado" }); return; }
    const delta = parsed.data.delta ?? parsed.data.countedStock! - Number(part.stock);
    if (delta === 0) { res.json({ ok: true, stock: Number(part.stock) }); return; }
    await applyMovement(db, {
      partId, kind: "adjustment", quantity: delta, unitCost: part.costPrice != null ? Number(part.costPrice) : null,
      note: parsed.data.note || (parsed.data.countedStock != null ? "Conteo de stock" : "Ajuste"), userId: (req.session as any)?.userId ?? null,
    });
    res.json({ ok: true, stock: Number(part.stock) + delta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /inventory/:partId/movements ───────────────────────────────────────────
router.get("/:partId/movements", async (req, res) => {
  const partId = parseInt(req.params.partId);
  try {
    const rows = await db.select({
      id: inventoryMovementsTable.id, kind: inventoryMovementsTable.kind, quantity: inventoryMovementsTable.quantity,
      unitCost: inventoryMovementsTable.unitCost, note: inventoryMovementsTable.note, createdAt: inventoryMovementsTable.createdAt,
      workOrderId: inventoryMovementsTable.workOrderId, workOrderNumber: workOrdersTable.workOrderNumber,
      workCaseId: workOrdersTable.workCaseId, purchaseId: inventoryMovementsTable.purchaseId, userName: usersTable.name,
    }).from(inventoryMovementsTable)
      .leftJoin(workOrdersTable, eq(workOrdersTable.id, inventoryMovementsTable.workOrderId))
      .leftJoin(usersTable, eq(usersTable.id, inventoryMovementsTable.userId))
      .where(eq(inventoryMovementsTable.partId, partId))
      .orderBy(desc(inventoryMovementsTable.createdAt), desc(inventoryMovementsTable.id)).limit(200);
    res.json(rows.map(r => ({
      ...r, quantity: Number(r.quantity), unitCost: r.unitCost != null ? Number(r.unitCost) : null, createdAt: r.createdAt.toISOString(),
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Proveedores ────────────────────────────────────────────────────────────────
router.get("/suppliers", async (_req, res) => {
  try {
    res.json(await db.select().from(suppliersTable).where(eq(suppliersTable.active, true)).orderBy(suppliersTable.name));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
