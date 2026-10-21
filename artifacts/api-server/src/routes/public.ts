import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { workOrdersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { triggerWorkCaseRecalc } from "../helpers/workCase";
import { buildPublicWorkOrder, decideWorkOrderItem, ItemDecisionError } from "../helpers/workOrderPublic";

// Vista del cliente sin login. El token secreto de la OT es la única credencial,
// así que cada handler debe limitarse a la OT de ese token.
const router = Router();

async function findByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [wo] = await db.select().from(workOrdersTable)
    .where(and(eq(workOrdersTable.publicToken, token), eq(workOrdersTable.active, true)));
  return wo ?? null;
}

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

export default router;
