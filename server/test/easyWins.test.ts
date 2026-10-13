import { describe, it, expect } from "vitest";
import type { Task } from "@prisma/client";
import {
  DEFAULT_EASY_WIN_MINUTES,
  formatEasyWinsSummary,
  rankEasyWins,
} from "../src/lib/assistant/easyWins.js";
import { fallbackPlanFromText } from "../src/lib/assistant/executor.js";

function fakeTask(title: string, overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? title,
    userId: "u1",
    bucketId: null,
    goalId: null,
    title,
    notes: null,
    origin: "manual",
    status: "active",
    attentionDate: null,
    plannedWindowStart: null,
    plannedWindowEnd: null,
    hardDeadline: null,
    deadlineSource: null,
    estimateMinutes: null,
    estimateConfidence: null,
    actualMinutes: null,
    importance: "medium",
    waitingOn: null,
    recurrenceRuleId: null,
    snoozedUntil: null,
    completedAt: null,
    droppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("rankEasyWins", () => {
  it("keeps short tasks inside the budget and drops long ones", () => {
    const wins = rankEasyWins(
      [
        fakeTask("Email vendor", { estimateMinutes: 5 }),
        fakeTask("Rewrite homepage", { estimateMinutes: 120 }),
        fakeTask("Water plant", { estimateMinutes: 10 }),
      ],
      25,
    );
    expect(wins.map((w) => w.title)).toEqual(["Email vendor", "Water plant"]);
  });

  it("skips snoozed, waiting-on, and non-open tasks", () => {
    const wins = rankEasyWins(
      [
        fakeTask("Done already", { status: "completed", estimateMinutes: 5 }),
        fakeTask("Blocked", { waitingOn: "Sam", estimateMinutes: 5 }),
        fakeTask("Later", {
          estimateMinutes: 5,
          snoozedUntil: new Date(Date.now() + 60_000),
        }),
        fakeTask("Doable", { estimateMinutes: 5 }),
      ],
      25,
    );
    expect(wins.map((w) => w.title)).toEqual(["Doable"]);
  });

  it("assumes 15m for unknown estimates and still ranks them", () => {
    const wins = rankEasyWins([fakeTask("No estimate")], 25);
    expect(wins).toHaveLength(1);
    expect(wins[0].assumedMinutes).toBe(15);
    expect(wins[0].estimateMinutes).toBeNull();
  });

  it("prefers shorter + high-importance quick hits", () => {
    const wins = rankEasyWins(
      [
        fakeTask("Big medium", { estimateMinutes: 20, importance: "medium" }),
        fakeTask("Tiny high", { estimateMinutes: 5, importance: "high" }),
      ],
      25,
    );
    expect(wins[0].title).toBe("Tiny high");
  });

  it("defaults budget to DEFAULT_EASY_WIN_MINUTES", () => {
    expect(DEFAULT_EASY_WIN_MINUTES).toBe(25);
    const wins = rankEasyWins([fakeTask("Fits", { estimateMinutes: 25 })]);
    expect(wins).toHaveLength(1);
  });
});

describe("formatEasyWinsSummary", () => {
  it("handles empty and non-empty lists", () => {
    expect(formatEasyWinsSummary([], 25)).toMatch(/No easy wins/);
    const summary = formatEasyWinsSummary(
      [
        {
          id: "1",
          title: "Call dentist",
          estimateMinutes: 10,
          importance: "medium",
          status: "active",
          score: 90,
          assumedMinutes: 10,
        },
      ],
      25,
    );
    expect(summary).toContain("Easy wins for ~25 minutes");
    expect(summary).toContain("Call dentist");
  });
});

describe("fallbackPlanFromText", () => {
  it("routes easy-wins phrasing without creating a task", () => {
    const plan = fallbackPlanFromText("I have 20 minutes — any easy wins?");
    expect(plan.actions).toEqual([{ type: "easy_wins", minutes: 20 }]);
  });

  it("routes what's on today to list", () => {
    const plan = fallbackPlanFromText("what's on today?");
    expect(plan.actions).toEqual([{ type: "list", scope: "today" }]);
  });

  it("still captures plain text as create_tasks", () => {
    const plan = fallbackPlanFromText("buy oat milk");
    expect(plan.actions[0]?.type).toBe("create_tasks");
  });
});
