import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const bicycleTypeEnum = pgEnum("bicycle_type", ["mtb", "road", "gravel", "urban", "ebike", "kids", "other"]);

export const bicyclesTable = pgTable("bicycles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year"),
  type: bicycleTypeEnum("type").notNull().default("mtb"),
  color: text("color"),
  rimSize: text("rim_size"),
  serialNumber: text("serial_number"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBicycleSchema = createInsertSchema(bicyclesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBicycle = z.infer<typeof insertBicycleSchema>;
export type Bicycle = typeof bicyclesTable.$inferSelect;
