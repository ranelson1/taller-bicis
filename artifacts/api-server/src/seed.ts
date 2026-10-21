/**
 * SEED SCRIPT — DATOS DE PRUEBA
 * ⚠️  CREDENCIALES DEMO — SOLO PARA DESARROLLO — NO USAR EN PRODUCCIÓN ⚠️
 *
 * Usuarios y contraseñas de prueba:
 *   admin@taller.com   / admin123
 *   juan@taller.com    / juan123
 *   diego@taller.com   / diego123
 *
 * Estas contraseñas son simples y predecibles. Cámbialas antes de desplegar
 * en producción. Nunca uses estas credenciales en un entorno real.
 */

import { db } from "@workspace/db";
import {
  usersTable,
  categoriesTable,
  paymentMethodsTable,
  clientsTable,
  bicyclesTable,
  servicesTable,
  serviceStepsTable,
  partsTable,
  quotesTable,
  quoteItemsTable,
  quoteVersionsTable,
  timelineEventsTable,
  receptionsTable,
  inspectionFindingsTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";

async function seed() {
  console.log("🌱 Iniciando seed...");

  // ── CATEGORÍAS ────────────────────────────────────────────────────────────
  console.log("  Creando categorías...");
  const categoryNames = [
    "Suspensión",
    "Transmisión",
    "Frenos",
    "Ruedas",
    "Cuadro",
    "E-bike",
    "Mantención general",
    "Diagnóstico",
    "Repuestos",
    "Mano de obra",
  ];
  const insertedCategories = await db
    .insert(categoriesTable)
    .values(categoryNames.map((name) => ({ name })))
    .returning();

  const catMap: Record<string, number> = {};
  for (const cat of insertedCategories) {
    catMap[cat.name] = cat.id;
  }

  // ── MÉTODOS DE PAGO ───────────────────────────────────────────────────────
  console.log("  Creando métodos de pago...");
  await db.insert(paymentMethodsTable).values([
    { name: "Efectivo" },
    { name: "Transferencia" },
    { name: "Débito" },
    { name: "Crédito" },
    { name: "Otro" },
  ]);

  // ── USUARIOS ──────────────────────────────────────────────────────────────
  console.log("  Creando usuarios...");
  // ⚠️ CREDENCIALES DEMO — SOLO DESARROLLO
  const users = [
    { name: "Admin Taller", email: "admin@taller.com", password: "admin123", role: "admin" as const, weeklyHours: null, calendarColor: null },
    { name: "Mecánico Juan", email: "juan@taller.com", password: "juan123", role: "mechanic" as const, weeklyHours: 40, calendarColor: "#3b82f6" },
    { name: "Mecánico Diego", email: "diego@taller.com", password: "diego123", role: "mechanic" as const, weeklyHours: 35, calendarColor: "#10b981" },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await db.insert(usersTable).values({
      name: u.name,
      email: u.email,
      passwordHash,
      role: u.role,
      weeklyHours: u.weeklyHours,
      calendarColor: u.calendarColor,
    });
  }

  // ── CLIENTES ──────────────────────────────────────────────────────────────
  console.log("  Creando clientes...");
  const insertedClients = await db.insert(clientsTable).values([
    { name: "Pedro González", phone: "+56 9 1234 5678", email: "pedro@email.com", notes: "Cliente frecuente. Prefiere contacto por WhatsApp." },
    { name: "María Soto", phone: "+56 9 8765 4321", email: "maria@email.com", notes: null },
    { name: "Andrés Rojas", phone: "+56 9 5555 7777", email: null, notes: "Solo contactar en horario de tarde." },
  ]).returning();

  const pedro = insertedClients.find((c) => c.name === "Pedro González")!;
  const maria = insertedClients.find((c) => c.name === "María Soto")!;
  const andres = insertedClients.find((c) => c.name === "Andrés Rojas")!;

  // ── BICICLETAS ────────────────────────────────────────────────────────────
  console.log("  Creando bicicletas...");
  await db.insert(bicyclesTable).values([
    { clientId: pedro.id, brand: "Trek", model: "Slash 9.8", type: "mtb", color: "Azul", rimSize: '29"', serialNumber: "TK-2023-001", notes: "Fox 36 Factory 170mm" },
    { clientId: pedro.id, brand: "Sin marca", model: "Gravel touring", type: "gravel", color: "Negro mate", rimSize: '700c', serialNumber: null, notes: "Usada para commute diario" },
    { clientId: maria.id, brand: "Specialized", model: "Stumpjumper EVO", type: "mtb", color: "Verde musgo", rimSize: '29"', serialNumber: "SP-2022-888", notes: "RockShox Pike Ultimate 140mm" },
    { clientId: andres.id, brand: "Giant", model: "Reign Advanced Pro", type: "mtb", color: "Rojo", rimSize: '29"', serialNumber: "GI-2024-055", notes: "Fox DPS shock trasero" },
  ]);

  // ── SERVICIOS TÉCNICOS ────────────────────────────────────────────────────
  console.log("  Creando servicios técnicos...");

  // Servicio horquilla
  const [horquilla] = await db.insert(servicesTable).values({
    name: "Servicio horquilla",
    categoryId: catMap["Suspensión"],
    basePrice: "85000",
    estimatedHours: "2.0",
    clientDescription: "Servicio completo de horquilla delantera: limpieza, cambio de aceite y sellos.",
    internalDescription: "Desarmado completo, revisión de barras, cambio de aceite y retenes.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: horquilla!.id, description: "Recepción y revisión visual de la horquilla", order: 0 },
    { serviceId: horquilla!.id, description: "Desmontaje de horquilla de la bicicleta", order: 1 },
    { serviceId: horquilla!.id, description: "Limpieza externa de botellas y corona", order: 2 },
    { serviceId: horquilla!.id, description: "Desarme de botellas (lowers)", order: 3 },
    { serviceId: horquilla!.id, description: "Revisión de barras internas (stanchions)", order: 4 },
    { serviceId: horquilla!.id, description: "Revisión de retenes y espumas", order: 5 },
    { serviceId: horquilla!.id, description: "Cambio de aceite de baño (lowers oil)", order: 6 },
    { serviceId: horquilla!.id, description: "Cambio de sellos si están dañados", order: 7 },
    { serviceId: horquilla!.id, description: "Armado de botellas", order: 8 },
    { serviceId: horquilla!.id, description: "Torque final según especificaciones del fabricante", order: 9 },
    { serviceId: horquilla!.id, description: "Reinstalación en bicicleta", order: 10 },
    { serviceId: horquilla!.id, description: "Prueba de funcionamiento y ajuste de SAG", order: 11 },
    { serviceId: horquilla!.id, description: "Control de fugas y marcado como terminado", order: 12 },
  ]);

  // Servicio shock
  const [shock] = await db.insert(servicesTable).values({
    name: "Servicio shock",
    categoryId: catMap["Suspensión"],
    basePrice: "75000",
    estimatedHours: "1.5",
    clientDescription: "Servicio completo del amortiguador trasero.",
    internalDescription: "Revisión de sellos, cámara de aire y lubricación.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: shock!.id, description: "Recepción y revisión visual del amortiguador", order: 0 },
    { serviceId: shock!.id, description: "Desmontaje del shock de la bicicleta", order: 1 },
    { serviceId: shock!.id, description: "Limpieza externa y revisión de daños", order: 2 },
    { serviceId: shock!.id, description: "Desarme según tipo (coil o aire)", order: 3 },
    { serviceId: shock!.id, description: "Cambio de sellos y O-rings", order: 4 },
    { serviceId: shock!.id, description: "Lubricación y armado", order: 5 },
    { serviceId: shock!.id, description: "Reinstalación y ajuste de SAG", order: 6 },
    { serviceId: shock!.id, description: "Prueba y control de fugas", order: 7 },
  ]);

  // Servicio dropper
  const [dropper] = await db.insert(servicesTable).values({
    name: "Servicio dropper",
    categoryId: catMap["Suspensión"],
    basePrice: "45000",
    estimatedHours: "1.0",
    clientDescription: "Servicio del tija telescópica (dropper post).",
    internalDescription: "Revisión de mecanismo interno, cable y mando.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: dropper!.id, description: "Revisión del mecanismo de bajada/subida", order: 0 },
    { serviceId: dropper!.id, description: "Revisión y ajuste del cable o hidráulico", order: 1 },
    { serviceId: dropper!.id, description: "Revisión del mando (lever)", order: 2 },
    { serviceId: dropper!.id, description: "Limpieza y lubricación del eje", order: 3 },
    { serviceId: dropper!.id, description: "Prueba de funcionamiento", order: 4 },
  ]);

  // Sangrado frenos
  const [frenos] = await db.insert(servicesTable).values({
    name: "Sangrado frenos",
    categoryId: catMap["Frenos"],
    basePrice: "25000",
    estimatedHours: "0.75",
    clientDescription: "Sangrado hidráulico de frenos para recuperar sensación firme.",
    internalDescription: "Purga completa del sistema hidráulico.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: frenos!.id, description: "Preparar kit de sangrado y fluido correspondiente", order: 0 },
    { serviceId: frenos!.id, description: "Conectar jeringa al caliper", order: 1 },
    { serviceId: frenos!.id, description: "Purgar aire del sistema", order: 2 },
    { serviceId: frenos!.id, description: "Conectar jeringa al mando (lever)", order: 3 },
    { serviceId: frenos!.id, description: "Completar fluido y verificar sin burbujas", order: 4 },
    { serviceId: frenos!.id, description: "Prueba de palanca y sensación", order: 5 },
  ]);

  // Ajuste transmisión
  const [transmision] = await db.insert(servicesTable).values({
    name: "Ajuste transmisión",
    categoryId: catMap["Transmisión"],
    basePrice: "20000",
    estimatedHours: "0.5",
    clientDescription: "Ajuste y calibración del sistema de cambios.",
    internalDescription: "Ajuste de derailleur, cables y limitadores.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: transmision!.id, description: "Revisión visual de cables, fundas y derailleur", order: 0 },
    { serviceId: transmision!.id, description: "Ajuste de limitadores H y L", order: 1 },
    { serviceId: transmision!.id, description: "Tensión de cable y ajuste fino de barrel adjuster", order: 2 },
    { serviceId: transmision!.id, description: "Prueba en todas las relaciones", order: 3 },
  ]);

  // Mantención general
  const [mantencion] = await db.insert(servicesTable).values({
    name: "Mantención general",
    categoryId: catMap["Mantención general"],
    basePrice: "60000",
    estimatedHours: "2.5",
    clientDescription: "Revisión y ajuste completo de todos los sistemas de la bicicleta.",
    internalDescription: "Revisión integral: frenos, cambios, llantas, rodamientos y estado general.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: mantencion!.id, description: "Revisión visual general del estado de la bicicleta", order: 0 },
    { serviceId: mantencion!.id, description: "Limpieza completa", order: 1 },
    { serviceId: mantencion!.id, description: "Revisión y ajuste de frenos", order: 2 },
    { serviceId: mantencion!.id, description: "Revisión y ajuste de transmisión", order: 3 },
    { serviceId: mantencion!.id, description: "Revisión de llantas y neumáticos", order: 4 },
    { serviceId: mantencion!.id, description: "Revisión de rodamientos (pedalier, headset)", order: 5 },
    { serviceId: mantencion!.id, description: "Lubricación de cadena y puntos móviles", order: 6 },
    { serviceId: mantencion!.id, description: "Revisión de torques críticos", order: 7 },
    { serviceId: mantencion!.id, description: "Informe al cliente y entrega", order: 8 },
  ]);

  // Servicio cuadro/pivotes
  const [cuadro] = await db.insert(servicesTable).values({
    name: "Servicio cuadro/pivotes",
    categoryId: catMap["Cuadro"],
    basePrice: "70000",
    estimatedHours: "3.0",
    clientDescription: "Limpieza y re-engrase de todos los pivotes del cuadro de suspensión.",
    internalDescription: "Desmontaje de links, limpieza de rodamientos, re-engrase y armado.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: cuadro!.id, description: "Fotografiar estado inicial del cuadro", order: 0 },
    { serviceId: cuadro!.id, description: "Desmontaje del shock trasero", order: 1 },
    { serviceId: cuadro!.id, description: "Desmontaje de linkages y pivotes", order: 2 },
    { serviceId: cuadro!.id, description: "Limpieza de rodamientos y ejes", order: 3 },
    { serviceId: cuadro!.id, description: "Revisión de estado de rodamientos (reemplazar si necesario)", order: 4 },
    { serviceId: cuadro!.id, description: "Re-engrase con grasa apropiada", order: 5 },
    { serviceId: cuadro!.id, description: "Armado de linkages con torque correcto", order: 6 },
    { serviceId: cuadro!.id, description: "Reinstalación del shock", order: 7 },
    { serviceId: cuadro!.id, description: "Prueba de movimiento del cuadro", order: 8 },
  ]);

  // Diagnóstico
  const [diagnostico] = await db.insert(servicesTable).values({
    name: "Diagnóstico",
    categoryId: catMap["Diagnóstico"],
    basePrice: "15000",
    estimatedHours: "0.5",
    clientDescription: "Evaluación del estado de la bicicleta para identificar problemas.",
    internalDescription: "Inspección y diagnóstico previo a presupuesto.",
  }).returning();

  await db.insert(serviceStepsTable).values([
    { serviceId: diagnostico!.id, description: "Revisión visual de todos los sistemas", order: 0 },
    { serviceId: diagnostico!.id, description: "Prueba de rodado y detección de ruidos", order: 1 },
    { serviceId: diagnostico!.id, description: "Registro de hallazgos", order: 2 },
    { serviceId: diagnostico!.id, description: "Elaborar informe y presupuesto", order: 3 },
  ]);

  // ── REPUESTOS ─────────────────────────────────────────────────────────────
  console.log("  Creando repuestos de muestra...");
  await db.insert(partsTable).values([
    { name: "Aceite de baño Fox (120ml)", categoryId: catMap["Suspensión"], brand: "Fox", suggestedPrice: "8500", sku: "FOX-BATH-120" },
    { name: "Kit de sellos Fox 36 2021+", categoryId: catMap["Suspensión"], brand: "Fox", suggestedPrice: "18000", sku: "FOX-SEAL-36" },
    { name: "Pastillas freno Shimano BR-MT200", categoryId: catMap["Frenos"], brand: "Shimano", suggestedPrice: "9500", sku: "SHI-B01S" },
    { name: "Cable de cambio Shimano (pack x2)", categoryId: catMap["Transmisión"], brand: "Shimano", suggestedPrice: "4500", sku: "SHI-CABLE-X2" },
    { name: "Funda de cable cambio (metro)", categoryId: catMap["Transmisión"], brand: "Genérico", suggestedPrice: "1500", sku: null },
    { name: "Grasa de pivotes (100g)", categoryId: catMap["Cuadro"], brand: "Finish Line", suggestedPrice: "7000", sku: "FL-GREASE-100" },
    { name: "Aceite DOT 4 Shimano (100ml)", categoryId: catMap["Frenos"], brand: "Shimano", suggestedPrice: "5500", sku: "SHI-DOT4-100" },
    { name: "Cadena Shimano SLX 12v", categoryId: catMap["Transmisión"], brand: "Shimano", suggestedPrice: "28000", sku: "SHI-CN-M7100" },
  ]);

  // ── PRESUPUESTOS ──────────────────────────────────────────────────────────
  console.log("  Creando presupuestos de muestra...");
  const [existingQuotes] = await db.select({ n: count() }).from(quotesTable);
  if (Number(existingQuotes?.n) === 0) {
    const allUsers = await db.select().from(usersTable);
    const adminUser = allUsers.find(u => u.email === "admin@taller.com");
    const adminId = adminUser?.id ?? null;

    const allClients = await db.select().from(clientsTable);
    const pedro = allClients.find(c => c.name === "Pedro González")!;
    const maria = allClients.find(c => c.name === "María Soto")!;
    const andres = allClients.find(c => c.name === "Andrés Rojas")!;

    const allBikes = await db.select().from(bicyclesTable);
    const trekSlash = allBikes.find(b => b.clientId === pedro.id && b.brand === "Trek");
    const stumpjumper = allBikes.find(b => b.clientId === maria.id && b.brand === "Specialized");

    const allSvcs = await db.select().from(servicesTable);
    const svcMap: Record<string, number> = {};
    for (const s of allSvcs) svcMap[s.name] = s.id;

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
      { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Servicio horquilla", quantity: "1", unitPrice: "85000", total: "85000", estimatedLaborHours: "2.0", approvalStatus: "pending", serviceId: svcMap["Servicio horquilla"] ?? null, sortOrder: 1, active: true },
      { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Servicio shock", quantity: "1", unitPrice: "75000", total: "75000", estimatedLaborHours: "1.5", approvalStatus: "pending", serviceId: svcMap["Servicio shock"] ?? null, sortOrder: 2, active: true },
      { quoteId: q1.id, itemType: "service", origin: "customer_request", description: "Sangrado frenos", quantity: "1", unitPrice: "25000", total: "25000", estimatedLaborHours: "0.75", approvalStatus: "pending", serviceId: svcMap["Sangrado frenos"] ?? null, sortOrder: 3, active: true },
    ]);

    await db.insert(quoteVersionsTable).values({
      quoteId: q1.id, versionNumber: 1, status: "sent",
      subtotal: "185000", discountTotal: "0", total: "185000", estimatedLaborHours: "4.25",
      itemsSnapshot: [{ description: "Servicio horquilla", unitPrice: 85000 }, { description: "Servicio shock", unitPrice: 75000 }, { description: "Sangrado frenos", unitPrice: 25000 }],
      sentAt: new Date("2026-06-28T10:00:00Z"),
    });
    await db.insert(timelineEventsTable).values([
      { entityType: "quote", entityId: q1.id, userId: adminId, action: "quote_created", newStatus: "draft" },
      { entityType: "quote", entityId: q1.id, userId: adminId, action: "quote_sent", previousStatus: "draft", newStatus: "sent" },
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
      { quoteId: q2.id, itemType: "service", origin: "customer_request", description: "Mantención general", quantity: "1", unitPrice: "60000", total: "60000", estimatedLaborHours: "2.5", approvalStatus: "pending", serviceId: svcMap["Mantención general"] ?? null, sortOrder: 1, active: true },
      { quoteId: q2.id, itemType: "service", origin: "customer_request", description: "Ajuste transmisión", quantity: "1", unitPrice: "20000", total: "20000", estimatedLaborHours: "0.5", approvalStatus: "pending", serviceId: svcMap["Ajuste transmisión"] ?? null, sortOrder: 2, active: true },
    ]);
    await db.insert(timelineEventsTable).values([
      { entityType: "quote", entityId: q2.id, userId: adminId, action: "quote_created", newStatus: "draft" },
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
      { quoteId: q3.id, itemType: "diagnosis", origin: "customer_request", description: "Diagnóstico general de la bicicleta", quantity: "1", unitPrice: "15000", total: "15000", estimatedLaborHours: "0.5", approvalStatus: "approved", serviceId: svcMap["Diagnóstico"] ?? null, sortOrder: 1, active: true },
      { quoteId: q3.id, itemType: "service", origin: "mechanic_recommendation", description: "Servicio cuadro/pivotes", quantity: "1", unitPrice: "70000", total: "70000", estimatedLaborHours: "3.0", approvalStatus: "pending", serviceId: svcMap["Servicio cuadro/pivotes"] ?? null, sortOrder: 2, active: true },
    ]);
    await db.insert(quoteVersionsTable).values({
      quoteId: q3.id, versionNumber: 1, status: "sent",
      subtotal: "85000", discountTotal: "0", total: "85000", estimatedLaborHours: "3.5",
      itemsSnapshot: [{ description: "Diagnóstico general", unitPrice: 15000 }, { description: "Servicio cuadro/pivotes", unitPrice: 70000 }],
      sentAt: new Date("2026-07-01T09:00:00Z"),
    });
    await db.insert(timelineEventsTable).values([
      { entityType: "quote", entityId: q3.id, userId: adminId, action: "quote_created", newStatus: "draft" },
      { entityType: "quote", entityId: q3.id, userId: adminId, action: "quote_sent", previousStatus: "draft", newStatus: "sent" },
      { entityType: "quote", entityId: q3.id, userId: adminId, action: "item_approved", comment: "Diagnóstico aprobado por cliente" },
      { entityType: "quote", entityId: q3.id, userId: adminId, action: "quote_partially_approved", previousStatus: "sent", newStatus: "partially_approved" },
    ]);
  }

  // ── RECEPCIONES ───────────────────────────────────────────────────────────
  console.log("  Creando recepciones de muestra...");
  const [existingReceptions] = await db.select({ n: count() }).from(receptionsTable);
  if (Number(existingReceptions?.n) === 0) {
    const allUsers2 = await db.select().from(usersTable);
    const adminUser2 = allUsers2.find(u => u.email === "admin@taller.com");
    const mechanicJuan = allUsers2.find(u => u.email === "juan@taller.com");
    const adminId2 = adminUser2?.id ?? null;

    const allClients2 = await db.select().from(clientsTable);
    const pedro2 = allClients2.find(c => c.name === "Pedro González")!;
    const maria2 = allClients2.find(c => c.name === "María Soto")!;
    const andres2 = allClients2.find(c => c.name === "Andrés Rojas")!;

    const allBikes2 = await db.select().from(bicyclesTable);
    const trekSlash2 = allBikes2.find(b => b.clientId === pedro2.id && b.brand === "Trek");
    const stumpjumper2 = allBikes2.find(b => b.clientId === maria2.id && b.brand === "Specialized");
    const giantReign = allBikes2.find(b => b.clientId === andres2.id && b.brand === "Giant");

    const allQuotes2 = await db.select().from(quotesTable);
    const q1 = allQuotes2.find(q => q.quoteNumber === "P-0001");
    const q2 = allQuotes2.find(q => q.quoteNumber === "P-0002");

    // R-0001: Pedro / Trek Slash / P-0001 / in_inspection + hallazgo pastillas freno
    const [r1] = await db.insert(receptionsTable).values({
      receptionNumber: "R-0001",
      clientId: pedro2.id,
      bicycleId: trekSlash2!.id,
      quoteId: q1?.id ?? null,
      receivedByUserId: adminId2,
      receivedAt: new Date("2026-06-28T09:30:00Z"),
      customerReportedProblem: "La horquilla está dura y los frenos chirrían al frenar fuerte. Quiere revisión completa antes de la temporada.",
      initialVisualCondition: "Bicicleta en buen estado general. Presenta desgaste en pastillas freno delantero. Horquilla con acumulación de polvo en retenes.",
      accessoriesReceived: ["Candado", "Bolso de sillín"],
      internalNotes: "Presupuesto P-0001 ya enviado al cliente. Iniciar inspección para confirmar trabajos.",
      status: "in_inspection",
    }).returning();

    await db.insert(timelineEventsTable).values([
      { entityType: "reception", entityId: r1.id, userId: adminId2, action: "reception_created", newStatus: "received" },
      { entityType: "reception", entityId: r1.id, userId: adminId2, action: "inspection_started", previousStatus: "received", newStatus: "in_inspection" },
    ]);

    // Hallazgo R-0001: pastillas freno gastadas
    await db.insert(inspectionFindingsTable).values({
      receptionId: r1.id,
      quoteId: q1?.id ?? null,
      mechanicId: mechanicJuan?.id ?? null,
      area: "Frenos",
      severity: "high",
      finding: "Pastillas de freno delantero con desgaste crítico. Quedan menos de 1mm de material de fricción.",
      recommendation: "Reemplazar pastillas freno delantero inmediatamente. Revisar disco por posible daño.",
      shouldCreateQuoteItem: true,
      itemType: "part",
      quoteItemDescription: "Pastillas freno Shimano BR-MT200 (reemplazo urgente)",
      quantity: "1",
      unitPrice: "9500",
    });

    // R-0002: María / Stumpjumper / P-0002 / received / accesorios
    const [r2] = await db.insert(receptionsTable).values({
      receptionNumber: "R-0002",
      clientId: maria2.id,
      bicycleId: stumpjumper2!.id,
      quoteId: q2?.id ?? null,
      receivedByUserId: adminId2,
      receivedAt: new Date("2026-07-01T10:00:00Z"),
      customerReportedProblem: "Mantención anual. Los cambios a veces saltan y quiere la bici lista para el verano.",
      initialVisualCondition: "Bicicleta en buen estado. Cadena con algo de suciedad. Derailleur trasero con pequeño golpe en la jaula.",
      accessoriesReceived: ["Porta caramayola", "Pedales Shimano"],
      customerNotes: "Cliente solicita que le avisen por WhatsApp cuando esté lista.",
      status: "received",
    }).returning();

    await db.insert(timelineEventsTable).values([
      { entityType: "reception", entityId: r2.id, userId: adminId2, action: "reception_created", newStatus: "received" },
    ]);

    // R-0003: Andrés / Giant Reign / sin presupuesto / inspection_completed + hallazgo transmisión
    const [r3] = await db.insert(receptionsTable).values({
      receptionNumber: "R-0003",
      clientId: andres2.id,
      bicycleId: giantReign!.id,
      quoteId: null,
      receivedByUserId: adminId2,
      receivedAt: new Date("2026-07-02T14:00:00Z"),
      customerReportedProblem: "La transmisión hace ruidos y saltó la cadena dos veces la semana pasada. También quiere revisar el shock trasero.",
      initialVisualCondition: "Bicicleta con signos de uso intenso. Cadena muy sucia con juego lateral. Shock trasero con leve fuga de aceite.",
      accessoriesReceived: null,
      internalNotes: "Inspección completada por Juan. Hay que generar presupuesto con los hallazgos.",
      status: "inspection_completed",
    }).returning();

    await db.insert(timelineEventsTable).values([
      { entityType: "reception", entityId: r3.id, userId: adminId2, action: "reception_created", newStatus: "received" },
      { entityType: "reception", entityId: r3.id, userId: mechanicJuan?.id ?? null, action: "inspection_started", previousStatus: "received", newStatus: "in_inspection" },
      { entityType: "reception", entityId: r3.id, userId: mechanicJuan?.id ?? null, action: "inspection_completed", previousStatus: "in_inspection", newStatus: "inspection_completed" },
    ]);

    // Hallazgos R-0003
    await db.insert(inspectionFindingsTable).values([
      {
        receptionId: r3.id,
        quoteId: null,
        mechanicId: mechanicJuan?.id ?? null,
        area: "Transmisión",
        severity: "critical",
        finding: "Cadena con desgaste avanzado (>0.75% stretch). Muela del cassette con dientes ganchudos.",
        recommendation: "Reemplazar cadena y cassette en conjunto. No reemplazar uno sin el otro.",
        shouldCreateQuoteItem: true,
        itemType: "part",
        quoteItemDescription: "Cadena Shimano SLX 12v + Cassette (reemplazo conjunto urgente)",
        quantity: "1",
        unitPrice: "55000",
      },
      {
        receptionId: r3.id,
        quoteId: null,
        mechanicId: mechanicJuan?.id ?? null,
        area: "Suspensión trasera",
        severity: "medium",
        finding: "Shock Fox DPS con fuga leve de aceite en la zona del cuerpo. Funciona pero requiere servicio pronto.",
        recommendation: "Servicio de shock en las próximas 2-3 semanas. No es urgente pero sí necesario.",
        shouldCreateQuoteItem: true,
        itemType: "service",
        quoteItemDescription: "Servicio shock Fox DPS",
        quantity: "1",
        unitPrice: "75000",
        estimatedLaborHours: "1.5",
      },
    ]);
  }

  console.log("✅ Seed completado exitosamente.");
  console.log("");
  console.log("⚠️  CREDENCIALES DEMO — SOLO DESARROLLO:");
  console.log("   admin@taller.com   / admin123");
  console.log("   juan@taller.com    / juan123");
  console.log("   diego@taller.com   / diego123");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});
