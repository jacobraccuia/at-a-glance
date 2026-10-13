import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { logTaskEvent } from "../lib/taskEvents.js";
import { generateOccurrenceDates } from "../lib/recurrence.js";
import {
  addDaysToDateString,
  endOfDayInTimeZone,
  getCurrentDateInTimeZone,
  getWeekdayName,
  startOfDayInTimeZone,
} from "../lib/timezone.js";
import { parseCaptureText } from "../lib/assistant/intentParser.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const OCCURRENCE_HORIZON_DAYS = 90;

async function getUserTimezone(userId: string): Promise<string> {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  return prefs?.timezone ?? "UTC";
}

async function materializeOccurrences(taskId: string, recurrenceRuleId: string) {
  const rule = await prisma.recurrenceRule.findUnique({ where: { id: recurrenceRuleId } });
  if (!rule) return;
  const today = new Date().toISOString().slice(0, 10);
  const horizonEnd = addDaysToDateString(today, OCCURRENCE_HORIZON_DAYS);
  const dates = generateOccurrenceDates(
    {
      frequency: rule.frequency as "daily" | "weekly" | "monthly",
      interval: rule.interval,
      byWeekday: rule.byWeekday,
      byMonthday: rule.byMonthday,
      startDate: rule.startDate.toISOString().slice(0, 10),
      endDate: rule.endDate ? rule.endDate.toISOString().slice(0, 10) : null,
    },
    rule.startDate.toISOString().slice(0, 10),
    horizonEnd
  );

  for (const dateStr of dates) {
    await prisma.taskOccurrence.upsert({
      where: { taskId_occurrenceDate: { taskId, occurrenceDate: new Date(`${dateStr}T00:00:00Z`) } },
      update: {},
      create: { taskId, occurrenceDate: new Date(`${dateStr}T00:00:00Z`) },
    });
  }
}

// ---------- Create ----------

const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  byMonthday: z.number().int().min(1).max(31).optional(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  bucketId: z.string().uuid().optional(),
  goalId: z.string().uuid().optional(),
  attentionDate: z.string().datetime().optional(),
  hardDeadline: z.string().datetime().optional(),
  deadlineSource: z.enum(["explicit", "inferred"]).optional(),
  estimateMinutes: z.number().int().min(0).optional(),
  importance: z.enum(["low", "medium", "high"]).optional(),
  waitingOn: z.string().max(500).optional(),
  status: z.enum(["captured", "active"]).default("active"),
  recurrence: recurrenceSchema.optional(),
});

tasksRouter.post("/", async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;
  const data = parsed.data;

  // Never invent a hard deadline: only accept one if explicitly provided by caller.
  if (data.hardDeadline && !data.deadlineSource) {
    data.deadlineSource = "explicit";
  }

  let recurrenceRuleId: string | undefined;
  if (data.recurrence) {
    const rule = await prisma.recurrenceRule.create({
      data: {
        frequency: data.recurrence.frequency,
        interval: data.recurrence.interval,
        byWeekday: data.recurrence.byWeekday ?? [],
        byMonthday: data.recurrence.byMonthday,
        startDate: new Date(`${data.recurrence.startDate}T00:00:00Z`),
        endDate: data.recurrence.endDate ? new Date(`${data.recurrence.endDate}T00:00:00Z`) : undefined,
      },
    });
    recurrenceRuleId = rule.id;
  }

  if (data.bucketId) {
    const bucket = await prisma.bucket.findFirst({ where: { id: data.bucketId, userId } });
    if (!bucket) return res.status(400).json({ error: "bucketId does not belong to this user" });
  }
  if (data.goalId) {
    const goal = await prisma.goal.findFirst({ where: { id: data.goalId, userId } });
    if (!goal) return res.status(400).json({ error: "goalId does not belong to this user" });
  }

  const task = await prisma.task.create({
    data: {
      userId,
      bucketId: data.bucketId,
      goalId: data.goalId,
      title: data.title,
      notes: data.notes,
      status: data.status,
      attentionDate: data.attentionDate ? new Date(data.attentionDate) : undefined,
      hardDeadline: data.hardDeadline ? new Date(data.hardDeadline) : undefined,
      deadlineSource: data.deadlineSource,
      estimateMinutes: data.estimateMinutes,
      importance: data.importance,
      waitingOn: data.waitingOn,
      recurrenceRuleId,
    },
  });

  await logTaskEvent(prisma, { taskId: task.id, userId, type: "created", payload: { title: task.title } });

  if (recurrenceRuleId) {
    await materializeOccurrences(task.id, recurrenceRuleId);
  }

  const full = await prisma.task.findUnique({
    where: { id: task.id },
    include: { occurrences: true, recurrenceRule: true },
  });
  res.status(201).json(full);
});

