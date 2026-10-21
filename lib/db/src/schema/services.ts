import { pgTable, serial, text, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  basePrice: numeric("base_price", { precision: 10, scale: 2 }),
  estimatedHours: numeric("estimated_hours", { precision: 5, scale: 2 }),
  clientDescription: text("client_description"),
  internalDescription: text("internal_description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
