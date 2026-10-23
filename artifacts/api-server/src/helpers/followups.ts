import { and, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import {
  db, workOrdersTable, workOrderItemsTable, servicesTable, bicyclesTable, clientsTable, reservationsTable, followupSnoozesTable,
} from "@workspace/db";

// Recontacto: a qué clientes conviene escribirles porque ya les toca repetir un servicio.
// Para cada bicicleta y servicio se mira la última vez que se entregó; vence a los N meses.

const OPEN_STATUSES = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"] as const;
// Se avisa un poco antes de que venza, y se deja de insistir pasado un tiempo largo.
export const LEAD_DAYS = 14;
const LOOKBACK_MONTHS = 30;
export const DEFAULT_SNOOZE_DAYS = 30;

// Meses sugeridos según el nombre del servicio, cuando el taller no definió uno. null = no se recuerda.
export function suggestedMonths(name: string): number | null {
  const n = name.toLowerCase();
  if (/(instalaci|montaje|ajuste|diagn|armado|reparaci|cambio de|centrado|revisi)/.test(n)) return null;
  if (/(horquilla|shock|suspens|amortigu|dropper|lower)/.test(n)) return 6;
  if (/(mantenci)/.test(n)) return 6;
  if (/(freno|sangrado|purga)/.test(n)) return 12;
  if (/(direcci|pivote|pedalier|buje|rodamiento|motor)/.test(n)) return 12;
  return null;
}

export const monthsFor = (name: string, configured: number | null | undefined): number | null =>
  configured == null ? suggestedMonths(name) : configured > 0 ? configured : null;

const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthsBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / (30.44 * 86_400_000)));

export type FollowupItem = {
  serviceId: number; serviceName: string; bicycleId: number; bicycleName: string;
  lastOn: string; dueOn: string; monthsAgo: number; overdueDays: number;
};
export type FollowupClient = {
  clientId: number; clientName: string; clientPhone: string | null; items: FollowupItem[]; mostOverdueDays: number;
};

export async function listFollowups(now: Date = new Date()): Promise<FollowupClient[]> {
  const since = addMonths(now, -LOOKBACK_MONTHS);
  const rows = await db.select({
    clientId: workOrdersTable.clientId, bicycleId: workOrdersTable.bicycleId, deliveredAt: workOrdersTable.deliveredAt,
    serviceId: workOrderItemsTable.serviceId, serviceName: servicesTable.name, followupMonths: servicesTable.followupMonths,
    brand: bicyclesTable.brand, model: bicyclesTable.model, clientName: clientsTable.name, clientPhone: clientsTable.phone,
  })
    .from(workOrdersTable)
    .innerJoin(workOrderItemsTable, eq(workOrderItemsTable.workOrderId, workOrdersTable.id))
    .innerJoin(servicesTable, eq(servicesTable.id, workOrderItemsTable.serviceId))
    .innerJoin(bicyclesTable, eq(bicyclesTable.id, workOrdersTable.bicycleId))
    .innerJoin(clientsTable, eq(clientsTable.id, workOrdersTable.clientId))
    .where(and(
      eq(workOrdersTable.status, "delivered"), eq(workOrdersTable.active, true), isNotNull(workOrdersTable.deliveredAt),
      gte(workOrdersTable.deliveredAt, since),
      eq(workOrderItemsTable.active, true), eq(workOrderItemsTable.approvalStatus, "approved"), ne(workOrderItemsTable.status, "cancelled"),
      eq(clientsTable.active, true),
    ));

  // Última entrega de cada servicio en cada bicicleta.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.bicycleId}:${r.serviceId}`;
    const prev = latest.get(key);
    if (!prev || r.deliveredAt! > prev.deliveredAt!) latest.set(key, r);
  }

  // No se molesta a quien ya tiene la bici en el taller, una reserva pendiente o a quien ya se le escribió hace poco.
  const busy = new Set<number>([
    ...(await db.select({ id: workOrdersTable.clientId }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.active, true), inArray(workOrdersTable.status, [...OPEN_STATUSES])))).map(r => r.id),
    ...(await db.select({ id: reservationsTable.clientId }).from(reservationsTable)
      .where(and(eq(reservationsTable.status, "reserved"), isNotNull(reservationsTable.clientId)))).map(r => r.id!),
    ...(await db.select({ id: followupSnoozesTable.clientId }).from(followupSnoozesTable)
      .where(gte(followupSnoozesTable.untilOn, ymd(now)))).map(r => r.id),
  ]);

  const horizon = new Date(now); horizon.setDate(horizon.getDate() + LEAD_DAYS);
  const byClient = new Map<number, FollowupClient>();
  for (const r of latest.values()) {
    const months = monthsFor(r.serviceName, r.followupMonths);
    if (!months || busy.has(r.clientId)) continue;
    const due = addMonths(r.deliveredAt!, months);
    if (due > horizon) continue;
    const overdueDays = Math.round((now.getTime() - due.getTime()) / 86_400_000);
    const item: FollowupItem = {
      serviceId: r.serviceId!, serviceName: r.serviceName, bicycleId: r.bicycleId, bicycleName: `${r.brand} ${r.model}`,
      lastOn: ymd(r.deliveredAt!), dueOn: ymd(due), monthsAgo: monthsBetween(r.deliveredAt!, now), overdueDays,
    };
    const c = byClient.get(r.clientId) ?? { clientId: r.clientId, clientName: r.clientName, clientPhone: r.clientPhone, items: [], mostOverdueDays: -9999 };
    c.items.push(item);
    c.mostOverdueDays = Math.max(c.mostOverdueDays, overdueDays);
    byClient.set(r.clientId, c);
  }
  return [...byClient.values()]
    .map(c => ({ ...c, items: c.items.sort((a, b) => b.overdueDays - a.overdueDays) }))
    .sort((a, b) => b.mostOverdueDays - a.mostOverdueDays);
}
