// Shared task writes. HTTP routes and the live assistant both call these.
// The assistant must not claim a change the database did not commit.
import type { Task } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { logTaskEvent } from "../taskEvents.js";
import { ensureDefaultBucket } from "../defaultBucket.js";
import { listBucketLessons, matchLesson } from "../assistant/bucketLessons.js";
import { generateOccurrenceDates } from "../recurrence.js";
import {
  addDaysToDateString,
  endOfDayInTimeZone,
  getCurrentDateInTimeZone,
  startOfDayInTimeZone,
} from "../timezone.js";
import {
  attentionInstant,
  classifyTask,
  horizonWindows,
  type HorizonName,
} from "../horizons.js";
import { resolveTaskQuery } from "../assistant/resolveTask.js";
import { rankEasyWins, type EasyWin } from "../assistant/easyWins.js";

export interface UndoToken {
  kind: "complete" | "drop" | "snooze" | "reopen";
  taskId: string;
}

export type TaskOp =
  | {
      ok: true;
      summary: string;
      taskId: string;
      taskTitle: string;
      httpBody: unknown;
      undo?: UndoToken;
      changed: boolean;
    }
  | { ok: false; status: number; error: string };

async function clock(userId: string) {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  const tz = prefs?.timezone ?? "UTC";
  const weekStartsOn = prefs?.weekStartsOn ?? 0;
  const todayISO = getCurrentDateInTimeZone(tz);
  return { tz, weekStartsOn, todayISO, windows: horizonWindows(todayISO, tz, weekStartsOn) };
}

async function ownedTask(userId: string, taskId: string) {
  return prisma.task.findFirst({ where: { id: taskId, userId } });
}

export async function taskIdsDoneToday(userId: string, tz: string): Promise<Set<string>> {
  const today = getCurrentDateInTimeZone(tz);
  const rows = await prisma.taskOccurrence.findMany({
    where: {
      status: "completed",
      occurrenceDate: { gte: startOfDayInTimeZone(today, tz), lte: endOfDayInTimeZone(today, tz) },
      task: { userId },
    },
    select: { taskId: true },
  });
  return new Set(rows.map((row) => row.taskId));
}

export async function completeTask(
  userId: string,
  taskId: string,
  mode: "refuse-recurring" | "occurrence"
): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  if (task.recurrenceRuleId) {
    if (mode === "refuse-recurring") {
      return {
        ok: false,
        status: 400,
        error: "Recurring tasks are completed per-occurrence. Use /occurrences/:occurrenceId/complete",
      };
    }
    const { tz, todayISO } = await clock(userId);
    const todayStart = startOfDayInTimeZone(todayISO, tz);
    const todayEnd = endOfDayInTimeZone(todayISO, tz);
    const today = await prisma.taskOccurrence.findFirst({
      where: { taskId: task.id, status: "pending", occurrenceDate: { gte: todayStart, lte: todayEnd } },
      orderBy: { occurrenceDate: "asc" },
    });
    const occurrence =
      today ??
      (await prisma.taskOccurrence.findFirst({
        where: { taskId: task.id, status: "pending" },
        orderBy: { occurrenceDate: "asc" },
      }));
    if (!occurrence) return { ok: false, status: 404, error: "No pending occurrence to complete" };
    const updated = await prisma.taskOccurrence.update({
      where: { id: occurrence.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await logTaskEvent(prisma, {
      taskId: task.id,
      userId,
      type: "completed",
      payload: { via: "assistant", occurrenceId: occurrence.id },
    });
    return {
      ok: true,
      summary: `Marked today's "${task.title}" done`,
      taskId: task.id,
      taskTitle: task.title,
      httpBody: updated,
      changed: true,
    };
  }
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "completed", completedAt: new Date() },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "completed", payload: { via: "assistant" } });
  return {
    ok: true,
    summary: `Marked "${updated.title}" done`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: updated,
    undo: { kind: "complete", taskId: updated.id },
    changed: true,
  };
}

export async function dropTask(userId: string, taskId: string): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "dropped", droppedAt: new Date() },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "dropped", payload: { via: "assistant" } });
  return {
    ok: true,
    summary: `Removed "${updated.title}"`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: updated,
    undo: { kind: "drop", taskId: updated.id },
    changed: true,
  };
}

export async function reopenTask(userId: string, taskId: string): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: "active", droppedAt: null, completedAt: null },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "reopened", payload: { via: "assistant" } });
  return {
    ok: true,
    summary: `Reopened "${updated.title}"`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: updated,
    undo: { kind: "reopen", taskId: updated.id },
    changed: true,
  };
}

