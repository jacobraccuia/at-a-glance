import { describe, it, expect } from "vitest";
import { resolveTaskQuery } from "../src/lib/assistant/executor.js";
import type { Task } from "@prisma/client";

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

describe("resolveTaskQuery", () => {
  const tasks = [
    fakeTask("Plan the drop party"),
    fakeTask("Drop off the UPS package"),
    fakeTask("Call Mom"),
  ];

  it("resolves a clear partial match", () => {
    const match = resolveTaskQuery("drop party", tasks);
    expect(match?.title).toBe("Plan the drop party");
  });

  it("resolves an exact title", () => {
    const match = resolveTaskQuery("Call Mom", tasks);
    expect(match?.title).toBe("Call Mom");
  });

  it("returns null when nothing matches", () => {
    expect(resolveTaskQuery("buy groceries", tasks)).toBeNull();
  });

  it("returns null when two tasks match equally well (ambiguous)", () => {
    // Both titles contain "drop" as a strong token -- force ambiguity.
    const ambiguous = [fakeTask("Drop party invite"), fakeTask("Drop party cleanup")];
    expect(resolveTaskQuery("drop party", ambiguous)).toBeNull();
  });
});
