import { type Request, type Response, type NextFunction } from "express";
import { usersTable, workshopsTable, workshopSettingsTable, withBypass } from "@workspace/db";
import { logoUrl } from "../helpers/settings";
import { eq } from "drizzle-orm";
import "../lib/session";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "mechanic" | "reception" | "superadmin";
  workshopId: number | null;
  workshopName: string | null;
  workshopLogoUrl: string | null;
  doesJobs: boolean;
};

// Usuario de la sesión y su taller, o null si la sesión ya no vale (usuario o taller desactivado,
// o una sesión anterior al multi-taller). Se busca saltando RLS porque el superadmin no tiene taller.
export async function loadSessionUser(req: Request): Promise<SessionUser | null> {
  const userId = req.session.userId;
  if (!userId) return null;
  const workshopId = req.session.workshopId ?? null;
  return withBypass(async (db) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user?.active) return null;
    if (user.role !== "superadmin" && user.workshopId !== workshopId) return null;
    let workshopName: string | null = null;
    let workshopLogoUrl: string | null = null;
    if (workshopId != null) {
      const [ws] = await db.select().from(workshopsTable).where(eq(workshopsTable.id, workshopId));
      // Un taller desactivado deja fuera a sus usuarios (el superadmin puede seguir entrando).
      if (!ws || (!ws.active && user.role !== "superadmin")) return null;
      workshopName = ws.name;
      const [settings] = await db.select({ logoKey: workshopSettingsTable.logoKey }).from(workshopSettingsTable)
        .where(eq(workshopSettingsTable.workshopId, workshopId));
      workshopLogoUrl = settings?.logoKey ? logoUrl(workshopId, settings.logoKey) : null;
    }
    return { id: user.id, name: user.name, email: user.email, role: user.role, workshopId, workshopName, workshopLogoUrl, doesJobs: user.doesJobs };
  });
}

// Rutas del taller: sesión válida y un taller fijado (el superadmin solo si entró a uno).
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      if (req.session.userId) req.session.destroy(() => {});
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (user.workshopId == null) {
      res.status(403).json({ error: "Elige un taller para trabajar" });
      return;
    }
    // Un superadmin dentro de un taller actúa como su administrador.
    res.locals.userRole = user.role === "superadmin" ? "admin" : user.role;
    res.locals.user = user;
  } catch {
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  next();
}

// Panel de la plataforma: solo superadmin.
export async function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await loadSessionUser(req);
    if (!user || user.role !== "superadmin") {
      res.status(user ? 403 : 401).json({ error: user ? "Solo para el administrador de la plataforma" : "Not authenticated" });
      return;
    }
    res.locals.user = user;
  } catch {
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  next();
}

// Usuarios y catálogos: todos pueden leerlos (el taller necesita la lista de mecánicos,
// servicios, repuestos…), pero solo un admin puede crearlos, cambiarlos o borrarlos.
// Va después de requireAuth.
export function adminOnlyWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && res.locals.userRole !== "admin") {
    res.status(403).json({ error: "Solo un administrador puede hacer este cambio" });
    return;
  }
  next();
}
