import crypto from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, bicyclesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

// Link público con el historial de mantención de una bicicleta. El taller lo crea y lo puede revocar.
const router = Router();
router.use(requireAuth);

const view = (token: string | null) => ({ token, path: token ? `/bici/${token}` : null });

router.get("/:id/history-link", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [bike] = await db.select({ token: bicyclesTable.historyToken }).from(bicyclesTable).where(eq(bicyclesTable.id, id));
    if (!bike) { res.status(404).json({ error: "Bicicleta no encontrada" }); return; }
    res.json(view(bike.token));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Crea el link (o devuelve el que ya existe).
router.post("/:id/history-link", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [bike] = await db.select({ token: bicyclesTable.historyToken }).from(bicyclesTable).where(eq(bicyclesTable.id, id));
    if (!bike) { res.status(404).json({ error: "Bicicleta no encontrada" }); return; }
    if (bike.token) { res.json(view(bike.token)); return; }
    const token = crypto.randomBytes(18).toString("base64url");
    await db.update(bicyclesTable).set({ historyToken: token, updatedAt: new Date() }).where(eq(bicyclesTable.id, id));
    res.status(201).json(view(token));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Deja de compartir: el link anterior deja de funcionar.
router.delete("/:id/history-link", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.update(bicyclesTable).set({ historyToken: null, updatedAt: new Date() })
      .where(eq(bicyclesTable.id, id)).returning({ id: bicyclesTable.id });
    if (rows.length === 0) { res.status(404).json({ error: "Bicicleta no encontrada" }); return; }
    res.json(view(null));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
