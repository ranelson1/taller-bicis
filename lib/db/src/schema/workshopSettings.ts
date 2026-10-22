import { pgTable, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workshopsTable } from "./workshops";

// Un día abierto del taller: 0 = domingo … 6 = sábado, horas "HH:MM".
export type WorkshopScheduleDay = { day: number; open: string; close: string };

// Datos de cada taller (una fila por taller). Se editan en Administración → Configuración.
export const workshopSettingsTable = pgTable("workshop_settings", {
  workshopId: integer("workshop_id").primaryKey().default(sql`current_workshop_id()`).references(() => workshopsTable.id),
  name: text("name"),
  phone: text("phone"),
  address: text("address"),
  // Obsoleto desde 006: los días hábiles salen de `schedule`. Se mantiene sincronizado.
  workdays: text("workdays").notNull().default("1,2,3,4,5"),
  // Horario por día (solo los días que abre). null = horario por defecto.
  schedule: jsonb("schedule").$type<WorkshopScheduleDay[]>(),
  // Colación del equipo, se descuenta de la capacidad. null = sin colación.
  lunchStart: text("lunch_start"),
  lunchEnd: text("lunch_end"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkshopSettings = typeof workshopSettingsTable.$inferSelect;
