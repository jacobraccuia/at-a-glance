// Deterministic command execution layer for the assistant.
// Takes a validated AssistantPlan from the LLM and actually mutates the DB.
// Never calls OpenAI. Never invents task matches -- ambiguous references
// become clarify results instead of guessing the wrong task.
import type { PrismaClient, Task } from "@prisma/client";
import { logTaskEvent } from "../taskEvents.js";
import { addDaysToDateString, startOfDayInTimeZone } from "../timezone.js";
import type { AssistantAction, AssistantPlan, CaptureItem } from "./conversationParser.js";
import { DEFAULT_EASY_WIN_MINUTES, formatEasyWinsSummary, rankEasyWins, type EasyWin } from "./easyWins.js";

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
  executed: ExecutedAction[];
}

interface ExecContext {
  prisma: PrismaClient;
  userId: string;
  todayISO: string;
  tz: string;
  buckets: { id: string; name: string }[];
  addToTodayDefault: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve a free-text task reference against a candidate list.
 * Returns the single best match, or null if zero / ambiguous.
 */
export function resolveTaskQuery(query: string, candidates: Task[]): Task | null {
  const q = normalize(query);
  if (!q) return null;

  const scored = candidates
    .map((t) => {
      const title = normalize(t.title);
      let score = 0;
      if (title === q) score = 100;
      else if (title.includes(q)) score = 80;
      else if (q.includes(title) && title.length >= 4) score = 70;
      else {
        // Token overlap: every query token present in the title.
        const qTokens = q.split(" ").filter((tok) => tok.length > 2);
        if (qTokens.length === 0) return { t, score: 0 };
        const hits = qTokens.filter((tok) => title.includes(tok)).length;
        score = (hits / qTokens.length) * 60;
      }
      return { t, score };
    })
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  // Ambiguous if the top two are close.
  if (scored.length >= 2 && scored[0].score - scored[1].score < 15 && scored[1].score >= 50) {
    return null;
  }
  return scored[0].t;
}

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

function buildCreateData(ctx: ExecContext, item: CaptureItem): Record<string, unknown> {
  // Inbox / Later pile: soft date with no day offset (user said later/someday).
  const parkInbox = item.dateKind === "soft" && item.dateDaysFromNow == null;
  // Default: no date clues → Today when addToTodayDefault is on.
  const forceToday = ctx.addToTodayDefault && item.dateKind === "none" && !parkInbox;

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
  if (item.bucketName) {
    const match = ctx.buckets.find((b) => b.name.toLowerCase() === item.bucketName!.toLowerCase());
    if (match) data.bucketId = match.id;
  }
  if (!forceToday && !parkInbox && item.dateKind !== "none" && item.dateDaysFromNow != null) {
    const resolvedDateStr = addDaysToDateString(ctx.todayISO, item.dateDaysFromNow);
    const resolvedDate = startOfDayInTimeZone(resolvedDateStr, ctx.tz);
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
    return {
      reply: plan.actions.find((a) => a.type === "clarify")!.question,
      actions: plan.actions.filter((a) => a.type === "clarify"),
    };
  }

  if (hasMutation && /would you like|should i (add|create|make)|want me to/i.test(plan.reply)) {
    // They already chose to act — strip permission-seeking wording.
    const creates = plan.actions.filter((a) => a.type === "create_tasks");
    if (creates.length === 1 && creates[0].type === "create_tasks" && creates[0].items.length === 1) {
      const title = creates[0].items[0].cleanTitle;
      return { ...plan, reply: `Got it — added "${title}".` };
    }
    return { ...plan, reply: "Got it." };
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
      let filtered: Task[];
      if (action.scope === "today") {
        const todayStart = startOfDayInTimeZone(ctx.todayISO, ctx.tz);
        const tomorrow = addDaysToDateString(ctx.todayISO, 1);
        const todayEnd = startOfDayInTimeZone(tomorrow, ctx.tz);
        filtered = openTasks.filter(
          (t) =>
            t.status === "active" &&
            t.attentionDate &&
            t.attentionDate >= todayStart &&
            t.attentionDate < todayEnd
        );
      } else if (action.scope === "upcoming") {
        filtered = openTasks.filter((t) => t.status === "active" && t.attentionDate);
      } else if (action.scope === "later") {
        filtered = openTasks.filter((t) => t.status === "captured" || (t.status === "active" && !t.attentionDate));
      } else {
        filtered = openTasks.filter((t) => t.status === "captured" || t.status === "active");
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
      const wins = rankEasyWins(openTasks, minutes);
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
        await logTaskEvent(ctx.prisma, {
          taskId: task.id,
          userId: ctx.userId,
          type: "created",
          payload: { via: "assistant" },
        });
        results.push({
          type: "create_tasks",
          ok: true,
          summary: `Added "${task.title}"`,
          taskId: task.id,
          taskTitle: task.title,
        });
        openTasks.unshift(task);
      }
      return results;
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
        const updated = await ctx.prisma.task.update({
          where: { id: match.id },
          data: { status: "completed", completedAt: new Date() },
        });
        await logTaskEvent(ctx.prisma, { taskId: match.id, userId: ctx.userId, type: "completed", payload: { via: "assistant" } });
        return [
          {
            type: "complete",
            ok: true,
            summary: `Marked "${updated.title}" done`,
            taskId: updated.id,
            taskTitle: updated.title,
            undo: { kind: "complete", taskId: updated.id },
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
        const until = new Date();
        until.setDate(until.getDate() + action.daysFromNow);
        const updated = await ctx.prisma.task.update({
          where: { id: match.id },
          data: { snoozedUntil: until },
        });
        await logTaskEvent(ctx.prisma, {
          taskId: match.id,
          userId: ctx.userId,
          type: "snoozed",
          payload: { via: "assistant", until: until.toISOString() },
        });
        return [
          {
            type: "snooze",
            ok: true,
            summary: `Snoozed "${updated.title}" ${action.daysFromNow === 1 ? "until tomorrow" : `for ${action.daysFromNow} days`}`,
            taskId: updated.id,
            taskTitle: updated.title,
            undo: { kind: "snooze", taskId: updated.id },
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

      // add_to_today
      const updated = await ctx.prisma.task.update({
        where: { id: match.id },
        data: { status: "active", attentionDate: new Date(), snoozedUntil: null },
      });
      await logTaskEvent(ctx.prisma, {
        taskId: match.id,
        userId: ctx.userId,
        type: "updated",
        payload: { via: "assistant", attentionDate: "today" },
      });
      return [
        {
          type: "add_to_today",
          ok: true,
          summary: `Moved "${updated.title}" to Today`,
          taskId: updated.id,
          taskTitle: updated.title,
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
    return { reply: clarify.summary, executed };
  }

  // If every action failed resolution, surface that clearly.
  const failures = executed.filter((e) => !e.ok);
  if (failures.length > 0 && failures.length === executed.length) {
    return { reply: failures.map((f) => f.summary).join(" "), executed };
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

  return { reply, executed };
}

/**
 * Deterministic no-AI fallback. Recognizes a few obvious intents
 * (easy wins / what's on today) so the home surface still helps without
 * an API key; otherwise treats the message as a capture dump.
 */
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
      actions: [{ type: "easy_wins", minutes }],
    };
  }

  if (/\bwhat('s| is) on today\b/.test(lower) || /\btoday'?s (list|tasks?)\b/.test(lower)) {
    return { reply: "Here's today.", actions: [{ type: "list", scope: "today" }] };
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
  }));
  return {
    reply: items.length === 1 ? `Got it — added "${items[0].cleanTitle}".` : `Got it — added ${items.length} things.`,
    actions: [{ type: "create_tasks", items }],
  };
}
