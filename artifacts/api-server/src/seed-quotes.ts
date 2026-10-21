/**
 * SEED SCRIPT — PRESUPUESTOS DE PRUEBA
 * Ejecutar después de seed.ts principal para agregar presupuestos de muestra.
 */

import { db, pool } from "@workspace/db";
import {
  usersTable, clientsTable, bicyclesTable, servicesTable,
  quotesTable, quoteItemsTable, quoteVersionsTable, timelineEventsTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";

async function seedQuotes() {
  console.log("🌱 Seeding quotes...");

  // Skip if already seeded
  const [existing] = await db.select({ n: count() }).from(quotesTable);
  if (Number(existing?.n) > 0) {
    console.log("✅ Quotes already seeded.");
    await pool.end();
    return;
  }

  const clients = await db.select().from(clientsTable);
  const pedro = clients.find(c => c.name === "Pedro González")!;
  const maria = clients.find(c => c.name === "María Soto")!;
  const andres = clients.find(c => c.name === "Andrés Rojas")!;

  if (!pedro || !maria || !andres) {
    console.error("❌ Run main seed.ts first to create clients.");
    await pool.end();
    process.exit(1);
  }

  const bikes = await db.select().from(bicyclesTable);
  const trekSlash = bikes.find(b => b.clientId === pedro.id && b.brand === "Trek");
  const stumpjumper = bikes.find(b => b.clientId === maria.id && b.brand === "Specialized");

  const svcs = await db.select().from(servicesTable);
  const svcMap: Record<string, number> = {};
  for (const s of svcs) svcMap[s.name] = s.id;

  const users = await db.select().from(usersTable);
  const admin = users.find(u => u.email === "admin@taller.com")!;

  // P-0001: Pedro, Trek Slash, WhatsApp, Enviado
  const [q1] = await db.insert(quotesTable).values({
    quoteNumber: "P-0001",
    clientId: pedro.id,
    bicycleId: trekSlash?.id ?? null,
    originChannel: "whatsapp",
    initialRequirement: "Servicio completo de suspensión y frenos para la temporada",
    status: "sent",
    currentVersion: 1,
    customerNotes: "El cliente indica que la horquilla está dura y los frenos chirrían.",
    subtotal: "185000",
    discountTotal: "0",
    total: "185000",
    estimatedLaborHours: "4.25",
    sentAt: new Date("2026-06-28T10:00:00Z"),
    active: true,
  }).returning();

  await db.insert(quoteItemsTable).values([
    { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Servicio horquilla", quantity: "1", unitPrice: "85000", total: "85000", estimatedLaborHours: "2.0", approvalStatus: "pending", serviceId: svcMap["Servicio horquilla"], sortOrder: 1, active: true },
    { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Servicio shock", quantity: "1", unitPrice: "75000", total: "75000", estimatedLaborHours: "1.5", approvalStatus: "pending", serviceId: svcMap["Servicio shock"], sortOrder: 2, active: true },
    { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Sangrado frenos", quantity: "1", unitPrice: "25000", total: "25000", estimatedLaborHours: "0.75", approvalStatus: "pending", serviceId: svcMap["Sangrado frenos"], sortOrder: 3, active: true },
  ]);

  await db.insert(quoteVersionsTable).values({
    quoteId: q1.id, versionNumber: 1, status: "sent",
    subtotal: "185000", discountTotal: "0", total: "185000", estimatedLaborHours: "4.25",
    itemsSnapshot: [{ description: "Servicio horquilla", unitPrice: 85000 }, { description: "Servicio shock", unitPrice: 75000 }, { description: "Sangrado frenos", unitPrice: 25000 }],
    sentAt: new Date("2026-06-28T10:00:00Z"),
  });

  await db.insert(timelineEventsTable).values([
    { entityType: "quote", entityId: q1.id, userId: admin.id, action: "quote_created", newStatus: "draft" },
    { entityType: "quote", entityId: q1.id, userId: admin.id, action: "quote_sent", previousStatus: "draft", newStatus: "sent" },
  ]);

  // P-0002: María, Stumpjumper, Presencial, Borrador
  const [q2] = await db.insert(quotesTable).values({
    quoteNumber: "P-0002",
    clientId: maria.id,
    bicycleId: stumpjumper?.id ?? null,
    originChannel: "presencial",
    initialRequirement: "Mantención anual y ajuste de transmisión",
    status: "draft",
    currentVersion: 1,
    subtotal: "80000",
    discountTotal: "0",
    total: "80000",
    estimatedLaborHours: "3.0",
    active: true,
  }).returning();

  await db.insert(quoteItemsTable).values([
    { quoteId: q2.id, itemType: "service", origin: "customer_request", description: "Mantención general", quantity: "1", unitPrice: "60000", total: "60000", estimatedLaborHours: "2.5", approvalStatus: "pending", serviceId: svcMap["Mantención general"], sortOrder: 1, active: true },
    { quoteId: q2.id, itemType: "service", origin: "customer_request", description: "Ajuste transmisión", quantity: "1", unitPrice: "20000", total: "20000", estimatedLaborHours: "0.5", approvalStatus: "pending", serviceId: svcMap["Ajuste transmisión"], sortOrder: 2, active: true },
  ]);

  await db.insert(timelineEventsTable).values([
    { entityType: "quote", entityId: q2.id, userId: admin.id, action: "quote_created", newStatus: "draft" },
  ]);

  // P-0003: Andrés, sin bicicleta, WhatsApp, Aprobado parcialmente
  const [q3] = await db.insert(quotesTable).values({
    quoteNumber: "P-0003",
    clientId: andres.id,
    bicycleId: null,
    originChannel: "whatsapp",
    initialRequirement: "Diagnóstico y revisión general antes de comprar la bicicleta",
    status: "partially_approved",
    currentVersion: 1,
    customerNotes: "Cliente trae bicicleta de marca desconocida. Quiere saber si vale la pena arreglarla.",
    subtotal: "85000",
    discountTotal: "0",
    total: "85000",
    estimatedLaborHours: "3.5",
    sentAt: new Date("2026-07-01T09:00:00Z"),
    active: true,
  }).returning();

  await db.insert(quoteItemsTable).values([
    { quoteId: q3.id, itemType: "diagnosis", origin: "customer_request", description: "Diagnóstico general de la bicicleta", quantity: "1", unitPrice: "15000", total: "15000", estimatedLaborHours: "0.5", approvalStatus: "approved", serviceId: svcMap["Diagnóstico"], sortOrder: 1, active: true },
    { quoteId: q3.id, itemType: "service", origin: "mechanic_recommendation", description: "Servicio cuadro/pivotes", quantity: "1", unitPrice: "70000", total: "70000", estimatedLaborHours: "3.0", approvalStatus: "pending", serviceId: svcMap["Servicio cuadro/pivotes"], sortOrder: 2, active: true },
  ]);

  await db.insert(quoteVersionsTable).values({
    quoteId: q3.id, versionNumber: 1, status: "sent",
    subtotal: "85000", discountTotal: "0", total: "85000", estimatedLaborHours: "3.5",
    itemsSnapshot: [{ description: "Diagnóstico general", unitPrice: 15000 }, { description: "Servicio cuadro/pivotes", unitPrice: 70000 }],
    sentAt: new Date("2026-07-01T09:00:00Z"),
  });

  await db.insert(timelineEventsTable).values([
    { entityType: "quote", entityId: q3.id, userId: admin.id, action: "quote_created", newStatus: "draft" },
    { entityType: "quote", entityId: q3.id, userId: admin.id, action: "quote_sent", previousStatus: "draft", newStatus: "sent" },
    { entityType: "quote", entityId: q3.id, userId: admin.id, action: "item_approved", comment: "Diagnóstico aprobado por cliente" },
    { entityType: "quote", entityId: q3.id, userId: admin.id, action: "quote_partially_approved", previousStatus: "sent", newStatus: "partially_approved" },
  ]);

  console.log("✅ Quotes seed complete! P-0001, P-0002, P-0003 created.");
  await pool.end();
}

seedQuotes().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
