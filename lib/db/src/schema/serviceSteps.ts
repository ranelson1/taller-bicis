import { workshopIdColumn } from "./workshops";
import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { servicesTable } from "./services";

export const serviceStepsTable = pgTable("service_steps", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  order: integer("order").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertServiceStepSchema = createInsertSchema(serviceStepsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServiceStep = z.infer<typeof insertServiceStepSchema>;
export type ServiceStep = typeof serviceStepsTable.$inferSelect;