export async function setHorizon(userId: string, taskId: string, horizon: HorizonName): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const { windows } = await clock(userId);
  const updated = await prisma.task.update({
    where: { id: task.id },
    data:
      horizon === "later"
        ? { status: task.hardDeadline ? "active" : "captured", attentionDate: null, snoozedUntil: null }
        : { status: "active", attentionDate: attentionInstant(horizon, windows), snoozedUntil: null },
  });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "updated", payload: { horizon, via: "assistant" } });
  const place = classifyTask(updated, windows);
  return {
    ok: true,
    summary: `Moved "${updated.title}" to ${place}`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: { ...updated, horizon: place },
    changed: true,
  };
}

export async function snoozeTask(userId: string, taskId: string, until: Date): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { snoozedUntil: until },
  });
  await logTaskEvent(prisma, {
    taskId: task.id,
    userId,
    type: "snoozed",
    payload: { via: "assistant", until: until.toISOString() },
  });
  return {
    ok: true,
    summary: `Snoozed "${updated.title}"`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: updated,
    undo: { kind: "snooze", taskId: updated.id },
    changed: true,
  };
}

export async function updateTaskFields(
  userId: string,
  taskId: string,
  fields: {
    title?: string;
    notes?: string | null;
    bucketName?: string | null;
    estimateMinutes?: number | null;
    importance?: "low" | "medium" | "high";
    waitingOn?: string | null;
  }
): Promise<TaskOp> {
  const task = await ownedTask(userId, taskId);
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const data: Record<string, unknown> = {};
  if (fields.title) data.title = fields.title.trim();
  if (fields.notes !== undefined) data.notes = fields.notes;
  if (fields.estimateMinutes !== undefined) data.estimateMinutes = fields.estimateMinutes;
  if (fields.importance) data.importance = fields.importance;
  if (fields.waitingOn !== undefined) data.waitingOn = fields.waitingOn;
  if (fields.bucketName) {
    const bucket = await prisma.bucket.findFirst({
      where: { userId, archivedAt: null, name: { equals: fields.bucketName, mode: "insensitive" } },
    });
    if (!bucket) return { ok: false, status: 400, error: `No bucket named "${fields.bucketName}"` };
    data.bucketId = bucket.id;
  }
  const updated = await prisma.task.update({ where: { id: task.id }, data });
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "updated", payload: { via: "assistant", fields } });
  return {
    ok: true,
    summary: `Updated "${updated.title}"`,
    taskId: updated.id,
    taskTitle: updated.title,
    httpBody: updated,
    changed: true,
  };
}

