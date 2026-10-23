import { Router } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, followupSnoozesTable, clientsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { DEFAULT_SNOOZE_DAYS, listFollowups } from "../helpers/followups";

// Recontacto: clientes a quienes ya les toca repetir un servicio.
const router = Router();
router.use(requireAuth);

// GET /followups — ordenados por quién lleva más tiempo vencido.
router.get("/", async (_req, res) => {
  try {
    res.json(await listFollowups());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /followups/:clientId/snooze — "ya le escribí": no vuelve a aparecer por unos días.
router.post("/:clientId/snooze", async (req, res) => {
  const clientId = parseInt(req.params.clientId);
  const parsed = z.object({ days: z.number().int().min(1).max(365).optional() }).safeParse(req.body ?? {});
  if (isNaN(clientId) || !parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const until = new Date();
  until.setDate(until.getDate() + (parsed.data.days ?? DEFAULT_SNOOZE_DAYS));
  const untilOn = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, "0")}-${String(until.getDate()).padStart(2, "0")}`;
  try {
    // El cliente se busca con la conexión del taller: uno de otro taller no existe para nosotros.
    const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
    await db.insert(followupSnoozesTable).values({ clientId, untilOn })
      .onConflictDoUpdate({ target: followupSnoozesTable.clientId, set: { untilOn, createdAt: new Date() } });
    res.json({ ok: true, untilOn });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
