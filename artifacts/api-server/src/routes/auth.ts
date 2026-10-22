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

export default router;
