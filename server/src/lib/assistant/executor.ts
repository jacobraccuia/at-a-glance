// Deterministic command execution layer for the assistant.
// Takes a validated AssistantPlan from the LLM and actually mutates the DB.
// Never calls OpenAI. Never invents task matches -- ambiguous references
// become clarify results instead of guessing the wrong task.
import type { PrismaClient, Task } from "@prisma/client";
import { logTaskEvent } from "../taskEvents.js";
import { generateOccurrenceDates } from "../recurrence.js";
import { addDaysToDateString, dateAtMinutes, startOfDayInTimeZone } from "../timezone.js";
import type { AssistantAction, AssistantPlan, CaptureItem } from "./conversationParser.js";
import { DEFAULT_EASY_WIN_MINUTES, formatEasyWinsSummary, rankEasyWins, type EasyWin } from "./easyWins.js";
import { classifyTask, horizonLabel, horizonWindows, type HorizonName } from "../horizons.js";
import { matchLesson } from "./bucketLessons.js";
import { resolveTaskQuery } from "./resolveTask.js";
import { completeTask, setHorizon, snoozeTask, taskIdsDoneToday } from "../tasks/service.js";

export interface ExecutedAction {
  type: string;
  ok: boolean;
  summary: string;
  taskId?: string;
  taskTitle?: string;
  // For one-tap undo of the most recent consequential mutation.
  undo?: { kind: "complete" | "drop" | "snooze" | "reopen"; taskId: string };
  /** Populated by easy_wins so the UI can show tappable suggestions. */
  easyWins?: EasyWin[];
  minutes?: number;
}

export interface ExecutionResult {
  reply: string;
  /** Short line for TTS. Not the bullet record. */
  spoken: string;
  executed: ExecutedAction[];
}

/** Line to speak. Prefer the model's spoken field; never read bullets aloud. */
export function toSpokenLine(written: string, spoken?: string | null): string {
  const clean = (spoken ?? "")
    .replace(/^•\s*/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean && !clean.includes("•") && clean.length <= 240) return clean;
  const first = written
    .split("\n")
    .map((l) => l.replace(/^•\s*/, "").trim())
    .find((l) => l.length > 0);
  return (first ?? written).replace(/\s+/g, " ").trim().slice(0, 180);
}

function spokenForCapture(title: string, item: CaptureItem): string {
  if (item.repeat && item.repeat !== "none") return `Added ${title}.`;
  if (item.dateDaysFromNow === 0 && item.dateKind !== "none") return `Added ${title}. It's on today.`;
  if (item.dateDaysFromNow === 1) return `Added ${title}. It's on tomorrow.`;
  if (item.dateDaysFromNow != null && item.dateKind !== "none") {
    return item.dateDaysFromNow > 14 ? `Added ${title}. It's in Later.` : `Added ${title}. It's in Upcoming.`;
  }
  return `Added ${title}. It's in Later.`;
}

function placementOf(data: Record<string, unknown>, ctx: ExecContext): HorizonName {
  const windows = horizonWindows(ctx.todayISO, ctx.tz, ctx.weekStartsOn ?? 0);
  return classifyTask(
    {
      attentionDate: (data.attentionDate as Date | undefined) ?? null,
      hardDeadline: (data.hardDeadline as Date | undefined) ?? null,
    },
    windows
  );
}

interface ExecContext {
  prisma: PrismaClient;
  userId: string;
  todayISO: string;
  tz: string;
  buckets: { id: string; name: string }[];
  lessons?: { phrase: string; bucketName: string }[];
  defaultBucketId?: string;
  addToTodayDefault: boolean;
  weekStartsOn?: number;
}

export { resolveTaskQuery } from "./resolveTask.js";

