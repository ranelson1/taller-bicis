import express, { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db, purchasesTable, purchaseItemsTable, suppliersTable, partsTable, workOrdersTable, currentWorkshopId,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { confirmPurchase, PurchaseError } from "../helpers/inventory";
import { InvoiceReadError, readDteXml, readWithClaude, claudeReaderAvailable, type ParsedInvoice } from "../helpers/invoiceReader";
import { ALLOWED_TYPES, deletePhotoFile, photoPath, saveFile, sniffImageType } from "../helpers/photoStorage";

// Compras de repuestos e insumos: facturas, boletas o guías que suman stock.
// Se crean como borrador (a mano o leyendo el XML/PDF/foto), el taller revisa y confirma.
const router = Router();
router.use(requireAuth);

const MAX_DOC_BYTES = 15 * 1024 * 1024;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const normRut = (s: string | null | undefined) => (s ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
const str = (v: number | null | undefined) => (v == null ? null : String(v));

async function findOrCreateSupplier(name: string | null | undefined, rut: string | null | undefined): Promise<number | null> {
  if (!name?.trim() && !rut?.trim()) return null;
  const all = await db.select().from(suppliersTable);
  const byRut = rut ? all.find(s => normRut(s.rut) && normRut(s.rut) === normRut(rut)) : undefined;
  const byName = name ? all.find(s => norm(s.name) === norm(name)) : undefined;
  const found = byRut ?? byName;
  if (found) {
    if (!found.rut && rut) await db.update(suppliersTable).set({ rut }).where(eq(suppliersTable.id, found.id));
    return found.id;
  }
  const [created] = await db.insert(suppliersTable).values({ name: name?.trim() || rut!.trim(), rut: rut?.trim() || null }).returning({ id: suppliersTable.id });
  return created.id;
}

// Artículo del inventario para una línea: lo que se usó la última vez para ese código del mismo
// proveedor, o un artículo con ese SKU, o con el mismo nombre.
async function matchPart(supplierId: number | null, code: string | null, description: string): Promise<number | null> {
  if (supplierId && (code || description)) {
    const [prev] = await db.select({ partId: purchaseItemsTable.partId }).from(purchaseItemsTable)
      .innerJoin(purchasesTable, eq(purchasesTable.id, purchaseItemsTable.purchaseId))
      .where(and(
        eq(purchasesTable.supplierId, supplierId), isNotNull(purchaseItemsTable.partId),
        code ? eq(purchaseItemsTable.supplierCode, code) : eq(sql`lower(${purchaseItemsTable.description})`, norm(description)),
      ))
      .orderBy(desc(purchaseItemsTable.id)).limit(1);
    if (prev?.partId) return prev.partId;
  }
  const parts = await db.select({ id: partsTable.id, sku: partsTable.sku, name: partsTable.name }).from(partsTable).where(eq(partsTable.active, true));
  return (code ? parts.find(p => p.sku && norm(p.sku) === norm(code))?.id : undefined)
    ?? parts.find(p => norm(p.name) === norm(description))?.id
    ?? null;
}

async function purchaseDetail(id: number) {
  const [p] = await db.select({
    purchase: purchasesTable, supplierName: suppliersTable.name, supplierRut: suppliersTable.rut,
  }).from(purchasesTable).leftJoin(suppliersTable, eq(suppliersTable.id, purchasesTable.supplierId))
    .where(eq(purchasesTable.id, id));
  if (!p) return null;
  const items = await db.select({
    item: purchaseItemsTable, partName: partsTable.name, partKind: partsTable.kind, partUnit: partsTable.unit,
    partSalePrice: partsTable.suggestedPrice, partCostPrice: partsTable.costPrice,
    workOrderNumber: workOrdersTable.workOrderNumber, workCaseId: workOrdersTable.workCaseId,
  }).from(purchaseItemsTable)
    .leftJoin(partsTable, eq(partsTable.id, purchaseItemsTable.partId))
    .leftJoin(workOrdersTable, eq(workOrdersTable.id, purchaseItemsTable.workOrderId))
    .where(eq(purchaseItemsTable.purchaseId, id)).orderBy(purchaseItemsTable.sortOrder, purchaseItemsTable.id);
  const n = (v: string | null) => (v == null ? null : Number(v));
  const { purchase } = p;
  return {
    id: purchase.id, status: purchase.status, source: purchase.source, docType: purchase.docType, docNumber: purchase.docNumber,
    issuedOn: purchase.issuedOn, notes: purchase.notes, supplierId: purchase.supplierId, supplierName: p.supplierName, supplierRut: p.supplierRut,
    netTotal: n(purchase.netTotal), taxTotal: n(purchase.taxTotal), total: n(purchase.total),
    fileUrl: purchase.fileKey ? `/api/purchases/${purchase.id}/file` : null, fileMime: purchase.fileMime,
    confirmedAt: purchase.confirmedAt?.toISOString() ?? null, createdAt: purchase.createdAt.toISOString(),
    items: items.map(r => ({
      id: r.item.id, partId: r.item.partId, partName: r.partName, partKind: r.partKind, partUnit: r.partUnit,
      partSalePrice: n(r.partSalePrice), partCostPrice: n(r.partCostPrice),
      description: r.item.description, supplierCode: r.item.supplierCode, quantity: Number(r.item.quantity), unit: r.item.unit,
      unitCostNet: Number(r.item.unitCostNet), salePrice: n(r.item.salePrice),
      workOrderId: r.item.workOrderId, workOrderNumber: r.workOrderNumber, workCaseId: r.workCaseId,
    })),
  };
}

async function createDraft(parsed: ParsedInvoice, source: string, file: { key: string; mime: string } | null, userId: number | null) {
  const supplierId = await findOrCreateSupplier(parsed.supplierName, parsed.supplierRut);
  const [purchase] = await db.insert(purchasesTable).values({
    supplierId, docType: parsed.docType, docNumber: parsed.docNumber, issuedOn: parsed.issuedOn,
    netTotal: str(parsed.netTotal), taxTotal: str(parsed.taxTotal), total: str(parsed.total),
    source, fileKey: file?.key ?? null, fileMime: file?.mime ?? null, createdByUserId: userId,
  }).returning({ id: purchasesTable.id });
  for (const [i, line] of parsed.lines.entries()) {
    await db.insert(purchaseItemsTable).values({
      purchaseId: purchase.id, description: line.description, supplierCode: line.supplierCode,
      quantity: String(line.quantity), unit: line.unit, unitCostNet: String(line.unitCostNet),
      partId: await matchPart(supplierId, line.supplierCode, line.description), sortOrder: i,
    });
  }
  return purchase.id;
}

// ── GET /purchases ─────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select({
      id: purchasesTable.id, status: purchasesTable.status, source: purchasesTable.source, docType: purchasesTable.docType,
      docNumber: purchasesTable.docNumber, issuedOn: purchasesTable.issuedOn, total: purchasesTable.total,
      supplierName: suppliersTable.name, createdAt: purchasesTable.createdAt,
      itemCount: sql<number>`(select count(*)::int from purchase_items pi where pi.purchase_id = ${purchasesTable.id})`,
      forJobs: sql<number>`(select count(*)::int from purchase_items pi where pi.purchase_id = ${purchasesTable.id} and pi.work_order_id is not null)`,
    }).from(purchasesTable).leftJoin(suppliersTable, eq(suppliersTable.id, purchasesTable.supplierId))
      .where(sql`${purchasesTable.status} <> 'cancelled'`)
      .orderBy(desc(purchasesTable.createdAt)).limit(300);
    res.json(rows.map(r => ({ ...r, total: r.total != null ? Number(r.total) : null, createdAt: r.createdAt.toISOString() })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reader-status", (_req, res) => {
  res.json({ xml: true, pdfAndImages: claudeReaderAvailable() });
});

