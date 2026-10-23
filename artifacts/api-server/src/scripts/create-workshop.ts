// Crea un taller vacío con su administrador, igual que "Crear taller" en /plataforma, pero desde la línea de comandos
// (sirve para dejar listo un taller de producción apuntando a la base con DATABASE_URL_ADMIN + APP_DB_PASSWORD).
//
// Uso: WORKSHOP_NAME="Ridemec" ADMIN_NAME="Alessandro Roselli" ADMIN_EMAIL="ale@..." ADMIN_PASSWORD='...' \
//        pnpm --filter @workspace/api-server run create-workshop
import bcrypt from "bcryptjs";
import { pool, withBypass, workshopsTable, workshopSettingsTable, paymentMethodsTable, usersTable } from "@workspace/db";

const DEFAULT_PAYMENT_METHODS = ["Efectivo", "Transferencia", "Débito", "Crédito"];

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Define ${name}`);
  return v;
}

async function main() {
  const name = need("WORKSHOP_NAME");
  const adminName = need("ADMIN_NAME");
  const email = need("ADMIN_EMAIL").toLowerCase();
  const password = need("ADMIN_PASSWORD");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD debe tener al menos 8 caracteres");
  const phone = process.env.WORKSHOP_PHONE?.trim() || null;
  const passwordHash = await bcrypt.hash(password, 10);

  const ws = await withBypass((db) => db.transaction(async (tx) => {
    const [w] = await tx.insert(workshopsTable).values({ name }).returning();
    await tx.insert(workshopSettingsTable).values({ workshopId: w.id, name, phone });
    await tx.insert(paymentMethodsTable).values(DEFAULT_PAYMENT_METHODS.map(m => ({ workshopId: w.id, name: m })));
    // El primer usuario suele ser el mecánico dueño: hace los trabajos.
    await tx.insert(usersTable).values({ workshopId: w.id, name: adminName, email, passwordHash, role: "admin", doesJobs: true });
    return w;
  }));
  console.log(`Taller "${ws.name}" creado (#${ws.id}) con administrador ${email}.`);
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => pool.end());
