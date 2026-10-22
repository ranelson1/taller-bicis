import { Router } from "express";
import { db, workshopSettingsTable, workshopsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";
import { getWorkshopSettings } from "../helpers/settings";
import { validateSchedule } from "../helpers/schedule";

// Datos del taller (Administración → Configuración). Leer: cualquier usuario; guardar: admin.
const router = Router();
router.use(requireAuth, adminOnlyWrites);

router.get("/", async (_req, res) => {
  try {
    res.json(await getWorkshopSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  schedule: z.array(z.object({ day: z.number().int(), open: z.string(), close: z.string() })),
  lunchStart: z.string().nullable().optional(),
  lunchEnd: z.string().nullable().optional(),
});

router.put("/", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  const schedule = parsed.data.schedule.map(({ day, open, close }) => ({ day, open, close }));
  const lunch = parsed.data.lunchStart && parsed.data.lunchEnd ? { start: parsed.data.lunchStart, end: parsed.data.lunchEnd } : null;
  const invalid = validateSchedule(schedule, lunch);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const values = {
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    address: parsed.data.address || null,
    schedule,
    lunchStart: lunch?.start ?? null,
    lunchEnd: lunch?.end ?? null,
    workdays: schedule.map(d => d.day).sort().join(","),
    updatedAt: new Date(),
  };
  try {
    // workshop_id lo pone la base (taller de la sesión); RLS impide tocar otro taller.
    await db.insert(workshopSettingsTable).values(values)
      .onConflictDoUpdate({ target: workshopSettingsTable.workshopId, set: values });
    await db.update(workshopsTable).set({ name: values.name, updatedAt: new Date() })
      .where(eq(workshopsTable.id, sql`current_workshop_id()`));
    res.json(await getWorkshopSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
