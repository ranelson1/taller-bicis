import { pgTable, serial, text, integer, boolean, timestamp, numeric, date, unique } from "drizzle-orm/pg-core";
import { workshopIdColumn } from "./workshops";
import { partsTable } from "./parts";
import { servicesTable } from "./services";
import { usersTable } from "./users";
import { workOrdersTable } from "./workOrders";

// Inventario y compras (migración 011). Los artículos son la tabla `parts`.

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  name: text("name").notNull(),
  rut: text("rut"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Factura, boleta o guía de un proveedor, con su archivo original.
export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  docType: text("doc_type").notNull().default("factura"),   // factura | boleta | guia | otro
  docNumber: text("doc_number"),
  issuedOn: date("issued_on"),
  netTotal: numeric("net_total", { precision: 12, scale: 2 }),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }),
  total: numeric("total", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("draft"),        // draft | confirmed | cancelled
  source: text("source").notNull().default("manual"),       // manual | xml | pdf | image
  fileKey: text("file_key"),
  fileMime: text("file_mime"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseItemsTable = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  purchaseId: integer("purchase_id").notNull().references(() => purchasesTable.id, { onDelete: "cascade" }),
  partId: integer("part_id").references(() => partsTable.id),           // null = artículo nuevo al confirmar
  description: text("description").notNull(),
  supplierCode: text("supplier_code"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  unit: text("unit"),
  unitCostNet: numeric("unit_cost_net", { precision: 12, scale: 2 }).notNull().default("0"),
  // Comprado para un trabajo: entra y sale del stock al confirmar y se cobra en esa OT.
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Cada entrada y salida de stock, con su costo: la base para cuadrar cuentas.
export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  partId: integer("part_id").notNull().references(() => partsTable.id),
  kind: text("kind").notNull(),                                            // purchase | consumption | return | adjustment
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),   // + entra, − sale
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id),
  workOrderItemId: integer("work_order_item_id"),
  purchaseId: integer("purchase_id").references(() => purchasesTable.id),
  automatic: boolean("automatic").notNull().default(false),
  note: text("note"),
  userId: integer("user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insumos que gasta un servicio (ej.: sangrado de frenos = 50 ml de líquido).
export const serviceSuppliesTable = pgTable("service_supplies", {
  id: serial("id").primaryKey(),
  workshopId: workshopIdColumn(),
  serviceId: integer("service_id").notNull().references(() => servicesTable.id, { onDelete: "cascade" }),
  partId: integer("part_id").notNull().references(() => partsTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
}, (t) => [unique().on(t.serviceId, t.partId)]);

export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;
