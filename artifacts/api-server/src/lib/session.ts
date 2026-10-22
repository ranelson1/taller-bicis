import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    // Taller en el que trabaja la sesión. Para un superadmin, el taller al que "entró" (o ninguno).
    workshopId: number | null;
  }
}
