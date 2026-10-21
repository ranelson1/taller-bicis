import {
  pgTable, serial, text, integer, boolean, timestamp, numeric, jsonb, pgEnum
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { bicyclesTable } from "./bicycles";
import { usersTable } from "./users";
import { servicesTable } from "./services";
import { partsTable } from "./parts";

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "partially_approved",
  "approved",
  "rejected",
  "updated_after_sent",
  "ready_for_work_order",
  "converted_to_work_order",
]);

export const quoteItemTypeEnum = pgEnum("quote_item_type", [
  "service",
  "part",
  "additional_labor",
  "diagnosis",
  "recommendation",
  "discount",
  "other",
]);

export const quoteItemOriginEnum = pgEnum("quote_item_origin", [
  "customer_request",
  "mechanic_recommendation",
  "visual_inspection",
  "during_work",
  "warranty_correction",
  "manual",
]);

export const quoteItemApprovalEnum = pgEnum("quote_item_approval", [
  "pending",
  "approved",
  "rejected",
]);

export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull().unique(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  bicycleId: integer("bicycle_id").references(() => bicyclesTable.id),
  originChannel: text("origin_channel").notNull(),
  initialRequirement: text("initial_requirement"),
  status: quoteStatusEnum("status").notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  customerNotes: text("customer_notes"),
  internalNotes: text("internal_notes"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountTotal: numeric("discount_total", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  sentAt: timestamp("sent_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  workOrderId: integer("work_order_id"),
  workCaseId: integer("work_case_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const quoteItemsTable = pgTable("quote_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => quotesTable.id),
  itemType: quoteItemTypeEnum("item_type").notNull(),
  origin: quoteItemOriginEnum("origin").notNull().default("manual"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }),
  approvalStatus: quoteItemApprovalEnum("approval_status").notNull().default("pending"),
  serviceId: integer("service_id").references(() => servicesTable.id),
  partId: integer("part_id").references(() => partsTable.id),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const quoteVersionsTable = pgTable("quote_versions", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => quotesTable.id),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountTotal: numeric("discount_total", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedLaborHours: numeric("estimated_labor_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  itemsSnapshot: jsonb("items_snapshot"),
  customerNotesSnapshot: text("customer_notes_snapshot"),
  internalNotesSnapshot: text("internal_notes_snapshot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  approvedAt: timestamp("approved_at"),
});

export const timelineEventsTable = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Quote = typeof quotesTable.$inferSelect;
export type QuoteItem = typeof quoteItemsTable.$inferSelect;
export type QuoteVersion = typeof quoteVersionsTable.$inferSelect;
export type TimelineEvent = typeof timelineEventsTable.$inferSelect;
