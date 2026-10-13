// Pragmatic timezone helpers for Phase 1. Uses the standard
// "format in target zone, diff against UTC interpretation" technique.
// Known limitation: can be off by up to an hour in the rare case a DST
// transition happens exactly at local midnight for the zone in question.
// Acceptable for Phase 1 "today/upcoming" windowing; revisit with a proper
// tz library (e.g. date-fns-tz / Luxon) if this becomes a real pain point.

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

/** Start of the given local calendar date (YYYY-MM-DD) in tz, as a UTC Date instant. */
export function startOfDayInTimeZone(dateStr: string, tz: string): Date {
  const guessUtc = new Date(`${dateStr}T00:00:00Z`);
  const asLocalString = guessUtc.toLocaleString("en-US", { timeZone: tz });
  const reinterpreted = new Date(asLocalString);
  const offsetMs = guessUtc.getTime() - reinterpreted.getTime();
  return new Date(guessUtc.getTime() + offsetMs);
}

/** End of the given local calendar date (inclusive, i.e. 23:59:59.999 local) in tz, as UTC Date. */
export function endOfDayInTimeZone(dateStr: string, tz: string): Date {
  const start = startOfDayInTimeZone(dateStr, tz);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}