// ---------- Quick text capture ----------
// Phase 2, core slice: if OPENAI_API_KEY is configured, the input text is
// run through a structured intent parser (see lib/assistant/intentParser.ts)
// to *suggest* a bucket/importance/estimate/rough date. The parser can only
// choose from this user's own existing buckets (never invents one), never
// resolves absolute dates itself (the server does that date math, not the
// model), and any failure/timeout/invalid response degrades to exactly the
// old deterministic behavior below. "addToToday" from the caller (an
// explicit user action, e.g. tapping it on the Today page) always wins over
// any AI-inferred date, since it's a direct instruction.
//
// Why no hard deadline from AI: per the master prompt, hard deadlines must
// never be invented. Even when the text clearly says "due Friday", the
// resulting hardDeadline is tagged deadlineSource="inferred" (never
// "explicit") -- "explicit" is reserved for dates a user set directly via
// the Details panel, not text the assistant interpreted.
const quickCaptureSchema = z.object({
  text: z.string().min(1).max(500),
  addToToday: z.boolean().optional(),
});
tasksRouter.post("/quick-capture", async (req, res) => {
  const parsed = quickCaptureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;
  const text = parsed.data.text.trim();
  const tz = await getUserTimezone(userId);
  const todayISO = getCurrentDateInTimeZone(tz);

  const buckets = await prisma.bucket.findMany({ where: { userId, archivedAt: null } });
  const intent = await parseCaptureText(text, {
    todayISO,
    todayWeekday: getWeekdayName(todayISO),
    bucketNames: buckets.map((b) => b.name),
  });

  const data: {
    userId: string;
    title: string;
    status: "captured" | "active";
    origin: "manual" | "assistant";
    attentionDate?: Date;
    hardDeadline?: Date;
    deadlineSource?: "inferred";
    bucketId?: string;
    importance?: "low" | "medium" | "high";
    estimateMinutes?: number;
    estimateConfidence?: "low" | "medium" | "high";
    waitingOn?: string;
  } = {
    userId,
    title: text,
    status: parsed.data.addToToday ? "active" : "captured",
    attentionDate: parsed.data.addToToday ? new Date() : undefined,
    origin: "manual",
  };

  if (intent) {
    data.origin = "assistant";
    if (intent.cleanTitle.trim()) data.title = intent.cleanTitle.trim();
    if (intent.importance) data.importance = intent.importance;
    if (intent.waitingOn) data.waitingOn = intent.waitingOn;
    if (intent.estimateMinutes != null && intent.estimateMinutes > 0) {
      data.estimateMinutes = intent.estimateMinutes;
      data.estimateConfidence = "medium";
    }
    if (intent.bucketName) {
      const match = buckets.find((b) => b.name.toLowerCase() === intent.bucketName!.toLowerCase());
      if (match) data.bucketId = match.id;
    }

    // An explicit "add to today" tap always wins over the AI's rough date.
    if (!parsed.data.addToToday && intent.dateKind !== "none" && intent.dateDaysFromNow != null) {
      const resolvedDateStr = addDaysToDateString(todayISO, intent.dateDaysFromNow);
      const resolvedDate = startOfDayInTimeZone(resolvedDateStr, tz);
      data.status = "active";
      if (intent.dateKind === "hard") {
        data.hardDeadline = resolvedDate;
        data.deadlineSource = "inferred";
      } else {
        data.attentionDate = resolvedDate;
      }
    }
  }

  const task = await prisma.task.create({ data });
  await logTaskEvent(prisma, {
    taskId: task.id,
    userId,
    type: "created",
    payload: { via: "quick-capture", assisted: Boolean(intent) },
  });
  res.status(201).json(task);
});

// ---------- List / views ----------

tasksRouter.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const view = (req.query.view as string) ?? "all";
  const bucketId = req.query.bucketId as string | undefined;
  const search = req.query.search as string | undefined;
  const statusFilter = req.query.status as string | undefined;

  const tz = await getUserTimezone(userId);
  const today = getCurrentDateInTimeZone(tz);

  const baseWhere: Record<string, unknown> = { userId };
  if (bucketId) baseWhere.bucketId = bucketId;
  if (search) baseWhere.title = { contains: search, mode: "insensitive" };

  if (view === "captured") {
    const tasks = await prisma.task.findMany({
      where: { ...baseWhere, status: "captured" },
      orderBy: { createdAt: "desc" },
      include: { bucket: true },
    });
    return res.json(tasks);
  }

  if (view === "today" || view === "upcoming") {
    const rangeStartStr = view === "today" ? today : addDaysToDateString(today, 1);
    const rangeEndStr = view === "today" ? today : addDaysToDateString(today, 7);
    const rangeStart = startOfDayInTimeZone(rangeStartStr, tz);
    const rangeEnd = endOfDayInTimeZone(rangeEndStr, tz);

    // Non-recurring (or recurring-template-not-relevant) tasks due by date window.
    const directTasks = await prisma.task.findMany({
      where: {
        ...baseWhere,
        status: "active",
        recurrenceRuleId: null,
        OR: [
          { attentionDate: { lte: rangeEnd } },
          { hardDeadline: { lte: rangeEnd } },
        ],
        AND: [
          {
            OR: [
              { snoozedUntil: null },
              { snoozedUntil: { lte: new Date() } },
            ],
          },
        ],
      },
      include: { bucket: true },
      orderBy: [{ hardDeadline: "asc" }, { attentionDate: "asc" }],
    });

    // Recurring tasks: occurrences whose date falls in the window.
    const occurrences = await prisma.taskOccurrence.findMany({
      where: {
        occurrenceDate: { gte: rangeStart, lte: rangeEnd },
        task: { ...baseWhere, status: "active", recurrenceRuleId: { not: null } },
      },
      include: { task: { include: { bucket: true } } },
      orderBy: { occurrenceDate: "asc" },
    });

    return res.json({ tasks: directTasks, occurrences });
  }

  // "all"
  const where: Record<string, unknown> = { ...baseWhere };
  if (statusFilter) {
    where.status = statusFilter;
  } else {
    where.status = { not: "dropped" };
  }
  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { bucket: true, occurrences: { orderBy: { occurrenceDate: "desc" }, take: 10 } },
  });
  res.json(tasks);
});

