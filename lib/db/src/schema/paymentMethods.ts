import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentMethodsTable = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPaymentMethodSchema = createInsertSchema(paymentMethodsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;
