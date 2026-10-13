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
