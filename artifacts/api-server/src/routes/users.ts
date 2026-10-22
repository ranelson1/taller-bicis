import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, adminOnlyWrites } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, adminOnlyWrites);

const userRoleEnum = z.enum(["admin", "mechanic", "reception"]);

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: userRoleEnum,
  weeklyHours: z.number().int().min(0).max(168).optional().nullable(),
  calendarColor: z.string().optional().nullable(),
  doesJobs: z.boolean().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: userRoleEnum.optional(),
  weeklyHours: z.number().int().min(0).max(168).optional().nullable(),
  calendarColor: z.string().optional().nullable(),
  doesJobs: z.boolean().optional(),
  active: z.boolean().optional(),
});

const USER_FIELDS = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  weeklyHours: usersTable.weeklyHours,
  calendarColor: usersTable.calendarColor,
  doesJobs: usersTable.doesJobs,
  active: usersTable.active,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
} as const;

// GET /users
router.get("/", async (_req, res) => {
  try {
    const users = await db.select(USER_FIELDS).from(usersTable).orderBy(usersTable.name);
    res.json(users);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /users/capacity — quienes hacen trabajos
router.get("/capacity", async (_req, res) => {
  try {
    const mechanics = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      weeklyHours: usersTable.weeklyHours,
      calendarColor: usersTable.calendarColor,
    }).from(usersTable)
      .where(and(eq(usersTable.active, true), eq(usersTable.doesJobs, true)))
      .orderBy(usersTable.name);
    res.json(mechanics.map(m => ({ ...m, weeklyHours: m.weeklyHours ?? 0 })));
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /users/:id
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [user] = await db.select(USER_FIELDS).from(usersTable).where(eq(usersTable.id, id));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(user);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /users
router.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }
  const { name, email, password, role, weeklyHours, calendarColor, doesJobs } = parsed.data;
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(usersTable).values({
      name, email, passwordHash, role,
      weeklyHours: weeklyHours ?? null,
      calendarColor: calendarColor ?? null,
      // Por defecto los mecánicos hacen trabajos; el admin solo si lo marca.
      doesJobs: doesJobs ?? role === "mechanic",
    }).returning(USER_FIELDS);
    res.status(201).json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(409).json({ error: "Email already exists" }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /users/:id
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.issues });
    return;
  }
  const data = parsed.data;

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) updates.email = data.email;
    if (data.password !== undefined) updates.passwordHash = await bcrypt.hash(data.password, 10);
    if (data.role !== undefined) updates.role = data.role;
    if (data.weeklyHours !== undefined) updates.weeklyHours = data.weeklyHours;
    if (data.calendarColor !== undefined) updates.calendarColor = data.calendarColor;
    if (data.doesJobs !== undefined) updates.doesJobs = data.doesJobs;
    if (data.active !== undefined) updates.active = data.active;

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning(USER_FIELDS);
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(user);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /users/:id — soft delete
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const deleted = await db.update(usersTable).set({ active: false, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
