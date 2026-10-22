import { workshopIdColumn } from "./workshops";
import { pgTable, serial, text, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";

export const partsTable = pgTable("parts", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  name: text("name").notNull(),
  categoryId: integer("category_id").references(() => categoriesTable.id),
  brand: text("brand"),
  // Precio al cliente (PVP). Puede ser el que fija el distribuidor o costo + margen.
  suggestedPrice: numeric("suggested_price", { precision: 10, scale: 2 }),
  sku: text("sku"),
  // Inventario (migración 011): part = se cobra al cliente; supply = insumo del taller.
  kind: text("kind").notNull().default("part"),
  unit: text("unit").notNull().default("un"),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }),     // costo promedio ponderado
  stock: numeric("stock", { precision: 12, scale: 3 }).notNull().default("0"),
  minStock: numeric("min_stock", { precision: 12, scale: 3 }),       // punto de recompra
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPartSchema = createInsertSchema(partsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPart = z.infer<typeof insertPartSchema>;
export type Part = typeof partsTable.$inferSelect;
