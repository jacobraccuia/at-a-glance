import { describe, it, expect } from "vitest";
import {
  dateAtMinutes,
  endOfDayInTimeZone,
  getCurrentDateInTimeZone,
  startOfDayInTimeZone,
} from "../src/lib/timezone.js";

describe("startOfDayInTimeZone / endOfDayInTimeZone", () => {
  it("UTC midnight is exact", () => {
    const start = startOfDayInTimeZone("2026-10-13", "UTC");
    const end = endOfDayInTimeZone("2026-10-13", "UTC");
    expect(start.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-13T23:59:59.999Z");
  });

  it("America/New_York (EDT, UTC-4) midnight maps to 04:00Z", () => {
    const start = startOfDayInTimeZone("2026-10-13", "America/New_York");
    expect(start.toISOString()).toBe("2026-10-13T04:00:00.000Z");
    const end = endOfDayInTimeZone("2026-10-13", "America/New_York");
    expect(end.toISOString()).toBe("2026-10-14T03:59:59.999Z");
  });

  it("keeps a named clock time on that calendar day", () => {
    const atThree = dateAtMinutes("2026-10-13", "America/New_York", 15 * 60);
    expect(atThree.toISOString()).toBe("2026-10-13T19:00:00.000Z");
  });

  it("late-evening UTC now still falls inside UTC today", () => {
    // Regression: broken helper ended UTC "today" at ~20:00Z on EDT hosts.
    const now = new Date("2026-10-13T22:30:00.000Z");
    const today = getCurrentDateInTimeZone("UTC", now);
    expect(today).toBe("2026-10-13");
    const start = startOfDayInTimeZone(today, "UTC");
    const end = endOfDayInTimeZone(today, "UTC");
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});
