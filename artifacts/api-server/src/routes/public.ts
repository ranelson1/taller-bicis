import { Router } from "express";
import { z } from "zod/v4";
import { db, withBypass, setCurrentWorkshop } from "@workspace/db";
import { workOrdersTable, workOrderPhotosTable, workshopSettingsTable, timelineEventsTable, bicyclesTable } from "@workspace/db";
import { photoPath } from "../helpers/photoStorage";
import { and, eq } from "drizzle-orm";
import { triggerWorkCaseRecalc } from "../helpers/workCase";
import { buildBikeHistory } from "../helpers/bikeHistory";
import { buildPublicWorkOrder, decideWorkOrderItem, ItemDecisionError } from "../helpers/workOrderPublic";
import { buildWorkOrderPdf, sendPdf } from "../helpers/workOrderPdfFile";

// Vista del cliente sin login. El token secreto de la OT es la única credencial,
// así que cada handler debe limitarse a la OT de ese token.
const router = Router();

// El token se busca en todos los talleres; desde ahí el request queda fijado al taller de esa OT,
// así todo lo demás (ítems, fotos, configuración) sale solo de ese taller.
async function findByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const wo = await withBypass(async (bypassDb) => {
    const [row] = await bypassDb.select().from(workOrdersTable)
      .where(and(eq(workOrdersTable.publicToken, token), eq(workOrdersTable.active, true)));
    return row ?? null;
  });
  if (!wo) return null;
  await setCurrentWorkshop(wo.workshopId);
  return wo;
}

// GET /public/ot/:token/pdf — el mismo comprobante en PDF (cotización o comprobante de servicio).
router.get("/ot/:token/pdf", async (req, res) => {
  try {
    const wo = await findByToken(req.params.token);
    if (!wo) { res.status(404).json({ error: "Orden no encontrada" }); return; }
    sendPdf(res, await buildWorkOrderPdf(wo, `${req.protocol}://${req.get("host")}/ot/${req.params.token}`));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /public/ot/:token
router.get("/ot/:token", async (req, res) => {
  try {
    const wo = await findByToken(req.params.token);
    if (!wo) { res.status(404).json({ error: "Orden no encontrada" }); return; }
    res.json(await buildPublicWorkOrder(wo));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /public/ot/:token/photos/:photoId — solo fotos de esa OT marcadas como visibles.
router.get("/ot/:token/photos/:photoId", async (req, res) => {
  const photoId = Number(req.params.photoId);
  if (!Number.isInteger(photoId)) { res.status(404).end(); return; }
  try {
    const wo = await findByToken(req.params.token);
    if (!wo) { res.status(404).end(); return; }
    const [photo] = await db.select().from(workOrderPhotosTable).where(and(
      eq(workOrderPhotosTable.id, photoId),
      eq(workOrderPhotosTable.workOrderId, wo.id),
      eq(workOrderPhotosTable.active, true),
      eq(workOrderPhotosTable.visibleToClient, true),
    ));
    if (!photo) { res.status(404).end(); return; }
    res.type(photo.mimeType).set("Cache-Control", "private, no-cache").sendFile(photoPath(photo.storageKey));
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// GET /public/workshops/:id/logo — el logo no es privado: sale en el link del cliente y en la app.
router.get("/workshops/:id/logo", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).end(); return; }
  try {
    const [row] = await withBypass((bdb) => bdb.select({ key: workshopSettingsTable.logoKey })
      .from(workshopSettingsTable).where(eq(workshopSettingsTable.workshopId, id)));
    if (!row?.key) { res.status(404).end(); return; }
    // La URL lleva ?v=<versión>, así que se puede cachear largo.
    res.set("Cache-Control", "public, max-age=31536000, immutable").sendFile(photoPath(row.key));
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// POST /public/ot/:token/items/:itemId/decision
router.post("/ot/:token/items/:itemId/decision", async (req, res) => {
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]) }).safeParse(req.body);
  const itemId = Number(req.params.itemId);
  if (!parsed.success || !Number.isInteger(itemId)) { res.status(400).json({ error: "Solicitud inválida" }); return; }
  try {
    const wo = await findByToken(req.params.token);
    if (!wo) { res.status(404).json({ error: "Orden no encontrada" }); return; }
    await decideWorkOrderItem(wo, itemId, parsed.data.decision, "client", null);
    await triggerWorkCaseRecalc(wo.workCaseId, null);
    const [fresh] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, wo.id));
    res.json(await buildPublicWorkOrder(fresh!));
  } catch (e) {
    if (e instanceof ItemDecisionError) { res.status(400).json({ error: e.message }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /public/ot/:token/approve-quote — el cliente aprueba la cotización (opcional: solo queda registrado).
router.post("/ot/:token/approve-quote", async (req, res) => {
  try {
    const wo = await findByToken(req.params.token);
    if (!wo) { res.status(404).json({ error: "Orden no encontrada" }); return; }
    if (wo.status === "cancelled") { res.status(400).json({ error: "Esta orden fue cancelada" }); return; }
    if (!wo.quoteApprovedAt) {
      await db.update(workOrdersTable).set({ quoteApprovedAt: new Date(), quoteApprovedBy: "client", updatedAt: new Date() })
        .where(eq(workOrdersTable.id, wo.id));
      await db.insert(timelineEventsTable).values({
        entityType: "work_order", entityId: wo.id, userId: null, action: "quote_approved", previousStatus: "client",
        comment: "El cliente aprobó la cotización desde su link",
      });
    }
    const [fresh] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, wo.id));
    res.json(await buildPublicWorkOrder(fresh!));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /public/bikes/:token/history — historial de mantención de una bicicleta (sin precios ni datos del dueño).
router.get("/bikes/:token/history", async (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) { res.status(404).json({ error: "Historial no encontrado" }); return; }
  try {
    const bike = await withBypass(async (bypassDb) => {
      const [row] = await bypassDb.select().from(bicyclesTable).where(and(eq(bicyclesTable.historyToken, token), eq(bicyclesTable.active, true)));
      return row ?? null;
    });
    if (!bike) { res.status(404).json({ error: "Historial no encontrado" }); return; }
    await setCurrentWorkshop(bike.workshopId);
    res.set("Cache-Control", "private, no-cache").json(await buildBikeHistory(bike));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
