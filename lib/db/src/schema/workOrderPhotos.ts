import { workshopIdColumn } from "./workshops";
import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { workOrdersTable } from "./workOrders";
import { usersTable } from "./users";

// Fotos de una OT (respaldo del estado de la bici y del trabajo). El archivo vive en el
// almacenamiento de la API (helpers/photoStorage.ts); aquí solo su clave y metadatos.
export const workOrderPhotosTable = pgTable("work_order_photos", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  note: text("note"),
  visibleToClient: boolean("visible_to_client").notNull().default(true),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkOrderPhoto = typeof workOrderPhotosTable.$inferSelect;
