import express, { Router } from "express";
import { db, workshopSettingsTable, workshopsTable, currentWorkshopId } from "@workspace/db";
import { ALLOWED_TYPES, deletePhotoFile, saveFile, sniffImageType } from "../helpers/photoStorage";
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

// ── Costos ──────────────────────────────────────────────────────────────────
// Costo de la hora = (gastos fijos + sueldo) / horas que se repara al mes. Si no se dan esos datos,
// se acepta el costo por hora directo.
const costsSchema = z.object({
  monthlyFixedCosts: z.number().min(0).nullable().optional(),
  monthlySalary: z.number().min(0).nullable().optional(),
  monthlyWorkHours: z.number().positive().max(744).nullable().optional(),
  laborCostPerHour: z.number().min(0).nullable().optional(),
  defaultPartsMarginPct: z.number().min(0).max(500).optional(),
});

router.put("/costs", async (req, res) => {
  const parsed = costsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  const d = parsed.data;
  const computed = d.monthlyWorkHours && (d.monthlyFixedCosts != null || d.monthlySalary != null)
    ? Math.round(((d.monthlyFixedCosts ?? 0) + (d.monthlySalary ?? 0)) / d.monthlyWorkHours)
    : d.laborCostPerHour ?? null;
  const str = (v: number | null | undefined) => (v == null ? null : String(v));
  const values = {
    monthlyFixedCosts: str(d.monthlyFixedCosts),
    monthlySalary: str(d.monthlySalary),
    monthlyWorkHours: str(d.monthlyWorkHours),
    laborCostPerHour: str(computed),
    ...(d.defaultPartsMarginPct != null ? { defaultPartsMarginPct: String(d.defaultPartsMarginPct) } : {}),
    updatedAt: new Date(),
  };
  try {
    await db.insert(workshopSettingsTable).values(values)
      .onConflictDoUpdate({ target: workshopSettingsTable.workshopId, set: values });
    res.json(await getWorkshopSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Logo ────────────────────────────────────────────────────────────────────
// El navegador lo reduce antes de subirlo; aquí se valida que sea una imagen real.
router.post("/logo",
  express.raw({ type: Object.keys(ALLOWED_TYPES), limit: 2 * 1024 * 1024 }),
  async (req, res) => {
    const body = req.body as Buffer;
    const mimeType = Buffer.isBuffer(body) ? sniffImageType(body) : null;
    if (!mimeType) { res.status(400).json({ error: "Sube una imagen JPG, PNG o WebP de hasta 2 MB" }); return; }
    try {
      const workshopId = currentWorkshopId()!;
      const [prev] = await db.select({ key: workshopSettingsTable.logoKey }).from(workshopSettingsTable);
      const key = await saveFile(workshopId, "logo", body, mimeType);
      await db.insert(workshopSettingsTable).values({ logoKey: key, updatedAt: new Date() })
        .onConflictDoUpdate({ target: workshopSettingsTable.workshopId, set: { logoKey: key, updatedAt: new Date() } });
      if (prev?.key) await deletePhotoFile(prev.key);
      res.json(await getWorkshopSettings());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

router.delete("/logo", async (_req, res) => {
  try {
    const [prev] = await db.select({ key: workshopSettingsTable.logoKey }).from(workshopSettingsTable);
    await db.update(workshopSettingsTable).set({ logoKey: null, updatedAt: new Date() });
    if (prev?.key) await deletePhotoFile(prev.key);
    res.json(await getWorkshopSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
