import { workshopIdColumn } from "./workshops";
import {
  pgTable, serial, text, integer, boolean, timestamp, numeric, pgEnum, uniqueIndex
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "./clients";
import { bicyclesTable } from "./bicycles";
import { usersTable } from "./users";
import { quotesTable } from "./quotes";
import { receptionsTable } from "./receptions";
import { quoteItemsTable } from "./quotes";
import { serviceStepsTable } from "./serviceSteps";
import { paymentMethodsTable } from "./paymentMethods";

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "ready_to_work",
  "in_progress",
  "quality_control",
  "ready_for_pickup",
  "delivered",
  "cancelled",
]);

export const workOrderItemStatusEnum = pgEnum("work_order_item_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const checklistItemStatusEnum = pgEnum("checklist_item_status", [
  "pending",
  "in_progress",
  "completed",
  "not_applicable",
  "with_observation",
]);

// Aprobación del cliente por ítem. Los ítems iniciales nacen aprobados;
// los adicionales nacen pendientes hasta que el cliente (o el taller) decide.
export const workOrderItemApprovalEnum = pgEnum("work_order_item_approval", [
  "pending",
  "approved",
  "rejected",
]);

export const workOrderPriorityEnum = pgEnum("work_order_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const workOrdersTable = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  workOrderNumber: text("work_order_number").notNull(),
  quoteId: integer("quote_id").references(() => quotesTable.id),
  receptionId: integer("reception_id").references(() => receptionsTable.id),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  bicycleId: integer("bicycle_id").notNull().references(() => bicyclesTable.id),
  mechanicId: integer("mechanic_id").references(() => usersTable.id),
  status: workOrderStatusEnum("status").notNull().default("ready_to_work"),
  priority: workOrderPriorityEnum("priority").notNull().default("normal"),
  internalNotes: text("internal_notes"),
  customerNotes: text("customer_notes"),
  estimatedDeliveryDate: timestamp("estimated_delivery_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  deliveredAt: timestamp("delivered_at"),
  // Cuándo se descontaron del stock los repuestos e insumos de la OT (al quedar lista).
  stockConsumedAt: timestamp("stock_consumed_at"),
  // Fecha de pago: independiente del término (completedAt) y de la entrega (deliveredAt).
  paidAt: timestamp("paid_at"),
  paymentMethodId: integer("payment_method_id").references(() => paymentMethodsTable.id),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  progressPercentage: numeric("progress_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
  workCaseId: integer("work_case_id"),
  // Token secreto del link público que se comparte con el cliente (/ot/:token).
  publicToken: text("public_token").unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Una sola OT activa por presupuesto (evita duplicados por doble clic).
  uniqueIndex("work_orders_active_quote_unique").on(t.quoteId)
    .where(sql`${t.active} AND ${t.quoteId} IS NOT NULL`),
]);

export const workOrderItemsTable = pgTable("work_order_items", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id),
  quoteItemId: integer("quote_item_id").references(() => quoteItemsTable.id),
  itemType: text("item_type").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }),
  status: workOrderItemStatusEnum("status").notNull().default("pending"),
  approvalStatus: workOrderItemApprovalEnum("approval_status").notNull().default("approved"),
  origin: text("origin").notNull().default("initial"), // initial | additional
  approvalDecidedAt: timestamp("approval_decided_at"),
  approvalDecidedBy: text("approval_decided_by"), // client | staff
  // Artículo del inventario, su costo unitario y si ya se descontó del stock (migración 011).
  partId: integer("part_id"),
  serviceId: integer("service_id"),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  stockConsumed: boolean("stock_consumed").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const workOrderChecklistItemsTable = pgTable("work_order_checklist_items", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id),
  workOrderItemId: integer("work_order_item_id").references(() => workOrderItemsTable.id),
  serviceStepId: integer("service_step_id").references(() => serviceStepsTable.id),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: checklistItemStatusEnum("status").notNull().default("pending"),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id),
  completedAt: timestamp("completed_at"),
  mechanicNote: text("mechanic_note"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkOrder = typeof workOrdersTable.$inferSelect;
export type WorkOrderItem = typeof workOrderItemsTable.$inferSelect;
export type WorkOrderChecklistItem = typeof workOrderChecklistItemsTable.$inferSelect;
