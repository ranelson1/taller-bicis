import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Talleres que usan la app. Cada fila de las demás tablas pertenece a uno (workshop_id) y
// Row Level Security limita cada conexión a su taller (migración 008).
export const workshopsTable = pgTable("workshops", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Workshop = typeof workshopsTable.$inferSelect;

// Columna workshop_id: por defecto el taller de la conexión actual, así los INSERT no la nombran.
export const workshopIdColumn = () =>
  integer("workshop_id").notNull().default(sql`current_workshop_id()`).references(() => workshopsTable.id);
