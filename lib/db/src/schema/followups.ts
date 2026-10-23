import { pgTable, serial, integer, date, timestamp, unique } from "drizzle-orm/pg-core";
import { workshopIdColumn } from "./workshops";
import { clientsTable } from "./clients";

// "Ya le escribí": el cliente no vuelve a aparecer en la lista de recontacto hasta `untilOn`.
export const followupSnoozesTable = pgTable("followup_snoozes", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id),
  untilOn: date("until_on").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.clientId)]);
