import { workshopIdColumn } from "./workshops";
import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb, pgEnum, numeric
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { bicyclesTable } from "./bicycles";
import { usersTable } from "./users";
import { quotesTable } from "./quotes";
import { servicesTable } from "./services";
import { partsTable } from "./parts";
import { quoteItemsTable } from "./quotes";

export const receptionStatusEnum = pgEnum("reception_status", [
  "received",
  "in_inspection",
  "inspection_completed",
  "waiting_quote_approval",
  "ready_for_work_order",
  "cancelled",
]);

export const findingSeverityEnum = pgEnum("finding_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const receptionsTable = pgTable("receptions", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  receptionNumber: text("reception_number").notNull(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  bicycleId: integer("bicycle_id").notNull().references(() => bicyclesTable.id),
  quoteId: integer("quote_id").references(() => quotesTable.id),
  receivedByUserId: integer("received_by_user_id").references(() => usersTable.id),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  customerReportedProblem: text("customer_reported_problem"),
  initialVisualCondition: text("initial_visual_condition"),
  accessoriesReceived: jsonb("accessories_received"),
  internalNotes: text("internal_notes"),
  customerNotes: text("customer_notes"),
  status: receptionStatusEnum("status").notNull().default("received"),
  workOrderId: integer("work_order_id"),
  workCaseId: integer("work_case_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const inspectionFindingsTable = pgTable("inspection_findings", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  receptionId: integer("reception_id").notNull().references(() => receptionsTable.id),
  quoteId: integer("quote_id").references(() => quotesTable.id),
  mechanicId: integer("mechanic_id").references(() => usersTable.id),
  area: text("area").notNull(),
  severity: findingSeverityEnum("severity").notNull().default("low"),
  finding: text("finding").notNull(),
  recommendation: text("recommendation"),
  shouldCreateQuoteItem: boolean("should_create_quote_item").notNull().default(false),
  createdQuoteItemId: integer("created_quote_item_id").references(() => quoteItemsTable.id),
  itemType: text("item_type"),
  serviceId: integer("service_id").references(() => servicesTable.id),
  partId: integer("part_id").references(() => partsTable.id),
  quoteItemDescription: text("quote_item_description"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }),
  internalNotes: text("internal_notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Reception = typeof receptionsTable.$inferSelect;
export type InspectionFinding = typeof inspectionFindingsTable.$inferSelect;
