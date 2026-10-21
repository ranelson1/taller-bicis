import { pgTable, serial, text, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";

export const partsTable = pgTable("parts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  brand: text("brand"),
  suggestedPrice: numeric("suggested_price", { precision: 10, scale: 2 }),
  sku: text("sku"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPartSchema = createInsertSchema(partsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPart = z.infer<typeof insertPartSchema>;
export type Part = typeof partsTable.$inferSelect;
