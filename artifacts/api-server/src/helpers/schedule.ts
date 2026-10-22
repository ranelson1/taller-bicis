// Horario del taller: cuántas horas netas se trabaja cada día (descontando la colación).

export type ScheduleDay = { day: number; open: string; close: string };
export type Lunch = { start: string; end: string } | null;

// Por defecto: lunes a viernes de 10:00 a 19:00 con colación de 14:00 a 15:00 (8 h netas).
export const DEFAULT_SCHEDULE: ScheduleDay[] = [1, 2, 3, 4, 5].map(day => ({ day, open: "10:00", close: "19:00" }));
export const DEFAULT_LUNCH: Lunch = { start: "14:00", end: "15:00" };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTime = (s: string) => TIME.test(s);
export const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// Minutos trabajados entre `from` y `to` (minutos del día) dentro del horario, sin la colación.
function workedMinutes(day: ScheduleDay, lunch: Lunch, from: number, to: number): number {
  const start = Math.max(from, toMinutes(day.open));
  const end = Math.min(to, toMinutes(day.close));
  if (end <= start) return 0;
  const lunchOverlap = lunch ? overlap(start, end, toMinutes(lunch.start), toMinutes(lunch.end)) : 0;
  return end - start - lunchOverlap;
}

export function netHours(day: ScheduleDay, lunch: Lunch): number {
  return workedMinutes(day, lunch, 0, 24 * 60) / 60;
}

export function weeklyNetHours(schedule: ScheduleDay[], lunch: Lunch): number {
  return schedule.reduce((s, d) => s + netHours(d, lunch), 0);
}

// Horas netas de un día de calendario (0 si el taller no abre).
export function netHoursOn(date: Date, schedule: ScheduleDay[], lunch: Lunch): number {
  const day = schedule.find(d => d.day === date.getDay());
  return day ? netHours(day, lunch) : 0;
}

// Horas netas que le quedan al día desde `now` (0 si ya cerró o no abre).
export function remainingNetHoursToday(now: Date, schedule: ScheduleDay[], lunch: Lunch): number {
  const day = schedule.find(d => d.day === now.getDay());
  if (!day) return 0;
  return workedMinutes(day, lunch, now.getHours() * 60 + now.getMinutes(), 24 * 60) / 60;
}

// Valida un horario recibido desde la app. Devuelve el mensaje de error o null.
export function validateSchedule(schedule: ScheduleDay[], lunch: Lunch): string | null {
  if (schedule.length === 0) return "El taller debe abrir al menos un día";
  const days = new Set<number>();
  for (const d of schedule) {
    if (!Number.isInteger(d.day) || d.day < 0 || d.day > 6 || days.has(d.day)) return "Día inválido o repetido";
    days.add(d.day);
    if (!isTime(d.open) || !isTime(d.close)) return "Usa horas en formato HH:MM";
    if (toMinutes(d.close) <= toMinutes(d.open)) return "La hora de cierre debe ser posterior a la de apertura";
  }
  if (lunch) {
    if (!isTime(lunch.start) || !isTime(lunch.end)) return "Usa horas en formato HH:MM";
    if (toMinutes(lunch.end) <= toMinutes(lunch.start)) return "El fin de la colación debe ser posterior al inicio";
  }
  if (weeklyNetHours(schedule, lunch) <= 0) return "El horario no deja horas de trabajo";
  return null;
}
