// Deterministic command execution layer for the assistant.
// Takes a validated AssistantPlan from the LLM and actually mutates the DB.
// Never calls OpenAI. Never invents task matches -- ambiguous references
// become clarify results instead of guessing the wrong task.
import type { PrismaClient, Task } from "@prisma/client";
import { logTaskEvent } from "../taskEvents.js";
import { addDaysToDateString, startOfDayInTimeZone } from "../timezone.js";
import type { AssistantAction, AssistantPlan, CaptureItem } from "./conversationParser.js";

export interface ExecutedAction {
  type: string;
  ok: boolean;
  summary: string;
  taskId?: string;
  taskTitle?: string;
  // For one-tap undo of the most recent consequential mutation.
  undo?: { kind: "complete" | "drop" | "snooze" | "reopen"; taskId: string };
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

function buildCreateData(
  ctx: ExecContext,
  item: CaptureItem,
  forceToday: boolean
): Record<string, unknown> {
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
  if (!forceToday && item.dateKind !== "none" && item.dateDaysFromNow != null) {
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

    case "create_tasks": {
      const results: ExecutedAction[] = [];
      for (const item of action.items) {
        const data = buildCreateData(ctx, item, ctx.addToTodayDefault);
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
  const openTasks = await loadOpenTasks(ctx.prisma, ctx.userId);
  const executed: ExecutedAction[] = [];

  for (const action of plan.actions) {
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
  let reply = plan.reply;
  if (changeSummaries.length > 0 && !changeSummaries.some((s) => reply.toLowerCase().includes(s.toLowerCase().slice(0, 12)))) {
    // Light touch: only append if the reply didn't already narrate it.
    reply = `${reply}\n\n${changeSummaries.map((s) => `• ${s}`).join("\n")}`;
  }

  // List actions: if the model reply is thin, use the list summary.
  const list = executed.find((e) => e.type === "list" && e.ok);
  if (list && plan.actions.length === 1) {
    reply = `${plan.reply}\n\n${list.summary}`;
  }

  return { reply, executed };
}

/**
 * Deterministic no-AI fallback: treat the message as a capture dump
 * (one task, or one per newline). Keeps the assistant usable offline.
 */
export function fallbackPlanFromText(text: string): AssistantPlan {
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
