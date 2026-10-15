import { describe, it, expect } from "vitest";
import { fallbackPlanFromText, resolveTaskQuery, sanitizeAssistantPlan, toSpokenLine } from "../src/lib/assistant/executor.js";
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

describe("sanitizeAssistantPlan", () => {
  it("drops mutations when a clarify is also present", () => {
    const plan = sanitizeAssistantPlan({
      reply: "Want me to add it?",
      spoken: "Want me to add it?",
      actions: [
        { type: "clarify", question: "Create a new task for Call Gastro?" },
        {
          type: "create_tasks",
          items: [
            {
              cleanTitle: "Call Gastro",
              bucketName: null,
              importance: null,
              estimateMinutes: null,
              waitingOn: null,
              dateKind: "none",
              dateDaysFromNow: null,
            },
          ],
        },
      ],
    });
    expect(plan.actions).toEqual([{ type: "clarify", question: "Create a new task for Call Gastro?" }]);
    expect(plan.reply).toBe("Create a new task for Call Gastro?");
  });

  it("rewrites permission-seeking reply when create already ran", () => {
    const plan = sanitizeAssistantPlan({
      reply: "I couldn't find that. Would you like me to create a new task for that?",
      spoken: "Want me to add that?",
      actions: [
        {
          type: "create_tasks",
          items: [
            {
              cleanTitle: "Call Gastro",
              bucketName: null,
              importance: null,
              estimateMinutes: null,
              waitingOn: null,
              dateKind: "none",
              dateDaysFromNow: null,
            },
          ],
        },
      ],
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.reply).toBe('Got it — added "Call Gastro".');
    expect(plan.spoken).toBe("Added Call Gastro. It's on today.");
  });
});

describe("toSpokenLine", () => {
  it("speaks the short line and skips the bullet record", () => {
    expect(toSpokenLine('Got it.\n\n• Added "Call Gastro" to Today', "Added Call Gastro. It's on today.")).toBe(
      "Added Call Gastro. It's on today.",
    );
  });

  it("falls back to the first non-bullet sentence", () => {
    expect(toSpokenLine('Got it — added "Call Gastro".\n\n• Added "Call Gastro" to Today', "  ")).toBe(
      'Got it — added "Call Gastro".',
    );
  });
});

describe("fallbackPlanFromText recurrence", () => {
  it("turns every Monday into a weekly task, not a Today one-off", () => {
    const plan = fallbackPlanFromText("every Monday call Mom");
    expect(plan.actions[0]).toMatchObject({
      type: "create_tasks",
      items: [expect.objectContaining({ cleanTitle: "call Mom", repeat: "weekly", repeatWeekday: 1 })],
    });
  });
});
