import { describe, expect, it } from "vitest";
import { classifyDateString, classifyInstant, endOfNextCalendarWeek, horizonWindows } from "../src/lib/horizons.js";

describe("horizon windows", () => {
  const windows = horizonWindows("2026-11-24", "UTC", 0);

  it("covers today, tomorrow, and through the end of next calendar week", () => {
    expect(windows.tomorrowISO).toBe("2026-11-25");
    expect(windows.nextWeekStartISO).toBe("2026-11-26");
    expect(endOfNextCalendarWeek("2026-11-24", 0)).toBe("2026-12-05");
    expect(windows.nextWeekEndISO).toBe("2026-12-05");
  });

  it("sends past and far dates to Later", () => {
    expect(classifyInstant(new Date("2026-11-23T15:00:00.000Z"), windows)).toBe("later");
    expect(classifyInstant(new Date("2026-11-24T15:00:00.000Z"), windows)).toBe("today");
    expect(classifyInstant(new Date("2026-11-25T15:00:00.000Z"), windows)).toBe("tomorrow");
    expect(classifyInstant(new Date("2026-11-28T15:00:00.000Z"), windows)).toBe("nextWeek");
    expect(classifyInstant(new Date("2026-12-05T15:00:00.000Z"), windows)).toBe("nextWeek");
    expect(classifyInstant(new Date("2026-12-06T15:00:00.000Z"), windows)).toBe("later");
    expect(classifyInstant(null, windows)).toBe("later");
  });

  it("classifies occurrence calendar days the same way", () => {
    expect(classifyDateString("2026-11-24", windows)).toBe("today");
    expect(classifyDateString("2026-12-20", windows)).toBe("later");
  });
});
