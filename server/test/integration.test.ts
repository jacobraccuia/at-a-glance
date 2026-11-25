import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import { prisma } from "../src/db/client.js";
import { executeTool } from "../src/lib/assistant/live/tools.js";
import * as intentParser from "../src/lib/assistant/intentParser.js";
import * as conversationParser from "../src/lib/assistant/conversationParser.js";

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
    expect(res.body[0].attentionDate).toBeNull();
    expect(res.body[0].horizon).toBe("later");
    expect(res.body[0].hardDeadline).toBeNull();
    expect(res.body[0].title).toBe("drop off the package this week");

    const later = await agent.get("/api/tasks?view=later");
    expect(later.body.tasks.find((t: { id: string }) => t.id === res.body[0].id)).toBeTruthy();
    const today = await agent.get("/api/tasks?view=today");
    expect(today.body.tasks.find((t: { id: string }) => t.id === res.body[0].id)).toBeFalsy();
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
      expect(task.attentionDate).toBeNull();
      expect(task.horizon).toBe("later");
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
        timeMinutes: null,
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

  it("a named day wins over the Today default", async () => {
    const spy = vi.spyOn(intentParser, "parseMultiCaptureText").mockResolvedValue([
      {
        cleanTitle: "Call the dentist",
        bucketName: null,
        importance: null,
        estimateMinutes: null,
        waitingOn: null,
        dateKind: "soft",
        dateDaysFromNow: 10,
        timeMinutes: null,
      },
    ]);

    try {
      const res = await agent
        .post("/api/tasks/quick-capture")
        .send({ text: "call the dentist sometime", addToToday: true });
      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe("active");
      const attentionDate = new Date(res.body[0].attentionDate);
      const daysOut = (attentionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(daysOut).toBeGreaterThan(8);
      expect(daysOut).toBeLessThan(12);
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
        timeMinutes: null,
      },
      {
        cleanTitle: "Pay rent",
        bucketName: null,
        importance: "high",
        estimateMinutes: null,
        waitingOn: null,
        dateKind: "hard",
        dateDaysFromNow: 2,
        timeMinutes: null,
      },
      {
        cleanTitle: "Email John about the proposal",
        bucketName: null,
        importance: null,
        estimateMinutes: 20,
        waitingOn: null,
        dateKind: "none",
        dateDaysFromNow: null,
        timeMinutes: null,
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
      expect(res.body[0].status).toBe("captured");
      expect(res.body[0].horizon).toBe("later");
      expect(res.body[2].horizon).toBe("later");
    } finally {
      spy.mockRestore();
    }
  });

  it("assistant drops a task by natural-language reference and supports undo", async () => {
    const created = await agent.post("/api/tasks").send({ title: "Plan the drop party", status: "active" });
    expect(created.status).toBe(201);

    const spy = vi.spyOn(conversationParser, "parseConversationMessage").mockResolvedValue({
      reply: "Cancelled the drop party task.",
      actions: [{ type: "drop", taskQuery: "drop party" }],
    });

    try {
      const res = await agent.post("/api/assistant/message").send({ text: "that task about drop party can be cancelled" });
      expect(res.status).toBe(201);
      expect(res.body.executed).toHaveLength(1);
      expect(res.body.executed[0].ok).toBe(true);
      expect(res.body.executed[0].type).toBe("drop");
      expect(res.body.executed[0].undo).toEqual({ kind: "drop", taskId: created.body.id });

      const fetched = await agent.get(`/api/tasks/${created.body.id}`);
      expect(fetched.body.status).toBe("dropped");

      const undo = await agent.post("/api/assistant/undo").send(res.body.executed[0].undo);
      expect(undo.status).toBe(200);
      expect(undo.body.task.status).toBe("active");
    } finally {
      spy.mockRestore();
    }
  });

  it("assistant creates tasks from a conversational message when AI suggests create_tasks", async () => {
    const spy = vi.spyOn(conversationParser, "parseConversationMessage").mockResolvedValue({
      reply: "Added those.",
      actions: [
        {
          type: "create_tasks",
          items: [
            {
              cleanTitle: "Buy milk",
              bucketName: null,
              importance: null,
              estimateMinutes: null,
              waitingOn: null,
              dateKind: "none",
              dateDaysFromNow: null,
              timeMinutes: null,
            },
            {
              cleanTitle: "Email the promoter",
              bucketName: null,
              importance: "high",
              estimateMinutes: null,
              waitingOn: null,
              dateKind: "none",
              dateDaysFromNow: null,
              timeMinutes: null,
            },
          ],
        },
      ],
    });

    try {
      const res = await agent.post("/api/assistant/message").send({ text: "buy milk and email the promoter" });
      expect(res.status).toBe(201);
      expect(res.body.executed.filter((e: { type: string }) => e.type === "create_tasks")).toHaveLength(2);
      expect(res.body.message.content).toContain("Added");
    } finally {
      spy.mockRestore();
    }
  });

  it("assistant without AI falls back to creating a task from the raw text", async () => {
    // No mock -- exercises the real no-API-key path.
    const res = await agent.post("/api/assistant/message").send({ text: "water the fern" });
    expect(res.status).toBe(201);
    expect(res.body.executed[0].type).toBe("create_tasks");
    expect(res.body.executed[0].ok).toBe(true);
    expect(res.body.executed[0].taskTitle).toBe("water the fern");
  });

  it("keeps every open task in today, tomorrow, next week, or later", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const shift = (days: number) => {
      const [y, m, d] = today.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      date.setUTCDate(date.getUTCDate() + days);
      return `${date.toISOString().slice(0, 10)}T12:00:00.000Z`;
    };
    const make = async (title: string, attentionDate: string) => {
      const res = await agent.post("/api/tasks").send({ title, status: "active", attentionDate });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const past = await make("Past errand", shift(-2));
    const tomorrow = await make("Tomorrow errand", shift(1));
    const soon = await make("Soon errand", shift(3));
    const far = await make("Far errand", shift(40));

    const todayView = await agent.get("/api/tasks?view=today");
    expect(todayView.body.tasks.find((t: { id: string }) => t.id === past)).toBeFalsy();

    const tomorrowView = await agent.get("/api/tasks?view=tomorrow");
    expect(tomorrowView.body.tasks.find((t: { id: string }) => t.id === tomorrow)).toBeTruthy();

    const nextWeek = await agent.get("/api/tasks?view=nextWeek");
    expect(nextWeek.body.tasks.find((t: { id: string }) => t.id === soon)).toBeTruthy();
    expect(nextWeek.body.tasks.find((t: { id: string }) => t.id === far)).toBeFalsy();

    const later = await agent.get("/api/tasks?view=later");
    expect(later.body.tasks.find((t: { id: string }) => t.id === past)).toBeTruthy();
    expect(later.body.tasks.find((t: { id: string }) => t.id === far)).toBeTruthy();

    const moved = await agent.post(`/api/tasks/${past}/horizon`).send({ horizon: "tomorrow" });
    expect(moved.status).toBe(200);
    expect(moved.body.horizon).toBe("tomorrow");
  });

  it("hides a Work bucket from lists and easy wins", async () => {
    const work = await agent.post("/api/buckets").send({ name: "Work", color: "#4062BB" });
    expect(work.status).toBe(201);
    const workTask = await agent.post("/api/tasks").send({
      title: "Finish the deck",
      status: "active",
      bucketId: work.body.id,
      estimateMinutes: 10,
    });
    const homeTask = await agent.post("/api/tasks").send({
      title: "Buy paper towels",
      status: "captured",
      estimateMinutes: 5,
    });

    const all = await agent.get("/api/tasks?view=all&excludeBucketName=Work");
    expect(all.body.find((t: { id: string }) => t.id === workTask.body.id)).toBeFalsy();
    expect(all.body.find((t: { id: string }) => t.id === homeTask.body.id)).toBeTruthy();

    const wins = await agent.get("/api/assistant/easy-wins?minutes=30&excludeBucketName=Work");
    expect(wins.status).toBe(200);
    expect(wins.body.wins.find((w: { id: string }) => w.id === workTask.body.id)).toBeFalsy();
    expect(wins.body.wins.find((w: { id: string }) => w.id === homeTask.body.id)).toBeTruthy();

    const onlyWork = await agent.get(`/api/assistant/easy-wins?minutes=30&bucketId=${work.body.id}`);
    expect(onlyWork.body.wins.find((w: { id: string }) => w.id === workTask.body.id)).toBeTruthy();
    expect(onlyWork.body.wins.find((w: { id: string }) => w.id === homeTask.body.id)).toBeFalsy();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/tasks?view=all");
    expect(res.status).toBe(401);
  });

  it("keeps quick talk off the live conversation and stores editable memory", async () => {
    const personalities = await agent.get("/api/assistant/personalities");
    expect(personalities.status).toBe(200);
    expect(personalities.body.map((row: { id: string }) => row.id)).toContain("logos");

    const chosen = await agent.patch("/api/assistant/personality").send({ id: "logos" });
    expect(chosen.status).toBe(200);
    expect(chosen.body.personalityId).toBe("logos");

    const memory = await agent.post("/api/assistant/memory").send({
      kind: "preference",
      text: "I like short answers",
      source: "stated",
    });
    expect(memory.status).toBe(201);
    const rejected = await agent.post("/api/assistant/memory").send({
      kind: "pattern",
      text: "The dishes task is completed",
      source: "inferred",
    });
    expect(rejected.status).toBe(400);

    const listed = await agent.get("/api/assistant/memory");
    expect(listed.body).toHaveLength(1);

    const removed = await agent.delete(`/api/assistant/memory/${memory.body.id}`);
    expect(removed.status).toBe(204);

    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";
    try {
      const live = await agent.post("/api/assistant/live/sessions").send({ sdp: "v=0" });
      expect(live.status).toBe(503);
      const typed = await agent.post("/api/assistant/live/text").send({ text: "Maybe I should write a book someday" });
      expect(typed.status).toBe(201);
      expect(typed.body.tasksChanged).toBe(false);
      expect(typed.body.message.content).toMatch(/Nothing was added/);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }

    const tasks = await agent.get("/api/tasks?view=all");
    expect(tasks.body.find((task: { title: string }) => /write a book/i.test(task.title))).toBeFalsy();
  });

  it("runs live tools through the shared task service", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const idea = await executeTool(user.id, "create_task", JSON.stringify({ title: "Maybe I should write a book someday" }));
    expect(idea.ok).toBe(false);
    expect(idea.changed).toBe(false);

    const created = await executeTool(
      user.id,
      "create_task",
      JSON.stringify({ title: "Wash the live dishes", horizon: "today" }),
    );
    expect(created.ok).toBe(true);
    expect(created.changed).toBe(true);

    const listed = await executeTool(user.id, "list_tasks", JSON.stringify({ horizon: "today" }));
    expect(JSON.stringify(listed.tasks)).toMatch(/Wash the live dishes/);

    const missed = await executeTool(user.id, "complete_task", JSON.stringify({ query: "zzz-no-such-task" }));
    expect(missed.ok).toBe(false);
    expect(missed.changed).toBe(false);

    const done = await executeTool(user.id, "complete_task", JSON.stringify({ query: "Wash the live dishes" }));
    expect(done.ok).toBe(true);
    expect(done.changed).toBe(true);

    const parked = await executeTool(user.id, "create_task", JSON.stringify({ title: "Return the live charger" }));
    expect(parked.changed).toBe(true);
    const ask = await executeTool(user.id, "drop_task", JSON.stringify({ query: "Return the live charger" }));
    expect(ask.confirmation_required).toBe(true);
    expect(ask.changed).toBe(false);
    const stillThere = await prisma.task.findFirst({ where: { userId: user.id, title: "Return the live charger", droppedAt: null } });
    expect(stillThere).toBeTruthy();
    const dropped = await executeTool(user.id, "drop_task", JSON.stringify({ confirmationToken: ask.confirmationToken }));
    expect(dropped.ok).toBe(true);
    expect(dropped.changed).toBe(true);
    const gone = await prisma.task.findFirst({ where: { userId: user.id, title: "Return the live charger" } });
    expect(gone?.droppedAt).toBeTruthy();
  });
});

describe("Guest mode", () => {
  const guestIds: string[] = [];

  afterAll(async () => {
    for (const id of guestIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("creates a throwaway guest with sample tasks", async () => {
    const guestAgent = request.agent(app);
    const res = await guestAgent.post("/api/auth/guest").send({ timezone: "America/New_York" });
    expect(res.status).toBe(201);
    expect(res.body.isGuest).toBe(true);
    expect(res.body.displayName).toBe("Guest");
    guestIds.push(res.body.id);

    const me = await guestAgent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.isGuest).toBe(true);

    const tasks = await guestAgent.get("/api/tasks?view=all");
    expect(tasks.status).toBe(200);
    expect(tasks.body.length).toBeGreaterThanOrEqual(3);
  });
});
