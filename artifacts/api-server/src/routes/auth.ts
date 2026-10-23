import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { usersTable, workshopsTable, withBypass, setCurrentWorkshop } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { loadSessionUser } from "../middlewares/auth";
import "../lib/session";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/login — el email identifica al usuario y con él su taller.
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email and password are required", details: parsed.error.issues });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const found = await withBypass(async (db) => {
      const [user] = await db.select().from(usersTable)
        .where(eq(sql`lower(${usersTable.email})`, email.trim().toLowerCase())).limit(1);
      if (!user) return null;
      const [ws] = user.workshopId != null
        ? await db.select().from(workshopsTable).where(eq(workshopsTable.id, user.workshopId))
        : [];
      return { user, workshop: ws ?? null };
    });

    const user = found?.user;
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !user.active || !valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    if (user.role !== "superadmin" && !found?.workshop?.active) {
      res.status(403).json({ error: "Este taller está desactivado. Contacta al administrador." });
      return;
    }

    // Nueva sesión al entrar (evita reutilizar un id de sesión anterior).
    await new Promise<void>((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
    req.session.userId = user.id;
    req.session.workshopId = user.role === "superadmin" ? null : user.workshopId;
    await setCurrentWorkshop(req.session.workshopId ?? null);

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      workshopId: req.session.workshopId ?? null,
      workshopName: found?.workshop?.name ?? null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /auth/me
router.get("/me", async (req, res) => {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      if (req.session.userId) req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(user);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /auth/me — cada usuario cambia su nombre, email o contraseña (siempre con su contraseña actual).
router.patch("/me", async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1),
    name: z.string().trim().min(2).optional(),
    email: z.string().trim().email().optional(),
    newPassword: z.string().min(8, "La contraseña nueva debe tener al menos 8 caracteres").optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }); return; }
  const d = parsed.data;
  try {
    const session = await loadSessionUser(req);
    if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
    const outcome = await withBypass(async (db) => {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.id));
      if (!user || !(await bcrypt.compare(d.currentPassword, user.passwordHash))) return "wrong" as const;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (d.name !== undefined) updates.name = d.name;
      if (d.email !== undefined) updates.email = d.email.toLowerCase();
      if (d.newPassword !== undefined) updates.passwordHash = await bcrypt.hash(d.newPassword, 10);
      await db.update(usersTable).set(updates).where(eq(usersTable.id, session.id));
      return "ok" as const;
    });
    if (outcome === "wrong") { res.status(400).json({ error: "La contraseña actual no es correcta" }); return; }
    res.json((await loadSessionUser(req)) ?? session);
  } catch (e: any) {
    if (e?.code === "23505" || /unique/i.test(e?.message ?? "")) { res.status(409).json({ error: "Ese email ya está en uso" }); return; }
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
