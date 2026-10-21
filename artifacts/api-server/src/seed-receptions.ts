import { db } from "@workspace/db";
import {
  receptionsTable,
  inspectionFindingsTable,
  clientsTable,
  bicyclesTable,
  quotesTable,
  usersTable,
  timelineEventsTable,
} from "@workspace/db";
import { count } from "drizzle-orm";

async function seedReceptions() {
  const [existing] = await db.select({ n: count() }).from(receptionsTable);
  if (Number(existing?.n) > 0) {
    console.log(`Recepciones ya existen (${existing?.n}). Omitiendo.`);
    process.exit(0);
  }

  const allClients = await db.select().from(clientsTable);
  const pedro = allClients.find(c => c.name === "Pedro González")!;
  const maria = allClients.find(c => c.name === "María Soto")!;
  const andres = allClients.find(c => c.name === "Andrés Rojas")!;

  const allBikes = await db.select().from(bicyclesTable);
  const trekSlash = allBikes.find(b => b.clientId === pedro.id && b.brand === "Trek")!;
  const stumpjumper = allBikes.find(b => b.clientId === maria.id && b.brand === "Specialized")!;
  const giantReign = allBikes.find(b => b.clientId === andres.id && b.brand === "Giant")!;

  const allUsers = await db.select().from(usersTable);
  const admin = allUsers.find(u => u.email === "admin@taller.com");
  const juan = allUsers.find(u => u.email === "juan@taller.com");

  const allQuotes = await db.select().from(quotesTable);
  const q1 = allQuotes.find(q => q.quoteNumber === "P-0001");
  const q2 = allQuotes.find(q => q.quoteNumber === "P-0002");

  // R-0001: Pedro / Trek Slash / P-0001 / in_inspection
  const [r1] = await db.insert(receptionsTable).values({
    receptionNumber: "R-0001",
    clientId: pedro.id,
    bicycleId: trekSlash.id,
    quoteId: q1?.id ?? null,
    receivedByUserId: admin?.id ?? null,
    receivedAt: new Date("2026-06-28T09:30:00Z"),
    customerReportedProblem: "La horquilla está dura y los frenos chirrían al frenar fuerte. Quiere revisión completa antes de la temporada.",
    initialVisualCondition: "Bicicleta en buen estado general. Presenta desgaste en pastillas freno delantero. Horquilla con acumulación de polvo en retenes.",
    accessoriesReceived: ["Candado", "Bolso de sillín"],
    internalNotes: "Presupuesto P-0001 ya enviado al cliente. Iniciar inspección para confirmar trabajos.",
    status: "in_inspection",
  }).returning();

  await db.insert(timelineEventsTable).values([
    { entityType: "reception", entityId: r1.id, userId: admin?.id ?? null, action: "reception_created", newStatus: "received" },
    { entityType: "reception", entityId: r1.id, userId: admin?.id ?? null, action: "inspection_started", previousStatus: "received", newStatus: "in_inspection" },
  ]);

  await db.insert(inspectionFindingsTable).values({
    receptionId: r1.id,
    quoteId: q1?.id ?? null,
    mechanicId: juan?.id ?? null,
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

  // R-0002: María / Stumpjumper / P-0002 / received
  const [r2] = await db.insert(receptionsTable).values({
    receptionNumber: "R-0002",
    clientId: maria.id,
    bicycleId: stumpjumper.id,
    quoteId: q2?.id ?? null,
    receivedByUserId: admin?.id ?? null,
    receivedAt: new Date("2026-07-01T10:00:00Z"),
    customerReportedProblem: "Mantención anual. Los cambios a veces saltan y quiere la bici lista para el verano.",
    initialVisualCondition: "Bicicleta en buen estado. Cadena con algo de suciedad. Derailleur trasero con pequeño golpe en la jaula.",
    accessoriesReceived: ["Porta caramayola", "Pedales Shimano"],
    customerNotes: "Cliente solicita que le avisen por WhatsApp cuando esté lista.",
    status: "received",
  }).returning();

  await db.insert(timelineEventsTable).values([
    { entityType: "reception", entityId: r2.id, userId: admin?.id ?? null, action: "reception_created", newStatus: "received" },
  ]);

  // R-0003: Andrés / Giant Reign / inspection_completed
  const [r3] = await db.insert(receptionsTable).values({
    receptionNumber: "R-0003",
    clientId: andres.id,
    bicycleId: giantReign.id,
    quoteId: null,
    receivedByUserId: admin?.id ?? null,
    receivedAt: new Date("2026-07-02T14:00:00Z"),
    customerReportedProblem: "La transmisión hace ruidos y saltó la cadena dos veces la semana pasada. También quiere revisar el shock trasero.",
    initialVisualCondition: "Bicicleta con signos de uso intenso. Cadena muy sucia con juego lateral. Shock trasero con leve fuga de aceite.",
    internalNotes: "Inspección completada por Juan. Hay que generar presupuesto con los hallazgos.",
    status: "inspection_completed",
  }).returning();

  await db.insert(timelineEventsTable).values([
    { entityType: "reception", entityId: r3.id, userId: admin?.id ?? null, action: "reception_created", newStatus: "received" },
    { entityType: "reception", entityId: r3.id, userId: juan?.id ?? null, action: "inspection_started", previousStatus: "received", newStatus: "in_inspection" },
    { entityType: "reception", entityId: r3.id, userId: juan?.id ?? null, action: "inspection_completed", previousStatus: "in_inspection", newStatus: "inspection_completed" },
  ]);

  await db.insert(inspectionFindingsTable).values([
    {
      receptionId: r3.id,
      quoteId: null,
      mechanicId: juan?.id ?? null,
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
      mechanicId: juan?.id ?? null,
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

  console.log("✅ Recepciones creadas: R-0001, R-0002, R-0003");
  process.exit(0);
}

seedReceptions().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
