// Crea (o actualiza la contraseña de) el superadmin de la plataforma: quien crea talleres.
// Uso: SUPERADMIN_EMAIL=tu@correo.cl SUPERADMIN_PASSWORD='...' pnpm --filter @workspace/api-server run create-superadmin
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { pool, usersTable, withBypass } from "@workspace/db";

const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPERADMIN_PASSWORD;
const name = process.env.SUPERADMIN_NAME?.trim() || "Administrador plataforma";

if (!email || !password || password.length < 10) {
  console.error("Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (mínimo 10 caracteres).");
  process.exit(1);
}

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await withBypass(async (db) => {
    const [existing] = await db.select().from(usersTable).where(eq(sql`lower(${usersTable.email})`, email));
    if (existing && existing.role !== "superadmin") {
      throw new Error(`${email} ya es usuario de un taller; usa otro email para el superadmin.`);
    }
    if (existing) {
      await db.update(usersTable).set({ passwordHash, active: true, updatedAt: new Date() }).where(eq(usersTable.id, existing.id));
      return "actualizado";
    }
    await db.insert(usersTable).values({ workshopId: null, name, email, passwordHash, role: "superadmin" });
    return "creado";
  });
  console.log(`Superadmin ${email} ${result}.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
