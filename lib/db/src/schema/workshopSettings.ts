import { pgTable, integer, text, timestamp, jsonb, numeric, boolean } from "drizzle-orm/pg-core";
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
  // Costo de la hora de trabajo = (gastos fijos + sueldo) / horas que se repara al mes.
  monthlyFixedCosts: numeric("monthly_fixed_costs", { precision: 12, scale: 2 }),
  monthlySalary: numeric("monthly_salary", { precision: 12, scale: 2 }),
  monthlyWorkHours: numeric("monthly_work_hours", { precision: 6, scale: 1 }),
  laborCostPerHour: numeric("labor_cost_per_hour", { precision: 12, scale: 2 }),
  // Margen por defecto sobre repuestos comprados para un trabajo (30 = 30 %).
  defaultPartsMarginPct: numeric("default_parts_margin_pct", { precision: 5, scale: 1 }).notNull().default("30"),
  logoKey: text("logo_key"),
  // Con inicio de actividades el IVA de las compras se recupera: costos y márgenes netos.
  recoversVat: boolean("recovers_vat").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkshopSettings = typeof workshopSettingsTable.$inferSelect;
