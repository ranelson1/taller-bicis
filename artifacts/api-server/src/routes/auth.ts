import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import "../lib/session";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email and password are required", details: parsed.error.issues });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || !user.active) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    req.session.userId = user.id;
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch {
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
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
    if (!user || !user.active) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
