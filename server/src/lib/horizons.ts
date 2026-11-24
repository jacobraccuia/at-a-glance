// Where an open task lives. Attention wins over a deadline. A missing date,
// a past date, or a date after next calendar week is Later — still listed,
// not treated as overnight debt on Today.
import { addDaysToDateString, endOfDayInTimeZone, startOfDayInTimeZone } from "./timezone.js";

export type HorizonName = "today" | "tomorrow" | "nextWeek" | "later";

export interface HorizonWindows {
  todayISO: string;
  tomorrowISO: string;
  nextWeekStartISO: string;
  nextWeekEndISO: string;
  todayStart: Date;
  todayEnd: Date;
  tomorrowStart: Date;
  tomorrowEnd: Date;
  nextWeekStart: Date;
  nextWeekEnd: Date;
}

/** Last day of the calendar week after the one that contains todayISO. weekStartsOn: 0=Sun. */
export function endOfNextCalendarWeek(todayISO: string, weekStartsOn: number): string {
  const [y, m, d] = todayISO.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = ((weekStartsOn % 7) + 7) % 7;
  const daysFromWeekStart = (weekday - start + 7) % 7;
  const thisWeekStart = addDaysToDateString(todayISO, -daysFromWeekStart);
  return addDaysToDateString(thisWeekStart, 13);
}

export function horizonWindows(todayISO: string, tz: string, weekStartsOn = 0): HorizonWindows {
  const tomorrowISO = addDaysToDateString(todayISO, 1);
  const nextWeekStartISO = addDaysToDateString(todayISO, 2);
  let nextWeekEndISO = endOfNextCalendarWeek(todayISO, weekStartsOn);
  if (nextWeekEndISO < nextWeekStartISO) nextWeekEndISO = nextWeekStartISO;
  return {
    todayISO,
    tomorrowISO,
    nextWeekStartISO,
    nextWeekEndISO,
    todayStart: startOfDayInTimeZone(todayISO, tz),
    todayEnd: endOfDayInTimeZone(todayISO, tz),
    tomorrowStart: startOfDayInTimeZone(tomorrowISO, tz),
    tomorrowEnd: endOfDayInTimeZone(tomorrowISO, tz),
    nextWeekStart: startOfDayInTimeZone(nextWeekStartISO, tz),
    nextWeekEnd: endOfDayInTimeZone(nextWeekEndISO, tz),
  };
}

export function attentionInstant(horizon: Exclude<HorizonName, "later">, windows: HorizonWindows): Date {
  if (horizon === "today") return windows.todayStart;
  if (horizon === "tomorrow") return windows.tomorrowStart;
  return windows.nextWeekStart;
}

export function effectiveInstant(task: {
  attentionDate?: Date | null;
  hardDeadline?: Date | null;
}): Date | null {
  return task.attentionDate ?? task.hardDeadline ?? null;
}

export function classifyInstant(date: Date | null | undefined, windows: HorizonWindows): HorizonName {
  if (!date) return "later";
  const t = date.getTime();
  if (t >= windows.todayStart.getTime() && t <= windows.todayEnd.getTime()) return "today";
  if (t >= windows.tomorrowStart.getTime() && t <= windows.tomorrowEnd.getTime()) return "tomorrow";
  if (t >= windows.nextWeekStart.getTime() && t <= windows.nextWeekEnd.getTime()) return "nextWeek";
  return "later";
}

export function classifyTask(
  task: { attentionDate?: Date | null; hardDeadline?: Date | null },
  windows: HorizonWindows
): HorizonName {
  return classifyInstant(effectiveInstant(task), windows);
}

/** occurrenceDate is a calendar day stored at UTC midnight. Compare the date string, not the instant. */
export function classifyDateString(dateISO: string, windows: HorizonWindows): HorizonName {
  if (dateISO === windows.todayISO) return "today";
  if (dateISO === windows.tomorrowISO) return "tomorrow";
  if (dateISO >= windows.nextWeekStartISO && dateISO <= windows.nextWeekEndISO) return "nextWeek";
  return "later";
}

export function horizonLabel(name: HorizonName): string {
  if (name === "today") return "Today";
  if (name === "tomorrow") return "Tomorrow";
  if (name === "nextWeek") return "Next week";
  return "Later";
}
