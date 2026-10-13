import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import { prisma } from "../src/db/client.js";
import * as intentParser from "../src/lib/assistant/intentParser.js";

// Integration test against the real (local/dev) Postgres database configured
// via DATABASE_URL. Creates and tears down its own user so it doesn't
// interfere with manual testing data.

const app = createApp();
const testEmail = `vitest-${Date.now()}@example.com`;

let agent: ReturnType<typeof request.agent>;

beforeAll(() => {
  agent = request.agent(app);
});

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { email: testEmail } });
  if (user) {
    await prisma.user.delete({ where: { id: user.id } }); // cascades via schema
  }
  await prisma.$disconnect();
});

describe("Phase 1 core flows", () => {
  it("registers, logs in, and returns the authenticated user", async () => {
    const res = await agent
      .post("/api/auth/register")
      .send({ email: testEmail, password: "password123", displayName: "Vitest User", timezone: "UTC" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(testEmail);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(testEmail);
  });

  it("creates a bucket and rejects a duplicate name", async () => {
    const res = await agent.post("/api/buckets").send({ name: "Personal", color: "#111111" });
    expect(res.status).toBe(201);

    const dup = await agent.post("/api/buckets").send({ name: "Personal" });
    expect(dup.status).toBe(409);
  });

  it("creates a daily recurring task and completing one occurrence never affects another", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const createRes = await agent.post("/api/tasks").send({
      title: "Water the plants",
      status: "active",
      recurrence: { frequency: "daily", interval: 1, startDate: today },
    });
    expect(createRes.status).toBe(201);
    const task = createRes.body;
    expect(task.occurrences.length).toBeGreaterThan(1);

    const todayOcc = task.occurrences.find((o: { occurrenceDate: string }) => o.occurrenceDate.startsWith(today));
    const otherOcc = task.occurrences.find((o: { occurrenceDate: string }) => !o.occurrenceDate.startsWith(today));
    expect(todayOcc).toBeTruthy();
    expect(otherOcc).toBeTruthy();

    const completeRes = await agent.post(`/api/tasks/${task.id}/occurrences/${todayOcc.id}/complete`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("completed");

    const refetched = await agent.get(`/api/tasks/${task.id}`);
    const refetchedToday = refetched.body.occurrences.find((o: { id: string }) => o.id === todayOcc.id);
    const refetchedOther = refetched.body.occurrences.find((o: { id: string }) => o.id === otherOcc.id);
    expect(refetchedToday.status).toBe("completed");
    expect(refetchedOther.status).toBe("pending"); // independence: untouched
  });

  it("snoozing a task never changes its hard deadline", async () => {
    const deadline = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
    const createRes = await agent.post("/api/tasks").send({
      title: "Submit report",
      status: "active",
      hardDeadline: deadline,
    });
    const task = createRes.body;
    expect(task.hardDeadline).toBe(deadline);

    const snoozeUntil = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    const snoozeRes = await agent.post(`/api/tasks/${task.id}/snooze`).send({ until: snoozeUntil });
    expect(snoozeRes.status).toBe(200);
    expect(snoozeRes.body.snoozedUntil).toBe(snoozeUntil);
    expect(snoozeRes.body.hardDeadline).toBe(deadline); // unchanged
  });

  it("completes, undoes, drops, and reopens a one-off task, recording events", async () => {
    const createRes = await agent.post("/api/tasks").send({ title: "One-off task", status: "active" });
    const task = createRes.body;

    const completeRes = await agent.post(`/api/tasks/${task.id}/complete`);
    expect(completeRes.body.status).toBe("completed");

    const undoRes = await agent.post(`/api/tasks/${task.id}/undo`);
    expect(undoRes.body.status).toBe("active");

    const dropRes = await agent.post(`/api/tasks/${task.id}/drop`);
    expect(dropRes.body.status).toBe("dropped");

    const reopenRes = await agent.post(`/api/tasks/${task.id}/reopen`);
    expect(reopenRes.body.status).toBe("active");

    const fetched = await agent.get(`/api/tasks/${task.id}`);
    const eventTypes = fetched.body.events.map((e: { type: string }) => e.type);
    expect(eventTypes).toEqual(expect.arrayContaining(["created", "completed", "uncompleted", "dropped", "reopened"]));
  });

  it("quick-capture creates a task with status captured and no fabricated fields", async () => {
    const res = await agent.post("/api/tasks/quick-capture").send({ text: "drop off the package this week" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("captured");
    expect(res.body[0].hardDeadline).toBeNull();
    expect(res.body[0].title).toBe("drop off the package this week");
  });

  it("quick-capture with addToToday makes the task show up in the Today view", async () => {
    const res = await agent.post("/api/tasks/quick-capture").send({ text: "water the garden", addToToday: true });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("active");
    expect(res.body[0].attentionDate).toBeTruthy();

    const today = await agent.get("/api/tasks?view=today");
    const found = today.body.tasks.find((t: { id: string }) => t.id === res.body[0].id);
    expect(found).toBeTruthy();
  });

  it("quick-capture with no AI available falls back to one task per non-empty line", async () => {
    // No mock here -- exercises the real deterministic fallback path used
    // when OPENAI_API_KEY is unset (as in this test environment).
    const res = await agent.post("/api/tasks/quick-capture").send({
      text: "call the vet\n\npay the electric bill\nreturn library books",
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((t: { title: string }) => t.title)).toEqual([
      "call the vet",
      "pay the electric bill",
      "return library books",
    ]);
    // No AI involved -- none of these should be fabricated/assisted.
    for (const task of res.body) {
      expect(task.origin).toBe("manual");
      expect(task.status).toBe("captured");
    }
  });

  it("explicitly setting a task's attentionDate to today ('Add to Today') makes it appear there", async () => {
    const createRes = await agent.post("/api/tasks").send({ title: "Reply to promoter", status: "active" });
    const task = createRes.body;

    let today = await agent.get("/api/tasks?view=today");
    expect(today.body.tasks.find((t: { id: string }) => t.id === task.id)).toBeFalsy();

    const patchRes = await agent.patch(`/api/tasks/${task.id}`).send({ attentionDate: new Date().toISOString() });
    expect(patchRes.status).toBe(200);

    today = await agent.get("/api/tasks?view=today");
    expect(today.body.tasks.find((t: { id: string }) => t.id === task.id)).toBeTruthy();
  });

  it("quick-capture applies an AI-suggested bucket/importance/soft-date without ever setting a hard deadline as 'explicit'", async () => {
    const bucket = await agent.post("/api/buckets").send({ name: "Errands", color: "#222222" });
    expect(bucket.status).toBe(201);

    // Mock the parser directly instead of calling the real OpenAI API --
    // deterministic, free, and fast. Confirms the *route's* handling of a
    // suggestion (bucket resolution, date math, origin tagging) is correct,
    // independent of whatever the real model would say.
    const spy = vi.spyOn(intentParser, "parseMultiCaptureText").mockResolvedValue([
      {
        cleanTitle: "Drop off the package",
        bucketName: "Errands",
        importance: "high",
        estimateMinutes: 15,
        waitingOn: null,
        dateKind: "hard",
        dateDaysFromNow: 3,
      },
    ]);

    try {
      const res = await agent.post("/api/tasks/quick-capture").send({ text: "drop off the package by friday, 15 min" });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      const task = res.body[0];
      expect(task.title).toBe("Drop off the package");
      expect(task.origin).toBe("assistant");
      expect(task.importance).toBe("high");
      expect(task.estimateMinutes).toBe(15);
      expect(task.bucketId).toBe(bucket.body.id);
      expect(task.status).toBe("active");
      expect(task.hardDeadline).toBeTruthy();
      // Never "explicit" from AI-inferred text, regardless of how clearly worded.
      expect(task.deadlineSource).toBe("inferred");
    } finally {
      spy.mockRestore();
    }
  });

  it("quick-capture's explicit addToToday always wins over an AI-suggested date", async () => {
    const spy = vi.spyOn(intentParser, "parseMultiCaptureText").mockResolvedValue([
      {
        cleanTitle: "Call the dentist",
        bucketName: null,
        importance: null,
        estimateMinutes: null,
        waitingOn: null,
        dateKind: "soft",
        dateDaysFromNow: 10,
      },
    ]);

    try {
      const res = await agent
        .post("/api/tasks/quick-capture")
        .send({ text: "call the dentist sometime", addToToday: true });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe("active");
      // attentionDate should be "now" (addToToday), not 10 days out.
      const attentionDate = new Date(res.body[0].attentionDate);
      const daysOut = (attentionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(Math.abs(daysOut)).toBeLessThan(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("quick-capture splits a multi-task dump into separate tasks, each with its own fields", async () => {
    const spy = vi.spyOn(intentParser, "parseMultiCaptureText").mockResolvedValue([
      {
        cleanTitle: "Call mom",
        bucketName: null,
        importance: null,
        estimateMinutes: null,
        waitingOn: null,
        dateKind: "none",
        dateDaysFromNow: null,
      },
      {
        cleanTitle: "Pay rent",
        bucketName: null,
        importance: "high",
        estimateMinutes: null,
        waitingOn: null,
        dateKind: "hard",
        dateDaysFromNow: 2,
      },
      {
        cleanTitle: "Email John about the proposal",
        bucketName: null,
        importance: null,
        estimateMinutes: 20,
        waitingOn: null,
        dateKind: "none",
        dateDaysFromNow: null,
      },
    ]);

    try {
      const res = await agent
        .post("/api/tasks/quick-capture")
        .send({ text: "call mom, pay rent by thursday, and email John about the proposal (20 min)" });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((t: { title: string }) => t.title)).toEqual([
        "Call mom",
        "Pay rent",
        "Email John about the proposal",
      ]);
      // Each task's own fields stayed its own -- importance/estimate/deadline
      // didn't leak across items. (importance defaults to "medium" at the
      // schema level when not explicitly set, same as the single-task path.)
      expect(res.body[0].importance).toBe("medium");
      expect(res.body[1].importance).toBe("high");
      expect(res.body[1].hardDeadline).toBeTruthy();
      expect(res.body[1].deadlineSource).toBe("inferred");
      expect(res.body[2].estimateMinutes).toBe(20);
      expect(res.body[2].hardDeadline).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/tasks?view=all");
    expect(res.status).toBe(401);
  });
});
