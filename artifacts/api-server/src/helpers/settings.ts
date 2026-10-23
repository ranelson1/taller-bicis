import { db, workshopSettingsTable, workshopsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_LUNCH, netHours, weeklyNetHours, type Lunch, type ScheduleDay } from "./schedule";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Datos del taller: lo guardado en Configuración y, si falta, las variables de entorno.

export function parseWorkdays(value: string | null | undefined): number[] {
  const days = (value ?? "").split(",").map(d => d.trim()).filter(d => d !== "")
    .map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length > 0 ? [...new Set(days)].sort() : [1, 2, 3, 4, 5];
}

export async function getWorkshopSettings(exec: Tx | typeof db = db) {
  // Fila del taller de la conexión actual (RLS ya la limita; el filtro lo deja explícito).
  const [row] = await exec.select().from(workshopSettingsTable).where(eq(workshopSettingsTable.workshopId, sql`current_workshop_id()`));
  const [workshop] = await exec.select({ id: workshopsTable.id, name: workshopsTable.name }).from(workshopsTable).where(eq(workshopsTable.id, sql`current_workshop_id()`));

  // Sin horario guardado: días de `workdays` de 10:00 a 19:00 con colación por defecto.
  const configured = Array.isArray(row?.schedule) && row.schedule.length > 0;
  const schedule: ScheduleDay[] = configured
    ? [...row!.schedule!].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))
    : parseWorkdays(row?.workdays).map(day => ({ day, open: "10:00", close: "19:00" }));
  const lunch: Lunch = configured
    ? (row?.lunchStart && row?.lunchEnd ? { start: row.lunchStart, end: row.lunchEnd } : null)
    : DEFAULT_LUNCH;

  return {
    name: row?.name?.trim() || workshop?.name || "Taller",
    phone: row?.phone?.trim() || null,
    address: row?.address?.trim() || null,
    schedule: schedule.map(d => ({ ...d, netHours: netHours(d, lunch) })),
    lunchStart: lunch?.start ?? null,
    lunchEnd: lunch?.end ?? null,
    workdays: schedule.map(d => d.day),
    weeklyNetHours: weeklyNetHours(schedule, lunch),
    // Costos (para márgenes).
    monthlyFixedCosts: num(row?.monthlyFixedCosts),
    monthlySalary: num(row?.monthlySalary),
    monthlyWorkHours: num(row?.monthlyWorkHours),
    laborCostPerHour: num(row?.laborCostPerHour),
    defaultPartsMarginPct: num(row?.defaultPartsMarginPct) ?? 30,
    recoversVat: row?.recoversVat ?? false,
    // El logo se sirve sin login (sale en el link del cliente); `v` cambia al subir uno nuevo.
    logoUrl: row?.logoKey && workshop ? logoUrl(workshop.id, row.logoKey) : null,
  };
}

const num = (v: string | null | undefined) => (v == null ? null : Number(v));

export const logoUrl = (workshopId: number, key: string) =>
  `/api/public/workshops/${workshopId}/logo?v=${key.split("/").pop()!.slice(0, 8)}`;

export type WorkshopSettingsView = Awaited<ReturnType<typeof getWorkshopSettings>>;

export const lunchOf = (s: WorkshopSettingsView): Lunch =>
  s.lunchStart && s.lunchEnd ? { start: s.lunchStart, end: s.lunchEnd } : null;
