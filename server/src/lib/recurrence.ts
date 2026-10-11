// Pure, deterministic recurrence occurrence generation.
// Dates are handled as plain calendar dates (no time component) to avoid
// DST shifting which day an occurrence belongs to. All inputs/outputs use
// "YYYY-MM-DD" strings computed via UTC-safe date math.

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurrenceRuleInput {
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekday?: number[] | null; // 0=Sun..6=Sat, for weekly
  byMonthday?: number | null; // for monthly
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD, inclusive
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Generate occurrence dates for a recurrence rule within [rangeStart, rangeEnd]
 * (inclusive), also respecting the rule's own startDate/endDate bounds.
 */
export function generateOccurrenceDates(
  rule: RecurrenceRuleInput,
  rangeStart: string,
  rangeEnd: string
): string[] {
  const interval = Math.max(1, rule.interval || 1);
  const ruleStart = parseDate(rule.startDate);
  const ruleEnd = rule.endDate ? parseDate(rule.endDate) : null;
  const windowStart = parseDate(rangeStart);
  const windowEnd = parseDate(rangeEnd);

  const effectiveStart = windowStart > ruleStart ? windowStart : ruleStart;
  const effectiveEnd = ruleEnd && ruleEnd < windowEnd ? ruleEnd : windowEnd;

  if (effectiveStart > effectiveEnd) return [];

  const results: string[] = [];

  if (rule.frequency === "daily") {
    // Days since ruleStart must be a multiple of interval.
    let cursor = ruleStart;
    while (cursor <= effectiveEnd) {
      if (cursor >= effectiveStart) {
        results.push(formatDate(cursor));
      }
      cursor = addDays(cursor, interval);
    }
    return results;
  }

  if (rule.frequency === "weekly") {
    const weekdays = rule.byWeekday && rule.byWeekday.length > 0 ? rule.byWeekday : [ruleStart.getUTCDay()];
    // Walk week-by-week from ruleStart's week, respecting interval in weeks.
    const ruleWeekStart = addDays(ruleStart, -ruleStart.getUTCDay()); // Sunday of rule start's week
    let weekCursor = ruleWeekStart;
    let weekIndex = 0;
    while (weekCursor <= effectiveEnd) {
      if (weekIndex % interval === 0) {
        for (const wd of weekdays) {
          const occ = addDays(weekCursor, wd);
          if (occ >= ruleStart && occ >= effectiveStart && occ <= effectiveEnd) {
            if (!ruleEnd || occ <= ruleEnd) {
              results.push(formatDate(occ));
            }
          }
        }
      }
      weekCursor = addDays(weekCursor, 7);
      weekIndex++;
    }
    results.sort();
    return results;
  }

  // monthly
  const monthday = rule.byMonthday ?? ruleStart.getUTCDate();
  let cursor = new Date(Date.UTC(ruleStart.getUTCFullYear(), ruleStart.getUTCMonth(), 1));
  let monthIndex = 0;
  while (cursor <= effectiveEnd) {
    if (monthIndex % interval === 0) {
      const daysInMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
      const day = Math.min(monthday, daysInMonth);
      const occ = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), day));
      if (occ >= ruleStart && occ >= effectiveStart && occ <= effectiveEnd && (!ruleEnd || occ <= ruleEnd)) {
        results.push(formatDate(occ));
      }
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    monthIndex++;
  }
  return results;
}
