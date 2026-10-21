import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Un usuario desactivado pierde el acceso aunque tenga una sesión abierta.
  try {
    const [user] = await db.select({ active: usersTable.active }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (!user?.active) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
  } catch {
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  next();
}