async function attachRepeat(taskId: string, todayISO: string, frequency: "daily" | "weekly" | "monthly", weekday: number | null) {
  const rule = await prisma.recurrenceRule.create({
    data: {
      frequency,
      interval: 1,
      byWeekday: frequency === "weekly" && weekday != null ? [weekday] : [],
      startDate: new Date(`${todayISO}T00:00:00.000Z`),
    },
  });
  await prisma.task.update({ where: { id: taskId }, data: { recurrenceRuleId: rule.id, status: "active" } });
  const horizonEnd = addDaysToDateString(todayISO, 90);
  const dates = generateOccurrenceDates(
    { frequency, interval: 1, byWeekday: frequency === "weekly" && weekday != null ? [weekday] : [], startDate: todayISO },
    todayISO,
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

export async function createAssistantTask(
  userId: string,
  input: {
    title: string;
    horizon?: HorizonName | null;
    bucketName?: string | null;
    estimateMinutes?: number | null;
    importance?: "low" | "medium" | "high" | null;
    notes?: string | null;
    repeat?: "none" | "daily" | "weekly" | "monthly" | null;
    repeatWeekday?: number | null;
  }
): Promise<TaskOp> {
  const title = input.title.trim();
  if (!title) return { ok: false, status: 400, error: "A task needs a title" };
  const { todayISO, windows } = await clock(userId);
  const home = await ensureDefaultBucket(userId);
  const buckets = await prisma.bucket.findMany({ where: { userId, archivedAt: null } });
  const lessons = await listBucketLessons(userId);
  let bucketId = home.id;
  if (input.bucketName) {
    const match = buckets.find((b) => b.name.toLowerCase() === input.bucketName!.toLowerCase());
    if (match) bucketId = match.id;
  }
  const learned = matchLesson(title, lessons);
  if (learned) {
    const match = buckets.find((b) => b.name.toLowerCase() === learned.toLowerCase());
    if (match) bucketId = match.id;
  }
  const horizon = input.horizon ?? "later";
  const dated = horizon !== "later";
  const task = await prisma.task.create({
    data: {
      userId,
      title,
      notes: input.notes ?? undefined,
      origin: "assistant",
      status: dated ? "active" : "captured",
      bucketId,
      importance: input.importance ?? undefined,
      estimateMinutes: input.estimateMinutes ?? undefined,
      attentionDate: dated ? attentionInstant(horizon, windows) : undefined,
    },
  });
  if (input.repeat && input.repeat !== "none") {
    await attachRepeat(task.id, todayISO, input.repeat, input.repeatWeekday ?? null);
  }
  await logTaskEvent(prisma, { taskId: task.id, userId, type: "created", payload: { via: "live", horizon } });
  const place = horizon === "later" ? "Later" : horizon;
  return {
    ok: true,
    summary: `Added "${title}". It's in ${place}.`,
    taskId: task.id,
    taskTitle: title,
    httpBody: task,
    changed: true,
  };
}

export async function listTasksForAssistant(
  userId: string,
  filter: { horizon?: HorizonName | "all"; bucketName?: string; status?: string; limit?: number }
) {
  const { windows } = await clock(userId);
  const limit = Math.max(1, Math.min(20, filter.limit ?? 12));
  let bucketId: string | undefined;
  if (filter.bucketName) {
    const bucket = await prisma.bucket.findFirst({
      where: { userId, archivedAt: null, name: { equals: filter.bucketName, mode: "insensitive" } },
    });
    if (!bucket) return { ok: true as const, summary: `No bucket named "${filter.bucketName}".`, tasks: [] };
    bucketId = bucket.id;
  }
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      ...(bucketId ? { bucketId } : {}),
      status: filter.status ? (filter.status as Task["status"]) : { in: ["captured", "active"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
    include: { bucket: true },
  });
  const horizon = filter.horizon && filter.horizon !== "all" ? filter.horizon : null;
  const placed = tasks
    .filter((task) => (horizon ? classifyTask(task, windows) === horizon : true))
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      horizon: classifyTask(task, windows),
      bucket: task.bucket?.name ?? null,
      estimateMinutes: task.estimateMinutes,
    }));
  const summary =
    placed.length === 0
      ? "No matching tasks."
      : placed.map((task) => `${task.title} (${task.horizon})`).join("; ");
  return { ok: true as const, summary, tasks: placed };
}

export async function searchTasksForAssistant(userId: string, query: string) {
  const tasks = await prisma.task.findMany({
    where: { userId, status: { in: ["captured", "active", "completed"] }, droppedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  const match = resolveTaskQuery(query, tasks);
  if (!match) {
    return { ok: true as const, ambiguous: true, summary: `Couldn't tell which task you meant by "${query}".`, tasks: [] };
  }
  return {
    ok: true as const,
    ambiguous: false,
    summary: match.title,
    tasks: [{ id: match.id, title: match.title, status: match.status }],
  };
}

export async function easyWinsForAssistant(userId: string, minutes: number, bucketName?: string): Promise<{
  ok: true;
  summary: string;
  tasks: EasyWin[];
}> {
  const { tz } = await clock(userId);
  const done = await taskIdsDoneToday(userId, tz);
  let bucketId: string | undefined;
  if (bucketName) {
    const bucket = await prisma.bucket.findFirst({
      where: { userId, archivedAt: null, name: { equals: bucketName, mode: "insensitive" } },
    });
    if (!bucket) return { ok: true, summary: `No bucket named "${bucketName}".`, tasks: [] };
    bucketId = bucket.id;
  }
  const open = await prisma.task.findMany({
    where: { userId, status: { in: ["captured", "active"] }, ...(bucketId ? { bucketId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  const wins = rankEasyWins(
    open.filter((task) => !done.has(task.id)),
    minutes
  );
  const summary =
    wins.length === 0
      ? `No easy wins that fit in ${minutes} minutes.`
      : wins.map((win) => `${win.title} (~${win.estimateMinutes ?? win.assumedMinutes}m)`).join("; ");
  return { ok: true, summary, tasks: wins };
}

export async function resolveOwnedTask(userId: string, taskId: string | undefined, query: string | undefined) {
  if (taskId) {
    const task = await ownedTask(userId, taskId);
    return task;
  }
  if (!query) return null;
  const tasks = await prisma.task.findMany({
    where: { userId, status: { in: ["captured", "active", "completed", "dropped"] } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return resolveTaskQuery(query, tasks);
}
