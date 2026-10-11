import { describe, it, expect } from "vitest";
import { generateOccurrenceDates } from "../src/lib/recurrence.js";

describe("generateOccurrenceDates", () => {
  it("generates consecutive daily dates within range", () => {
    const dates = generateOccurrenceDates(
      { frequency: "daily", interval: 1, startDate: "2026-01-01" },
      "2026-01-01",
      "2026-01-05"
    );
    expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  it("respects daily interval > 1", () => {
    const dates = generateOccurrenceDates(
      { frequency: "daily", interval: 2, startDate: "2026-01-01" },
      "2026-01-01",
      "2026-01-08"
    );
    expect(dates).toEqual(["2026-01-01", "2026-01-03", "2026-01-05", "2026-01-07"]);
  });

  it("never produces a date before the rule start date even if range starts earlier", () => {
    const dates = generateOccurrenceDates(
      { frequency: "daily", interval: 1, startDate: "2026-01-10" },
      "2026-01-01",
      "2026-01-12"
    );
    expect(dates).toEqual(["2026-01-10", "2026-01-11", "2026-01-12"]);
  });

  it("respects rule endDate (inclusive)", () => {
    const dates = generateOccurrenceDates(
      { frequency: "daily", interval: 1, startDate: "2026-01-01", endDate: "2026-01-03" },
      "2026-01-01",
      "2026-01-10"
    );
    expect(dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("generates weekly occurrences on specified weekdays (e.g. every Monday)", () => {
    // 2026-01-01 is a Thursday. Monday=1.
    const dates = generateOccurrenceDates(
      { frequency: "weekly", interval: 1, byWeekday: [1], startDate: "2026-01-01" },
      "2026-01-01",
      "2026-01-31"
    );
    // Mondays in Jan 2026: 5, 12, 19, 26
    expect(dates).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
  });

  it("respects weekly interval > 1 (every other week)", () => {
    const dates = generateOccurrenceDates(
      { frequency: "weekly", interval: 2, byWeekday: [1], startDate: "2026-01-01" },
      "2026-01-01",
      "2026-02-28"
    );
    // Rule-start week is the week of 2025-12-28 (Sun) .. 2026-01-03 (Sat), index 0.
    // Every-other-week Mondays starting from that week: Dec 29(wk0, before start, excluded), then wk2 = Jan 12, wk4 = Jan 26, wk6 = Feb 9, wk8 = Feb 23
    expect(dates).toEqual(["2026-01-12", "2026-01-26", "2026-02-09", "2026-02-23"]);
  });

  it("generates monthly occurrences on the given day-of-month", () => {
    const dates = generateOccurrenceDates(
      { frequency: "monthly", interval: 1, byMonthday: 15, startDate: "2026-01-15" },
      "2026-01-01",
      "2026-04-30"
    );
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("clamps monthly day-of-month to the last day of short months", () => {
    const dates = generateOccurrenceDates(
      { frequency: "monthly", interval: 1, byMonthday: 31, startDate: "2026-01-31" },
      "2026-01-01",
      "2026-04-30"
    );
    // Jan 31, Feb has no 31st -> clamp to 28 (2026 not leap), Mar 31, Apr has no 31 -> clamp to 30
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("returns an empty array when the window is entirely before the rule start", () => {
    const dates = generateOccurrenceDates(
      { frequency: "daily", interval: 1, startDate: "2026-05-01" },
      "2026-01-01",
      "2026-04-30"
    );
    expect(dates).toEqual([]);
  });
});
