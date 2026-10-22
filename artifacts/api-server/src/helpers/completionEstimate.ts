import { db } from "@workspace/db";
import { usersTable, workOrdersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getWorkshopSettings, lunchOf } from "./settings";
import { netHoursOn, remainingNetHoursToday } from "./schedule";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Estimación de la fecha de término de una OT según la carga actual del taller.
//
// Carga = horas que faltan de las OT abiertas (las del mecánico asignado o, si no hay,
// las de todo el taller) + las horas de la OT nueva.
// Capacidad de cada día = horas netas del horario del taller (sin colación) × la fracción
// de la semana que trabaja cada mecánico (sus horas semanales / horas netas del taller).
// Se consume día a día desde ahora —incluido lo que queda de hoy— hasta agotar la carga.

// Una OT sin horas estimadas igual ocupa tiempo del taller.
export const MIN_JOB_HOURS = 1;
// Tope de búsqueda: un año de días.
const MAX_DAYS = 366;

const OPEN_STATUSES = ["ready_to_work", "in_progress", "quality_control"] as const;

export type CompletionEstimate = {
  date: Date;
  backlogHours: number;
  jobHours: number;
  dailyCapacityHours: number;
  workdays: number;
};

export async function estimateCompletionDate(
  exec: Tx | typeof db,
  opts: { laborHours: number; mechanicId?: number | null; excludeWorkOrderId?: number },
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

  const jobHours = Math.max(opts.laborHours, MIN_JOB_HOURS);
  let pending = backlogHours + jobHours;

  // Mediodía local: la fecha no cambia al pasar a UTC ni al mostrarla.
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  let workdays = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const capacity = (i === 0 ? remainingNetHoursToday(from, settings.schedule, lunch) : netHoursOn(date, settings.schedule, lunch)) * people;
    if (capacity > 0) {
      workdays++;
      pending -= capacity;
      if (pending <= 1e-9) break;
    }
    date.setDate(date.getDate() + 1);
  }

  const openDays = settings.schedule.length || 1;
  return { date, backlogHours, jobHours, dailyCapacityHours: (shopWeekly / openDays) * people, workdays };
}
