import { sql } from "drizzle-orm";
import { workshopsTable } from "./workshops";
import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["admin", "mechanic", "reception", "superadmin"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  // null = superadmin de la plataforma (no pertenece a ningún taller).
  workshopId: integer("workshop_id").default(sql`current_workshop_id()`).references(() => workshopsTable.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("mechanic"),
  weeklyHours: integer("weekly_hours"),
  // Hace trabajos: se le asignan OT y cuenta para la capacidad (en un taller de una persona, el admin).
  doesJobs: boolean("does_jobs").notNull().default(false),
  calendarColor: text("calendar_color"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
