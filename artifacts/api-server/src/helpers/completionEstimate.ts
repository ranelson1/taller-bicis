import { db } from "@workspace/db";
import { usersTable, workOrdersTable, reservationsTable } from "@workspace/db";
import { eq, and, inArray, ne } from "drizzle-orm";
import { getWorkshopSettings, lunchOf } from "./settings";
import { netHoursOn, remainingNetHoursToday } from "./schedule";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Estimación de las fechas de un trabajo según la carga actual del taller.
//
// Carga = horas que faltan de las OT abiertas (las del mecánico asignado o, si no hay,
// las de todo el taller) + las reservas que llegan antes que este trabajo + las horas del trabajo.
// Capacidad de cada día = horas netas del horario del taller (sin colación) × la fracción
// de la semana que trabaja cada mecánico (sus horas semanales / horas netas del taller).
// Se consume día a día desde ahora —incluido lo que queda de hoy— en orden de llegada (el que llega
// después no atrasa al que llegó antes). `arrival` es el día en que llega la bici (por defecto, hoy).

// Una OT sin horas estimadas igual ocupa tiempo del taller.
export const MIN_JOB_HOURS = 1;
// Tope de búsqueda: un año de días.
const MAX_DAYS = 366;

const OPEN_STATUSES = ["ready_to_work", "in_progress", "quality_control"] as const;

export type CompletionEstimate = {
  /** Día estimado de término (entrega). */
  date: Date;
  /** Día en que el taller puede empezar a trabajar en esta bici (≥ llegada). */
  startDate: Date;
  backlogHours: number;
  jobHours: number;
  dailyCapacityHours: number;
  workdays: number;
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const noonOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12, 0, 0, 0); };

export async function estimateCompletionDate(
  exec: Tx | typeof db,
  opts: { laborHours: number; mechanicId?: number | null; excludeWorkOrderId?: number; arrival?: Date; excludeReservationId?: number },
  from: Date = new Date(),
): Promise<CompletionEstimate> {
  const settings = await getWorkshopSettings(exec);
  const lunch = lunchOf(settings);
  const shopWeekly = settings.weeklyNetHours;

  const mechanics = await exec.select({ id: usersTable.id, weeklyHours: usersTable.weeklyHours })
    .from(usersTable)
    .where(and(eq(usersTable.doesJobs, true), eq(usersTable.active, true)));

  // Fracción del horario del taller que cubre cada mecánico (sin horas semanales = jornada completa).
  const share = (weeklyHours: number | null) =>
    weeklyHours && weeklyHours > 0 && shopWeekly > 0 ? Math.min(1, weeklyHours / shopWeekly) : 1;
  const assigned = opts.mechanicId ? mechanics.find(m => m.id === opts.mechanicId) : undefined;
  const people = assigned ? share(assigned.weeklyHours) : mechanics.length > 0 ? mechanics.reduce((s, m) => s + share(m.weeklyHours), 0) : 1;

  const openOrders = await exec.select({
    id: workOrdersTable.id,
    mechanicId: workOrdersTable.mechanicId,
    estimatedLaborHours: workOrdersTable.estimatedLaborHours,
    progressPercentage: workOrdersTable.progressPercentage,
  })
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.active, true), inArray(workOrdersTable.status, [...OPEN_STATUSES])));

  const backlogHours = openOrders
    .filter(o => o.id !== opts.excludeWorkOrderId && (!assigned || o.mechanicId === assigned.id))
    .reduce((s, o) => {
      const hours = Math.max(Number(o.estimatedLaborHours ?? 0), MIN_JOB_HOURS);
      const progress = Math.min(Math.max(Number(o.progressPercentage ?? 0), 0), 100);
      return s + hours * (1 - progress / 100);
    }, 0);

  // Reservas que todavía no llegan: ocupan el taller desde el día en que llegan.
  const reservations = (await exec.select({
    id: reservationsTable.id, expectedOn: reservationsTable.expectedOn, estimatedHours: reservationsTable.estimatedHours,
  }).from(reservationsTable).where(and(
    eq(reservationsTable.status, "reserved"),
    opts.excludeReservationId ? ne(reservationsTable.id, opts.excludeReservationId) : undefined,
  ))).map(r => ({ id: r.id, on: r.expectedOn, hours: Math.max(Number(r.estimatedHours ?? 0), MIN_JOB_HOURS) }));

  const jobHours = Math.max(opts.laborHours, MIN_JOB_HOURS);
  const todayKey = ymd(from);
  const arrivalKey = opts.arrival && ymd(opts.arrival) > todayKey ? ymd(opts.arrival) : todayKey;

  // Solo cuentan las reservas que llegan antes (o el mismo día pero se reservaron antes): el orden de llegada manda.
  const self = opts.excludeReservationId ?? null;
  const ahead = reservations.filter(r => r.on < arrivalKey || (r.on === arrivalKey && (self == null || r.id < self)));
  // Las atrasadas o de hoy ya están en la cola desde el inicio.
  let pending = backlogHours + ahead.filter(r => r.on <= todayKey).reduce((s, r) => s + r.hours, 0);
  let targetAdded = false;
  let aheadRemaining = 0;
  let startDate: Date | null = null;

  // Mediodía local: la fecha no cambia al pasar a UTC ni al mostrarla.
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  let workdays = 0;
  let endDate = new Date(date);
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = ymd(date);
    if (i > 0) pending += ahead.filter(r => r.on === key).reduce((s, r) => s + r.hours, 0);
    if (!targetAdded && key === arrivalKey) {
      aheadRemaining = pending;
      pending += jobHours;
      targetAdded = true;
    }
    const capacity = (i === 0 ? remainingNetHoursToday(from, settings.schedule, lunch) : netHoursOn(date, settings.schedule, lunch)) * people;
    if (capacity > 0) {
      if (!targetAdded) {
        pending = Math.max(0, pending - capacity);
      } else {
        workdays++;
        if (!startDate) {
          if (aheadRemaining < capacity - 1e-9) startDate = new Date(date);
          else aheadRemaining -= capacity;
        }
        pending -= capacity;
        if (pending <= 1e-9) { endDate = new Date(date); break; }
      }
    }
    endDate = new Date(date);
    date.setDate(date.getDate() + 1);
  }

  const openDays = settings.schedule.length || 1;
  return {
    date: endDate, startDate: startDate ?? noonOf(arrivalKey), backlogHours, jobHours,
    dailyCapacityHours: (shopWeekly / openDays) * people, workdays,
  };
}
