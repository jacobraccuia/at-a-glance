// Pragmatic timezone helpers for Phase 1.
// Resolve local calendar midnights via Intl formatToParts + iterative
// correction (the old toLocaleString→Date parse path was wrong whenever
// the machine's zone ≠ the target zone — UTC "today" ended at 20:00 UTC
// on an America/New_York host, which broke Tonight views + tests).

export function getCurrentDateInTimeZone(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // "YYYY-MM-DD"
}

/** Weekday name (e.g. "Tuesday") for a YYYY-MM-DD date string, timezone-agnostic
 *  since the date string is already a resolved local calendar date. */
export function getWeekdayName(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
}

/**
 * Map of weekday name → days-from-today for the soonest strictly-future
 * occurrence of that weekday. Used by the intent parser so the LLM never
 * has to compute day-of-week offsets itself (LLMs are unreliable at that;
 * verified twice in Phase 2 smoke tests -- "next Friday" on a Tuesday
 * silently resolved to the Friday of *next* week instead of this week's).
 *
 * "This Friday" and "next Friday" both map to the same soonest upcoming
 * Friday under this table; the linguistic distinction is too ambiguous
 * cross-speaker to ask the model to resolve, so we pick the conservative
 * (soonest) interpretation for both.
 *
 * Example: if today is Tuesday, returns
 *   { Wednesday: 1, Thursday: 2, Friday: 3, Saturday: 4, Sunday: 5,
 *     Monday: 6, Tuesday: 7 }.
 */
export function getUpcomingWeekdayOffsets(dateStr: string): Record<string, number> {
  const todayName = getWeekdayName(dateStr);
  const order = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayIdx = order.indexOf(todayName);
  const offsets: Record<string, number> = {};
  for (let i = 1; i <= 7; i++) {
    offsets[order[(todayIdx + i) % 7]] = i;
  }
  return offsets;
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localPartsInTimeZone(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour") === 24 ? 0 : num("hour"),
    minute: num("minute"),
    second: num("second"),
  };
}

/** Start of the given local calendar date (YYYY-MM-DD) in tz, as a UTC Date instant. */
export function startOfDayInTimeZone(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Desired wall-clock reading in the target zone.
  const desiredAsUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // First guess: that same Y-M-D as if it were UTC.
  let guess = desiredAsUtcMs;
  for (let i = 0; i < 4; i++) {
    const local = localPartsInTimeZone(new Date(guess), tz);
    const localAsUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const delta = localAsUtcMs - desiredAsUtcMs;
    if (delta === 0) break;
    guess -= delta;
  }
  return new Date(guess);
}

/** End of the given local calendar date (inclusive, i.e. 23:59:59.999 local) in tz, as UTC Date. */
export function endOfDayInTimeZone(dateStr: string, tz: string): Date {
  const start = startOfDayInTimeZone(dateStr, tz);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}
