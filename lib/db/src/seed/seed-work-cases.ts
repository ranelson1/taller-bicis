/**
 * Backfill script: creates work_cases (TR-XXXX) for all existing quotes,
 * receptions, and work orders that don't already have a workCaseId.
 * Idempotent: skips entities that already have workCaseId set.
 * Before creating a new TR, checks all related documents for an existing TR
 * to reuse, preventing duplicate TRs for the same service flow.
 */
import { db } from "../index";
import {
  workCasesTable,
  quotesTable,
  receptionsTable,
  workOrdersTable,
} from "../schema";
import { eq, isNull, and, isNotNull } from "drizzle-orm";

async function nextWorkCaseNumber(count: number): Promise<string> {
  return `TR-${String(count).padStart(4, "0")}`;
}

/** Reuse existing TR from a related document if available */
async function findRelatedWorkCaseId(
  quoteId: number | null,
  receptionId: number | null,
  workOrderId: number | null,
): Promise<number | null> {
  if (quoteId) {
    const [q] = await db.select({ workCaseId: quotesTable.workCaseId }).from(quotesTable).where(eq(quotesTable.id, quoteId));
    if (q?.workCaseId) return q.workCaseId;
  }
  if (receptionId) {
    const [r] = await db.select({ workCaseId: receptionsTable.workCaseId }).from(receptionsTable).where(eq(receptionsTable.id, receptionId));
    if (r?.workCaseId) return r.workCaseId;
  }
  if (workOrderId) {
    const [wo] = await db.select({ workCaseId: workOrdersTable.workCaseId }).from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
    if (wo?.workCaseId) return wo.workCaseId;
  }
  return null;
}

