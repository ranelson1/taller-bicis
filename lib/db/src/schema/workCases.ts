import { workshopIdColumn } from "./workshops";
import {
  pgTable, serial, text, integer, boolean, timestamp, numeric, pgEnum
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { bicyclesTable } from "./bicycles";
import { usersTable } from "./users";

export const workCaseStatusEnum = pgEnum("work_case_status", [
  "lead",
  "quoted",
  "quote_sent",
  "quote_approved",
  "bike_received",
  "in_inspection",
  "ready_for_work_order",
  "in_work_order",
  "in_progress",
  "quality_control",
  "ready_for_pickup",
  "delivered",
  "cancelled",
  "closed",
]);

export const workCasesTable = pgTable("work_cases", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  workCaseNumber: text("work_case_number").notNull(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  bicycleId: integer("bicycle_id").references(() => bicyclesTable.id),
  status: workCaseStatusEnum("status").notNull().default("lead"),
  originChannel: text("origin_channel"),
  initialRequirement: text("initial_requirement"),
  assignedMechanicId: integer("assigned_mechanic_id").references(() => usersTable.id),
  totalEstimatedAmount: numeric("total_estimated_amount", { precision: 12, scale: 2 }),
  totalEstimatedLaborHours: numeric("total_estimated_labor_hours", { precision: 8, scale: 2 }),
  progressPercentage: numeric("progress_percentage", { precision: 5, scale: 2 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkCase = typeof workCasesTable.$inferSelect;