tasksRouter.get("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, userId },
    include: { bucket: true, goal: true, occurrences: true, recurrenceRule: true, events: { orderBy: { createdAt: "desc" } } },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

// ---------- Edit ----------

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(5000).nullable().optional(),
  bucketId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  attentionDate: z.string().datetime().nullable().optional(),
  hardDeadline: z.string().datetime().nullable().optional(),
  deadlineSource: z.enum(["explicit", "inferred"]).nullable().optional(),
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  actualMinutes: z.number().int().min(0).nullable().optional(),
  importance: z.enum(["low", "medium", "high"]).optional(),
  waitingOn: z.string().max(500).nullable().optional(),
});

tasksRouter.patch("/:id", async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  const data: Record<string, unknown> = { ...parsed.data };
  if ("attentionDate" in data) data.attentionDate = data.attentionDate ? new Date(data.attentionDate as string) : null;
  if ("hardDeadline" in data) data.hardDeadline = data.hardDeadline ? new Date(data.hardDeadline as string) : null;

  const updated = await prisma.task.update({ where: { id: task.id }, data });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "updated", payload: parsed.data as Record<string, unknown> });
  res.json(updated);
});

// ---------- Lifecycle actions ----------

tasksRouter.post("/:id/complete", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.recurrenceRuleId) {
    return res.status(400).json({ error: "Recurring tasks are completed per-occurrence. Use /occurrences/:occurrenceId/complete" });
  }
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "completed", completedAt: new Date() },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "completed" });
  res.json(updated);
});

tasksRouter.post("/:id/undo", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "active", completedAt: null },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "uncompleted" });
  res.json(updated);
});

const snoozeSchema = z.object({ until: z.string().datetime() });
tasksRouter.post("/:id/snooze", async (req, res) => {
  const parsed = snoozeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  // Snoozing never alters hardDeadline -- only snoozedUntil changes.
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { snoozedUntil: new Date(parsed.data.until) },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "snoozed", payload: { until: parsed.data.until } });
  res.json(updated);
});

tasksRouter.post("/:id/drop", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "dropped", droppedAt: new Date() },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "dropped" });
  res.json(updated);
});

tasksRouter.post("/:id/reopen", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "active", droppedAt: null, completedAt: null },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "reopened" });
  res.json(updated);
});

// ---------- Occurrence completion (recurring tasks) ----------

tasksRouter.post("/:id/occurrences/:occurrenceId/complete", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const occurrence = await prisma.taskOccurrence.findFirst({
    where: { id: req.params.occurrenceId, taskId: task.id },
  });
  if (!occurrence) return res.status(404).json({ error: "Occurrence not found" });

  const updated = await prisma.taskOccurrence.update({
    where: { id: occurrence.id },
    data: { status: "completed", completedAt: new Date() },
  });
  // Completing one occurrence never affects any other occurrence row.
  await logTaskEvent(prisma, {
    taskId: task.id,
    userId,
    type: "completed",
    payload: { occurrenceId: occurrence.id, occurrenceDate: occurrence.occurrenceDate },
  });
  res.json(updated);
});

tasksRouter.post("/:id/occurrences/:occurrenceId/undo", async (req, res) => {
  const userId = req.session.userId!;
  const task = await prisma.task.findFirst({ where: { id: req.params.id, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const occurrence = await prisma.taskOccurrence.findFirst({
    where: { id: req.params.occurrenceId, taskId: task.id },
  });
  if (!occurrence) return res.status(404).json({ error: "Occurrence not found" });

  const updated = await prisma.taskOccurrence.update({
    where: { id: occurrence.id },
    data: { status: "pending", completedAt: null },
  });
  await logTaskEvent(prisma, {
    taskId: task.id,
    userId,
    type: "uncompleted",
    payload: { occurrenceId: occurrence.id, occurrenceDate: occurrence.occurrenceDate },
  });
  res.json(updated);
});
