import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import {
  paymentMethodsTable, usersTable, workOrdersTable, workshopSettingsTable, workshopsTable,
  setCurrentWorkshop, withBypass,
} from "@workspace/db";
import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import { requireSuperadmin } from "../middlewares/auth";
import { isUniqueViolation } from "../helpers/workCase";
import "../lib/session";

// Panel de la plataforma (superadmin): crear talleres, activarlos/desactivarlos y entrar a uno
// para dar soporte. Todo aquí salta el aislamiento por taller (withBypass), con cuidado.
const router = Router();
router.use(requireSuperadmin);

const DEFAULT_PAYMENT_METHODS = ["Efectivo", "Transferencia", "Débito", "Crédito"];

router.get("/workshops", async (_req, res) => {
  try {
    const rows = await withBypass(async (db) => {
      const workshops = await db.select().from(workshopsTable).orderBy(workshopsTable.id);
      const users = await db.select({ workshopId: usersTable.workshopId, n: count() }).from(usersTable)
        .where(eq(usersTable.active, true)).groupBy(usersTable.workshopId);
      const orders = await db.select({
        workshopId: workOrdersTable.workshopId,
        total: count(),
        open: sql<number>`count(*) filter (where ${workOrdersTable.status} in ('ready_to_work','in_progress','quality_control','ready_for_pickup'))`,
        lastActivity: max(workOrdersTable.updatedAt),
      }).from(workOrdersTable).where(eq(workOrdersTable.active, true)).groupBy(workOrdersTable.workshopId);
      const admins = await db.select({ workshopId: usersTable.workshopId, email: usersTable.email }).from(usersTable)
        .where(and(eq(usersTable.role, "admin"), eq(usersTable.active, true)));
      return workshops.map(w => {
        const o = orders.find(x => x.workshopId === w.id);
        return {
          id: w.id,
          name: w.name,
          active: w.active,
          createdAt: w.createdAt.toISOString(),
          userCount: Number(users.find(u => u.workshopId === w.id)?.n ?? 0),
          workOrderCount: Number(o?.total ?? 0),
          openWorkOrderCount: Number(o?.open ?? 0),
          lastActivityAt: o?.lastActivity ? new Date(o.lastActivity).toISOString() : null,
          adminEmails: admins.filter(a => a.workshopId === w.id).map(a => a.email),
        };
      });
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

const createSchema = z.object({
  name: z.string().trim().min(2, "El nombre del taller es obligatorio"),
  phone: z.string().trim().nullable().optional(),
  adminName: z.string().trim().min(2, "El nombre del administrador es obligatorio"),
  adminEmail: z.string().trim().email("Email inválido"),
  adminPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// Crea el taller con su configuración, métodos de pago básicos y su primer administrador.
router.post("/workshops", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" });
    return;
  }
  const data = parsed.data;
  try {
    const passwordHash = await bcrypt.hash(data.adminPassword, 10);
    const workshop = await withBypass((db) => db.transaction(async (tx) => {
      const [ws] = await tx.insert(workshopsTable).values({ name: data.name }).returning();
      await tx.insert(workshopSettingsTable).values({ workshopId: ws.id, name: data.name, phone: data.phone || null });
      await tx.insert(paymentMethodsTable).values(DEFAULT_PAYMENT_METHODS.map(name => ({ workshopId: ws.id, name })));
      await tx.insert(usersTable).values({
        workshopId: ws.id, name: data.adminName, email: data.adminEmail.toLowerCase(), passwordHash, role: "admin",
        // El primer usuario suele ser el mecánico dueño: hace los trabajos. Si contrata, lo cambia en Usuarios.
        doesJobs: true,
      });
      return ws;
    }));
    res.status(201).json({ id: workshop.id, name: workshop.name });
  } catch (e) {
    if (isUniqueViolation(e)) { res.status(409).json({ error: "Ese email ya está en uso" }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/workshops/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ name: z.string().trim().min(2).optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success || !Number.isInteger(id)) { res.status(400).json({ error: "Datos inválidos" }); return; }
  try {
    const updated = await withBypass(async (db) => {
      const [ws] = await db.update(workshopsTable).set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(workshopsTable.id, id)).returning();
      return ws;
    });
    if (!updated) { res.status(404).json({ error: "Taller no encontrado" }); return; }
    res.json({ id: updated.id, name: updated.name, active: updated.active });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Entrar a un taller (soporte): la sesión del superadmin pasa a trabajar en ese taller.
router.post("/workshops/:id/enter", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [ws] = await withBypass((db) => db.select().from(workshopsTable).where(inArray(workshopsTable.id, [id])));
    if (!ws) { res.status(404).json({ error: "Taller no encontrado" }); return; }
    req.session.workshopId = ws.id;
    await setCurrentWorkshop(ws.id);
    res.json({ id: ws.id, name: ws.name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/exit", async (req, res) => {
  req.session.workshopId = null;
  await setCurrentWorkshop(null);
  res.json({ ok: true });
});

export default router;