async function loadOpenTasks(prisma: PrismaClient, userId: string): Promise<Task[]> {
  return prisma.task.findMany({
    where: {
      userId,
      status: { in: ["captured", "active", "completed"] },
      droppedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
}

const REPEAT_HORIZON_DAYS = 90;

function isRepeating(item: CaptureItem): boolean {
  return Boolean(item.repeat && item.repeat !== "none");
}

async function attachRecurrence(ctx: ExecContext, taskId: string, item: CaptureItem): Promise<void> {
  const frequency = item.repeat;
  if (!frequency || frequency === "none") return;
  const weekdays = frequency === "weekly" && item.repeatWeekday != null ? [item.repeatWeekday] : [];
  const rule = await ctx.prisma.recurrenceRule.create({
    data: {
      frequency,
      interval: 1,
      byWeekday: weekdays,
      startDate: new Date(`${ctx.todayISO}T00:00:00.000Z`),
    },
  });
  await ctx.prisma.task.update({
    where: { id: taskId },
    data: { recurrenceRuleId: rule.id, status: "active", attentionDate: null },
  });
  const horizonEnd = addDaysToDateString(ctx.todayISO, REPEAT_HORIZON_DAYS);
  const dates = generateOccurrenceDates(
    {
      frequency,
      interval: 1,
      byWeekday: weekdays,
      startDate: ctx.todayISO,
    },
    ctx.todayISO,
    horizonEnd,
  );
  for (const dateStr of dates) {
    await ctx.prisma.taskOccurrence.upsert({
      where: { taskId_occurrenceDate: { taskId, occurrenceDate: new Date(`${dateStr}T00:00:00.000Z`) } },
      update: {},
      create: { taskId, occurrenceDate: new Date(`${dateStr}T00:00:00.000Z`) },
    });
  }
}

function buildCreateData(ctx: ExecContext, item: CaptureItem): Record<string, unknown> {
  // Inbox / Later pile: soft date with no day offset (user said later/someday).
  // No date, or an explicit "later"/"someday", parks in Later.
  // Repeating tasks show up on their days, not as an extra one-off row.
  const parkInbox =
    !isRepeating(item) &&
    ((item.dateKind === "soft" && item.dateDaysFromNow == null) ||
      (item.dateKind === "none" && !ctx.addToTodayDefault));
  const forceToday = !isRepeating(item) && ctx.addToTodayDefault && item.dateKind === "none" && !parkInbox;

  const data: Record<string, unknown> = {
    userId: ctx.userId,
    title: item.cleanTitle.trim() || "Untitled",
    status: forceToday ? "active" : "captured",
    attentionDate: forceToday ? new Date() : undefined,
    origin: "assistant",
  };
  if (item.importance) data.importance = item.importance;
  if (item.waitingOn) data.waitingOn = item.waitingOn;
  if (item.estimateMinutes != null && item.estimateMinutes > 0) {
    data.estimateMinutes = item.estimateMinutes;
    data.estimateConfidence = "medium";
  }
  const learned = matchLesson(String(data.title), ctx.lessons ?? []);
  const bucketName = learned ?? item.bucketName;
  if (bucketName) {
    const match = ctx.buckets.find((b) => b.name.toLowerCase() === bucketName.toLowerCase());
    if (match) data.bucketId = match.id;
  }
  if (!data.bucketId && ctx.defaultBucketId) data.bucketId = ctx.defaultBucketId;
  if (!forceToday && !parkInbox && item.dateKind !== "none" && item.dateDaysFromNow != null) {
    const resolvedDateStr = addDaysToDateString(ctx.todayISO, item.dateDaysFromNow);
    const resolvedDate =
      item.timeMinutes == null
        ? startOfDayInTimeZone(resolvedDateStr, ctx.tz)
        : dateAtMinutes(resolvedDateStr, ctx.tz, item.timeMinutes);
    data.status = "active";
    if (item.dateKind === "hard") {
      data.hardDeadline = resolvedDate;
      data.deadlineSource = "inferred";
    } else {
      data.attentionDate = resolvedDate;
    }
  }
  return data;
}

const MUTATING_TYPES = new Set([
  "create_tasks",
  "complete",
  "drop",
  "snooze",
  "reopen",
  "add_to_today",
  "set_estimate",
]);

/**
 * Defense in depth: model sometimes asks in reply while also mutating.
 * Rule — either ask OR act, never both.
 */
export function sanitizeAssistantPlan(plan: AssistantPlan): AssistantPlan {
  const hasClarify = plan.actions.some((a) => a.type === "clarify");
  const hasMutation = plan.actions.some((a) => MUTATING_TYPES.has(a.type));

  if (hasClarify && hasMutation) {
    // Prefer the question — don't mutate until they answer.
    const question = plan.actions.find((a): a is Extract<AssistantAction, { type: "clarify" }> => a.type === "clarify")?.question ?? plan.reply;
    return {
      reply: question,
      spoken: question,
      actions: plan.actions.filter((a) => a.type === "clarify"),
    };
  }

  if (hasMutation && /would you like|should i (add|create|make)|want me to/i.test(plan.reply)) {
    // They already chose to act — strip permission-seeking wording.
    const creates = plan.actions.filter((a) => a.type === "create_tasks");
    if (creates.length === 1 && creates[0].type === "create_tasks" && creates[0].items.length === 1) {
      const item = creates[0].items[0];
      const line = spokenForCapture(item.cleanTitle, item);
      return { ...plan, reply: `Got it — added "${item.cleanTitle}".`, spoken: line };
    }
    return { ...plan, reply: "Got it.", spoken: "Got it." };
  }

  return plan;
}

async function runAction(action: AssistantAction, ctx: ExecContext, openTasks: Task[]): Promise<ExecutedAction[]> {
  switch (action.type) {
    case "none":
      return [];

    case "clarify":
      return [{ type: "clarify", ok: true, summary: action.question }];

    case "list": {
      const windows = horizonWindows(ctx.todayISO, ctx.tz, ctx.weekStartsOn ?? 0);
      const now = Date.now();
      const visible = openTasks.filter(
        (t) =>
          (t.status === "captured" || t.status === "active") &&
          !t.recurrenceRuleId &&
          !(t.snoozedUntil && t.snoozedUntil.getTime() > now)
      );
      let filtered: Task[];
      if (action.scope === "all") {
        filtered = visible;
      } else if (action.scope === "upcoming") {
        filtered = visible.filter((t) => {
          const place = classifyTask(t, windows);
          return place === "tomorrow" || place === "nextWeek";
        });
      } else {
        const scope = action.scope as HorizonName;
        filtered = visible.filter((t) => classifyTask(t, windows) === scope);
      }
      const titles = filtered.slice(0, 12).map((t) => t.title);
      const summary =
        titles.length === 0
          ? `Nothing in ${action.scope}.`
          : `${action.scope}: ${titles.map((t) => `"${t}"`).join(", ")}${filtered.length > 12 ? ` (+${filtered.length - 12} more)` : ""}`;
      return [{ type: "list", ok: true, summary }];
    }

    case "easy_wins": {
      const minutes = action.minutes ?? DEFAULT_EASY_WIN_MINUTES;
      const doneToday = await taskIdsDoneToday(ctx.userId, ctx.tz);
      const wins = rankEasyWins(
        openTasks.filter((task) => !doneToday.has(task.id)),
        minutes
      );
      return [
        {
          type: "easy_wins",
          ok: true,
          summary: formatEasyWinsSummary(wins, minutes),
          easyWins: wins,
          minutes,
        },
      ];
    }

    case "create_tasks": {
      const results: ExecutedAction[] = [];
      for (const item of action.items) {
        const data = buildCreateData(ctx, item);
        const task = await ctx.prisma.task.create({ data: data as never });
        if (isRepeating(item)) await attachRecurrence(ctx, task.id, item);
        await logTaskEvent(ctx.prisma, {
          taskId: task.id,
          userId: ctx.userId,
          type: "created",
          payload: { via: "assistant", repeat: item.repeat ?? "none" },
        });
        const place = placementOf(data, ctx);
        const weekdayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const repeatLabel =
          item.repeat === "daily"
            ? "every day"
            : item.repeat === "weekly"
              ? `every ${item.repeatWeekday != null ? weekdayName[item.repeatWeekday] : "week"}`
              : item.repeat === "monthly"
                ? "every month"
                : "";
        results.push({
          type: "create_tasks",
          ok: true,
          summary: repeatLabel
            ? `Added "${task.title}" ${repeatLabel}`
            : `Added "${task.title}" to ${horizonLabel(place)}`,
          taskId: task.id,
          taskTitle: task.title,
        });
        openTasks.unshift(task);
      }
      return results;
    }

    case "set_estimate": {
      const pool = openTasks.filter((t) => t.status === "captured" || t.status === "active" || t.status === "completed");
      const match = resolveTaskQuery(action.taskQuery, pool);
      if (!match) {
        return [
          {
            type: "set_estimate",
            ok: false,
            summary: `Couldn't tell which task you meant by "${action.taskQuery}". Which one?`,
          },
        ];
      }
      const updated = await ctx.prisma.task.update({
        where: { id: match.id },
        data: { estimateMinutes: action.minutes, estimateConfidence: "high" },
      });
      await logTaskEvent(ctx.prisma, {
        taskId: match.id,
        userId: ctx.userId,
        type: "updated",
        payload: { via: "assistant", estimateMinutes: action.minutes, previous: match.estimateMinutes },
      });
      return [
        {
          type: "set_estimate",
          ok: true,
          summary: `Set "${updated.title}" to ${action.minutes} minutes`,
          taskId: updated.id,
          taskTitle: updated.title,
        },
      ];
    }

    case "complete":
    case "drop":
    case "snooze":
    case "reopen":
    case "add_to_today": {
      const pool =
        action.type === "reopen"
          ? openTasks.filter((t) => t.status === "completed" || t.status === "dropped")
          : openTasks.filter((t) => t.status === "captured" || t.status === "active");
      const match = resolveTaskQuery(action.taskQuery, pool);
      if (!match) {
        return [
          {
            type: action.type,
            ok: false,
            summary: `Couldn't tell which task you meant by "${action.taskQuery}". Which one?`,
          },
        ];
      }

      if (action.type === "complete") {
        const result = await completeTask(ctx.userId, match.id, "occurrence");
        if (!result.ok) {
          return [{ type: "complete", ok: false, summary: result.error }];
        }
        return [
          {
            type: "complete",
            ok: true,
            summary: result.summary,
            taskId: result.taskId,
            taskTitle: result.taskTitle,
            undo: result.undo,
          },
        ];
      }

      if (action.type === "drop") {
        const updated = await ctx.prisma.task.update({
          where: { id: match.id },
          data: { status: "dropped", droppedAt: new Date() },
        });
        await logTaskEvent(ctx.prisma, { taskId: match.id, userId: ctx.userId, type: "dropped", payload: { via: "assistant" } });
        return [
          {
            type: "drop",
            ok: true,
            summary: `Cancelled "${updated.title}"`,
            taskId: updated.id,
            taskTitle: updated.title,
            undo: { kind: "drop", taskId: updated.id },
          },
        ];
      }

      if (action.type === "snooze") {
        const day = addDaysToDateString(ctx.todayISO, action.daysFromNow);
        const until = startOfDayInTimeZone(day, ctx.tz);
        const result = await snoozeTask(ctx.userId, match.id, until);
        if (!result.ok) return [{ type: "snooze", ok: false, summary: result.error }];
        const when = action.daysFromNow === 1 ? "until tomorrow" : `for ${action.daysFromNow} days`;
        return [
          {
            type: "snooze",
            ok: true,
            summary: `Snoozed "${result.taskTitle}" ${when}`,
            taskId: result.taskId,
            taskTitle: result.taskTitle,
            undo: result.undo,
          },
        ];
      }

      if (action.type === "reopen") {
        const updated = await ctx.prisma.task.update({
          where: { id: match.id },
          data: { status: "active", completedAt: null, droppedAt: null },
        });
        await logTaskEvent(ctx.prisma, { taskId: match.id, userId: ctx.userId, type: "reopened", payload: { via: "assistant" } });
        return [
          {
            type: "reopen",
            ok: true,
            summary: `Reopened "${updated.title}"`,
            taskId: updated.id,
            taskTitle: updated.title,
            undo: { kind: "reopen", taskId: updated.id },
          },
        ];
      }

      const moved = await setHorizon(ctx.userId, match.id, "today");
      if (!moved.ok) return [{ type: "add_to_today", ok: false, summary: moved.error }];
      return [
        {
          type: "add_to_today",
          ok: true,
          summary: `Moved "${moved.taskTitle}" to Today`,
          taskId: moved.taskId,
          taskTitle: moved.taskTitle,
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Execute a validated plan. Mutates the reply if actions failed or if a
 * clarify action should take precedence over the model's draft reply.
 */
export async function executeAssistantPlan(plan: AssistantPlan, ctx: ExecContext): Promise<ExecutionResult> {
  const sanitized = sanitizeAssistantPlan(plan);
  const openTasks = await loadOpenTasks(ctx.prisma, ctx.userId);
  const executed: ExecutedAction[] = [];

  for (const action of sanitized.actions) {
    const results = await runAction(action, ctx, openTasks);
    executed.push(...results);
  }

  // Prefer an explicit clarify question as the visible reply.
  const clarify = executed.find((e) => e.type === "clarify" && e.ok);
  if (clarify) {
    const reply = clarify.summary;
    return { reply, spoken: toSpokenLine(reply, sanitized.spoken), executed };
  }

  // If every action failed resolution, surface that clearly.
  const failures = executed.filter((e) => !e.ok);
  if (failures.length > 0 && failures.length === executed.length) {
    const reply = failures.map((f) => f.summary).join(" ");
    return { reply, spoken: toSpokenLine(reply, sanitized.spoken), executed };
  }

  // Otherwise keep the model's reply, but append concrete change summaries
  // when useful (so the user sees exactly what happened).
  const changeSummaries = executed.filter((e) => e.ok && e.type !== "list" && e.type !== "clarify").map((e) => e.summary);
  let reply = sanitized.reply;
  if (changeSummaries.length > 0 && !changeSummaries.some((s) => reply.toLowerCase().includes(s.toLowerCase().slice(0, 12)))) {
    // Light touch: only append if the reply didn't already narrate it.
    reply = `${reply}\n\n${changeSummaries.map((s) => `• ${s}`).join("\n")}`;
  }

  // List / easy_wins: append the concrete summary so the user sees the picks.
  const list = executed.find((e) => e.type === "list" && e.ok);
  if (list && sanitized.actions.length === 1) {
    reply = `${sanitized.reply}\n\n${list.summary}`;
  }
  const wins = executed.find((e) => e.type === "easy_wins" && e.ok);
  if (wins && sanitized.actions.every((a) => a.type === "easy_wins" || a.type === "none")) {
    reply = `${sanitized.reply}\n\n${wins.summary}`;
  }

  return { reply, spoken: toSpokenLine(reply, sanitized.spoken), executed };
}

/**
 * Deterministic no-AI fallback. Recognizes a few obvious intents
 * (easy wins / what's on today) so the home surface still helps without
 * an API key; otherwise treats the message as a capture dump.
 */
/** Greetings and acknowledgements. Not a task. */
export function isChatter(text: string): boolean {
  return /^(hi|hello|hey|hiya|yo|sup|thanks|thank you|ok|okay|k|cool|bye|goodbye|good morning|good afternoon|good night|how are you|what's up|whats up|nothing|never mind|nm|lol|haha)[.!?]*$/i.test(
    text.trim(),
  );
}

export function fallbackPlanFromText(text: string): AssistantPlan {
  const lower = text.toLowerCase();

  const minutesMatch = lower.match(/(\d+)\s*(minutes?|mins?|m)\b/);
  if (
    /\beasy wins?\b/.test(lower) ||
    /\bknock out\b/.test(lower) ||
    /\bquick wins?\b/.test(lower) ||
    (minutesMatch && /\b(have|got|only)\b/.test(lower))
  ) {
    const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : null;
    return {
      reply: "Here are some easy wins.",
      spoken: "Here are a few easy wins.",
      actions: [{ type: "easy_wins", minutes }],
    };
  }

  if (/\bwhat('s| is) on today\b/.test(lower) || /\btoday'?s (list|tasks?)\b/.test(lower)) {
    return { reply: "Here's today.", spoken: "Here's what's on today.", actions: [{ type: "list", scope: "today" }] };
  }

  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const weekly = lower.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  const daily = /\bevery\s+day\b/.test(lower);
  const monthly = /\bevery\s+month\b/.test(lower);
  if (weekly || daily || monthly) {
    const title = text
      .replace(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|day|month)\b/i, "")
      .replace(/\b(remind me to|please)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const cleanTitle = title || text.trim();
    const repeat = daily ? "daily" : monthly ? "monthly" : "weekly";
    const repeatWeekday = weekly ? weekdayNames.indexOf(weekly[1] as (typeof weekdayNames)[number]) : null;
    const when = daily ? "every day" : monthly ? "every month" : `every ${weekly![1]}`;
    return {
      reply: `Got it — added "${cleanTitle}" ${when}.`,
      spoken: `Added ${cleanTitle}, ${when}.`,
      actions: [
        {
          type: "create_tasks",
          items: [
            {
              cleanTitle,
              bucketName: null,
              importance: null,
              estimateMinutes: null,
              waitingOn: null,
              dateKind: "none",
              dateDaysFromNow: null,
              timeMinutes: null,
              repeat,
              repeatWeekday,
            },
          ],
        },
      ],
    };
  }

  if (isChatter(text)) {
    return { reply: "Hey.", spoken: "Hey.", actions: [{ type: "none" }] };
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
  const items = (lines.length > 0 ? lines : [text.trim()]).filter(Boolean).map((line) => ({
    cleanTitle: line,
    bucketName: null,
    importance: null,
    estimateMinutes: null,
    waitingOn: null,
    dateKind: "none" as const,
    dateDaysFromNow: null,
    timeMinutes: null,
    repeat: "none" as const,
    repeatWeekday: null,
  }));
  const reply =
    items.length === 1 ? `Got it — added "${items[0].cleanTitle}".` : `Got it — added ${items.length} things.`;
  const spoken =
    items.length === 1 ? `Added ${items[0].cleanTitle}. It's in Later.` : `Added ${items.length} things to Later.`;
  return {
    reply,
    spoken,
    actions: [{ type: "create_tasks", items }],
  };
}
