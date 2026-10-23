import { pgTable, serial, text, integer, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workshopIdColumn } from "./workshops";
import { clientsTable } from "./clients";
import { servicesTable } from "./services";
import { usersTable } from "./users";

export type ReservationQuoteItem = {
  itemType: "service" | "part" | "additional_labor" | "other";
  description: string;
  quantity: number;
  unitPrice: number;
  hours: number; // por unidad
  serviceId?: number | null;
};

// Reserva: espacio apartado para una bici que va a llegar (acordado por WhatsApp). No consume número de OT;
// al llegar el cliente se convierte en un trabajo normal y queda enlazada (work_order_id).
export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  clientId: integer("client_id").references(() => clientsTable.id),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  bicycleText: text("bicycle_text"),
  note: text("note"),
  serviceId: integer("service_id").references(() => servicesTable.id),
  estimatedHours: numeric("estimated_hours", { precision: 6, scale: 2 }),
  // Cotización previa: servicios y cobros acordados antes de que llegue la bici (migración 018).
  quoteItems: jsonb("quote_items").$type<ReservationQuoteItem[]>().notNull().default(sql`'[]'::jsonb`),
  expectedOn: date("expected_on").notNull(),
  expectedTime: text("expected_time"),
  status: text("status").notNull().default("reserved"), // reserved | arrived | cancelled | no_show
  workCaseId: integer("work_case_id"),
  workOrderId: integer("work_order_id"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Reservation = typeof reservationsTable.$inferSelect;