router.get("/:id", async (req, res) => {
  try {
    const detail = await purchaseDetail(parseInt(req.params.id));
    if (!detail) { res.status(404).json({ error: "Compra no encontrada" }); return; }
    res.json(detail);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Crear / editar borrador ────────────────────────────────────────────────────
const itemSchema = z.object({
  partId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1),
  supplierCode: z.string().trim().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().trim().max(10).nullable().optional(),
  unitCostNet: z.number().min(0),
  workOrderId: z.number().int().positive().nullable().optional(),
  salePrice: z.number().min(0).nullable().optional(),
});
const draftSchema = z.object({
  supplierName: z.string().trim().nullable().optional(),
  supplierRut: z.string().trim().nullable().optional(),
  docType: z.enum(["factura", "boleta", "guia", "otro"]).optional(),
  docNumber: z.string().trim().nullable().optional(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  netTotal: z.number().min(0).nullable().optional(),
  taxTotal: z.number().min(0).nullable().optional(),
  total: z.number().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema),
});

async function saveDraftItems(purchaseId: number, items: z.infer<typeof itemSchema>[]) {
  await db.delete(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, purchaseId));
  for (const [i, it] of items.entries()) {
    await db.insert(purchaseItemsTable).values({
      purchaseId, partId: it.partId ?? null, description: it.description, supplierCode: it.supplierCode ?? null,
      quantity: String(it.quantity), unit: it.unit ?? null, unitCostNet: String(it.unitCostNet),
      workOrderId: it.workOrderId ?? null, salePrice: str(it.salePrice), sortOrder: i,
    });
  }
}

router.post("/", async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }); return; }
  const d = parsed.data;
  try {
    const supplierId = await findOrCreateSupplier(d.supplierName, d.supplierRut);
    const [p] = await db.insert(purchasesTable).values({
      supplierId, docType: d.docType ?? "factura", docNumber: d.docNumber ?? null, issuedOn: d.issuedOn ?? null,
      netTotal: str(d.netTotal), taxTotal: str(d.taxTotal), total: str(d.total), notes: d.notes ?? null,
      createdByUserId: (req.session as any)?.userId ?? null,
    }).returning({ id: purchasesTable.id });
    await saveDraftItems(p.id, d.items);
    res.status(201).json(await purchaseDetail(p.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }); return; }
  const d = parsed.data;
  try {
    const [p] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
    if (!p) { res.status(404).json({ error: "Compra no encontrada" }); return; }
    if (p.status !== "draft") { res.status(400).json({ error: "Una compra confirmada no se puede editar" }); return; }
    // OT abiertas: solo se puede asignar un repuesto a un trabajo que sigue en el taller.
    const woIds = [...new Set(d.items.map(i => i.workOrderId).filter((x): x is number => !!x))];
    if (woIds.length) {
      const open = await db.select({ id: workOrdersTable.id }).from(workOrdersTable)
        .where(and(inArray(workOrdersTable.id, woIds), sql`${workOrdersTable.status} not in ('delivered', 'cancelled')`));
      if (open.length !== woIds.length) { res.status(400).json({ error: "Solo se puede asignar a trabajos abiertos" }); return; }
    }
    const supplierId = d.supplierName !== undefined || d.supplierRut !== undefined
      ? await findOrCreateSupplier(d.supplierName, d.supplierRut) : p.supplierId;
    await db.update(purchasesTable).set({
      supplierId, docType: d.docType ?? p.docType, docNumber: d.docNumber ?? null, issuedOn: d.issuedOn ?? null,
      netTotal: str(d.netTotal), taxTotal: str(d.taxTotal), total: str(d.total), notes: d.notes ?? null, updatedAt: new Date(),
    }).where(eq(purchasesTable.id, id));
    await saveDraftItems(id, d.items);
    res.json(await purchaseDetail(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/confirm", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await confirmPurchase(id, (req.session as any)?.userId ?? null);
    res.json({ ...(await purchaseDetail(id)), touchedWorkOrders: result.touchedOrders });
  } catch (e) {
    if (e instanceof PurchaseError) { res.status(400).json({ error: e.message }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const [p] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
    if (!p) { res.status(404).json({ error: "Compra no encontrada" }); return; }
    if (p.status !== "draft") { res.status(400).json({ error: "Una compra confirmada no se puede borrar" }); return; }
    await db.delete(purchasesTable).where(eq(purchasesTable.id, id));
    if (p.fileKey) await deletePhotoFile(p.fileKey);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /purchases/import ─────────────────────────────────────────────────────
// Sube el XML del SII, un PDF o una foto de la factura/boleta y crea un borrador con sus líneas.
router.post("/import",
  express.raw({ type: ["application/xml", "text/xml", "application/pdf", ...Object.keys(ALLOWED_TYPES)], limit: MAX_DOC_BYTES }),
  async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) { res.status(400).json({ error: "Sube un XML, PDF o foto del documento" }); return; }
    const head = body.subarray(0, 512).toString("latin1").trimStart();
    const mime = head.startsWith("%PDF") ? "application/pdf"
      : head.startsWith("<") ? "application/xml"
      : sniffImageType(body);
    if (!mime) { res.status(400).json({ error: "Formato no soportado: usa XML, PDF, JPG, PNG o WebP" }); return; }
    try {
      const parsed = mime === "application/xml" ? readDteXml(body) : await readWithClaude(body, mime as any);
      const key = await saveFile(currentWorkshopId()!, "compras", body, mime);
      const source = mime === "application/xml" ? "xml" : mime === "application/pdf" ? "pdf" : "image";
      const id = await createDraft(parsed, source, { key, mime }, (req.session as any)?.userId ?? null);
      res.status(201).json(await purchaseDetail(id));
    } catch (e) {
      if (e instanceof InvoiceReadError) { res.status(422).json({ error: e.message }); return; }
      console.error(e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

router.get("/:id/file", async (req, res) => {
  try {
    const [p] = await db.select({ key: purchasesTable.fileKey, mime: purchasesTable.fileMime }).from(purchasesTable)
      .where(eq(purchasesTable.id, parseInt(req.params.id)));
    if (!p?.key) { res.status(404).end(); return; }
    res.type(p.mime ?? "application/octet-stream").set("Cache-Control", "private, no-cache").sendFile(photoPath(p.key));
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

export default router;