async function run() {
  console.log("Starting work-cases backfill...");

  let counter = 1;

  // --- Group 1: Quotes without a work case ---
  const quotes = await db.select().from(quotesTable)
    .where(and(eq(quotesTable.active, true), isNull(quotesTable.workCaseId)));

  console.log(`Found ${quotes.length} quotes without work case`);

  for (const quote of quotes) {
    // Before creating a new TR, check linked receptions/work-orders for an existing one
    const linkedRecsForReuse = await db.select({ workCaseId: receptionsTable.workCaseId })
      .from(receptionsTable)
      .where(and(eq(receptionsTable.quoteId, quote.id), isNotNull(receptionsTable.workCaseId)));
    const reuseFromRec = linkedRecsForReuse[0]?.workCaseId ?? null;
    if (reuseFromRec) {
      await db.update(quotesTable)
        .set({ workCaseId: reuseFromRec, updatedAt: new Date() })
        .where(eq(quotesTable.id, quote.id));
      console.log(`  Reused TR id=${reuseFromRec} for quote ${quote.quoteNumber} (from linked reception)`);
      continue;
    }

    const linkedWOsForReuse = await db.select({ workCaseId: workOrdersTable.workCaseId })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quote.id), isNotNull(workOrdersTable.workCaseId)));
    const reuseFromWO = linkedWOsForReuse[0]?.workCaseId ?? null;
    if (reuseFromWO) {
      await db.update(quotesTable)
        .set({ workCaseId: reuseFromWO, updatedAt: new Date() })
        .where(eq(quotesTable.id, quote.id));
      console.log(`  Reused TR id=${reuseFromWO} for quote ${quote.quoteNumber} (from linked work order)`);
      continue;
    }

    const wcNumber = await nextWorkCaseNumber(counter++);

    const qStatusMap: Record<string, string> = {
      draft: "lead",
      sent: "quote_sent",
      updated_after_sent: "quote_sent",
      approved: "quote_approved",
      partially_approved: "quote_approved",
      ready_for_work_order: "ready_for_work_order",
      converted_to_work_order: "in_work_order",
      rejected: "cancelled",
    };
    const status = qStatusMap[quote.status] ?? "lead";

    const [wc] = await db.insert(workCasesTable).values({
      workCaseNumber: wcNumber,
      clientId: quote.clientId,
      bicycleId: quote.bicycleId ?? null,
      status: status as any,
      originChannel: quote.originChannel ?? null,
      initialRequirement: quote.initialRequirement ?? null,
      totalEstimatedAmount: quote.total ?? null,
      totalEstimatedLaborHours: quote.estimatedLaborHours ?? null,
    }).returning();

    await db.update(quotesTable)
      .set({ workCaseId: wc.id, updatedAt: new Date() })
      .where(eq(quotesTable.id, quote.id));
    console.log(`  Created ${wcNumber} (id=${wc.id}) for quote ${quote.quoteNumber}`);

    // Link reception(s) linked to this quote (reuse same TR)
    const linkedReceptions = await db.select().from(receptionsTable)
      .where(and(eq(receptionsTable.quoteId, quote.id), isNull(receptionsTable.workCaseId)));
    for (const rec of linkedReceptions) {
      await db.update(receptionsTable)
        .set({ workCaseId: wc.id, updatedAt: new Date() })
        .where(eq(receptionsTable.id, rec.id));
      console.log(`    Linked reception ${rec.receptionNumber} to ${wcNumber}`);

      if (rec.workOrderId) {
        const [wo] = await db.select().from(workOrdersTable)
          .where(and(eq(workOrdersTable.id, rec.workOrderId), isNull(workOrdersTable.workCaseId)));
        if (wo) {
          await db.update(workOrdersTable)
            .set({ workCaseId: wc.id, updatedAt: new Date() })
            .where(eq(workOrdersTable.id, wo.id));
          console.log(`    Linked work order ${wo.workOrderNumber} to ${wcNumber} (via reception)`);
        }
      }
    }

    // Link work order(s) directly linked to this quote
    const linkedWOs = await db.select().from(workOrdersTable)
      .where(and(eq(workOrdersTable.quoteId, quote.id), isNull(workOrdersTable.workCaseId)));
    for (const wo of linkedWOs) {
      await db.update(workOrdersTable)
        .set({ workCaseId: wc.id, updatedAt: new Date() })
        .where(eq(workOrdersTable.id, wo.id));
      console.log(`    Linked work order ${wo.workOrderNumber} to ${wcNumber} (via quote)`);
    }
  }

  // --- Group 2: Receptions without a work case (not yet covered by Group 1) ---
  const orphanReceptions = await db.select().from(receptionsTable)
    .where(and(eq(receptionsTable.active, true), isNull(receptionsTable.workCaseId)));

  console.log(`Found ${orphanReceptions.length} receptions without work case`);

  for (const rec of orphanReceptions) {
    // Before creating a new TR, check if linked quote already has one
    const existingWcId = await findRelatedWorkCaseId(rec.quoteId ?? null, null, rec.workOrderId ?? null);
    if (existingWcId) {
      await db.update(receptionsTable)
        .set({ workCaseId: existingWcId, updatedAt: new Date() })
        .where(eq(receptionsTable.id, rec.id));
      console.log(`  Linked reception ${rec.receptionNumber} to existing TR id=${existingWcId}`);
      continue;
    }

    const wcNumber = await nextWorkCaseNumber(counter++);
    const recStatusMap: Record<string, string> = {
      received: "bike_received",
      in_inspection: "in_inspection",
      inspection_completed: "in_inspection",
      waiting_quote_approval: "quote_sent",
      ready_for_work_order: "ready_for_work_order",
      cancelled: "cancelled",
    };
    const status = recStatusMap[rec.status] ?? "bike_received";

    const [wc] = await db.insert(workCasesTable).values({
      workCaseNumber: wcNumber,
      clientId: rec.clientId,
      bicycleId: rec.bicycleId ?? null,
      status: status as any,
    }).returning();

    await db.update(receptionsTable)
      .set({ workCaseId: wc.id, updatedAt: new Date() })
      .where(eq(receptionsTable.id, rec.id));
    console.log(`  Created ${wcNumber} (id=${wc.id}) for reception ${rec.receptionNumber}`);

    if (rec.workOrderId) {
      const [wo] = await db.select().from(workOrdersTable)
        .where(and(eq(workOrdersTable.id, rec.workOrderId), isNull(workOrdersTable.workCaseId)));
      if (wo) {
        await db.update(workOrdersTable)
          .set({ workCaseId: wc.id, updatedAt: new Date() })
          .where(eq(workOrdersTable.id, wo.id));
        console.log(`    Linked work order ${wo.workOrderNumber} to ${wcNumber}`);
      }
    }
  }

  // --- Group 3: Work orders without a work case (not yet covered above) ---
  const orphanWOs = await db.select().from(workOrdersTable)
    .where(and(eq(workOrdersTable.active, true), isNull(workOrdersTable.workCaseId)));

  console.log(`Found ${orphanWOs.length} work orders without work case`);

  for (const wo of orphanWOs) {
    // Before creating a new TR, check if linked quote or reception already has one
    const existingWcId = await findRelatedWorkCaseId(wo.quoteId ?? null, wo.receptionId ?? null, null);
    if (existingWcId) {
      await db.update(workOrdersTable)
        .set({ workCaseId: existingWcId, updatedAt: new Date() })
        .where(eq(workOrdersTable.id, wo.id));
      console.log(`  Linked work order ${wo.workOrderNumber} to existing TR id=${existingWcId}`);
      continue;
    }

    const wcNumber = await nextWorkCaseNumber(counter++);
    const woStatusMap: Record<string, string> = {
      ready_to_work: "in_work_order",
      in_progress: "in_progress",
      quality_control: "quality_control",
      ready_for_pickup: "ready_for_pickup",
      delivered: "delivered",
      cancelled: "cancelled",
    };
    const status = woStatusMap[wo.status] ?? "in_work_order";

    const [wc] = await db.insert(workCasesTable).values({
      workCaseNumber: wcNumber,
      clientId: wo.clientId,
      bicycleId: wo.bicycleId ?? null,
      status: status as any,
      assignedMechanicId: wo.mechanicId ?? null,
      totalEstimatedAmount: wo.total ?? null,
      totalEstimatedLaborHours: wo.estimatedLaborHours ?? null,
      progressPercentage: wo.progressPercentage ?? null,
    }).returning();

    await db.update(workOrdersTable)
      .set({ workCaseId: wc.id, updatedAt: new Date() })
      .where(eq(workOrdersTable.id, wo.id));
    console.log(`  Created ${wcNumber} (id=${wc.id}) for work order ${wo.workOrderNumber}`);
  }

  console.log(`\nBackfill complete. Created ${counter - 1} work cases.`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
