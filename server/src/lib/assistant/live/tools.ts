import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../../db/client.js";
import {
  completeTask,
  createAssistantTask,
  dropTask,
  easyWinsForAssistant,
  listTasksForAssistant,
  reopenTask,
  resolveOwnedTask,
  searchTasksForAssistant,
  setHorizon,
  snoozeTask,
  updateTaskFields,
} from "../../tasks/service.js";
import type { HorizonName } from "../../horizons.js";

const MUTATIONS = new Set(["create_task", "update_task", "complete_task", "reopen_task", "reschedule_task", "drop_task"]);
export const MAX_MUTATIONS_PER_DELEGATION = 5;

const dropTokens = new Map<string, { userId: string; taskId: string; expires: number }>();
const callCache = new Map<string, string>();

export function isHypotheticalTitle(title: string): boolean {
  const text = title.trim();
  return /^(maybe|perhaps|someday|one day|i might|i should probably|what if)\b/i.test(text) || /\bsomeday\b/i.test(text);
}

export function issueDropToken(userId: string, taskId: string): string {
  const token = randomUUID();
  dropTokens.set(token, { userId, taskId, expires: Date.now() + 10 * 60 * 1000 });
  return token;
}

export function takeDropToken(userId: string, token: string): string | null {
  const row = dropTokens.get(token);
  dropTokens.delete(token);
  if (!row || row.userId !== userId || row.expires < Date.now()) return null;
  return row.taskId;
}

export function cachedToolResult(callId: string): string | undefined {
  return callCache.get(callId);
}

export function rememberToolResult(callId: string, output: string) {
  callCache.set(callId, output);
  if (callCache.size > 400) {
    const first = callCache.keys().next().value;
    if (first) callCache.delete(first);
  }
}

export function isMutatingTool(name: string): boolean {
  return MUTATIONS.has(name);
}

function obj(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function horizon(value: unknown): HorizonName | null {
  if (value === "today" || value === "tomorrow" || value === "nextWeek" || value === "later") return value;
  return null;
}

export interface ToolOutcome {
  ok: boolean;
  summary: string;
  changed: boolean;
  confirmation_required?: boolean;
  confirmationToken?: string;
  tasks?: unknown;
}

export async function executeTool(userId: string, name: string, argsJson: string): Promise<ToolOutcome> {
  const args = obj(argsJson);
  try {
    switch (name) {
      case "list_tasks": {
        const result = await listTasksForAssistant(userId, {
          horizon: (horizon(args.horizon) ?? (args.horizon === "all" ? "all" : undefined)) as HorizonName | "all" | undefined,
          bucketName: str(args.bucketName),
          status: str(args.status),
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        return { ok: true, summary: result.summary, changed: false, tasks: result.tasks };
      }
      case "search_tasks": {
        const query = str(args.query) ?? "";
        const result = await searchTasksForAssistant(userId, query);
        return { ok: true, summary: result.summary, changed: false, tasks: result.tasks };
      }
      case "get_task": {
        const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
        if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
        return {
          ok: true,
          summary: task.title,
          changed: false,
          tasks: [{ id: task.id, title: task.title, status: task.status, notes: task.notes, estimateMinutes: task.estimateMinutes }],
        };
      }
      case "list_easy_wins": {
        const minutes = typeof args.minutes === "number" ? args.minutes : 30;
        const result = await easyWinsForAssistant(userId, minutes, str(args.bucketName));
        return { ok: true, summary: result.summary, changed: false, tasks: result.tasks };
      }
      case "create_task": {
        const title = str(args.title) ?? "";
        if (isHypotheticalTitle(title)) {
          return { ok: false, summary: "That sounded like an idea, not a request to add a task.", changed: false };
        }
        const repeat = args.repeat;
        const result = await createAssistantTask(userId, {
          title,
          horizon: horizon(args.horizon),
          bucketName: str(args.bucketName),
          estimateMinutes: typeof args.estimateMinutes === "number" ? args.estimateMinutes : null,
          importance: args.importance === "low" || args.importance === "medium" || args.importance === "high" ? args.importance : null,
          notes: str(args.notes) ?? null,
          repeat: repeat === "daily" || repeat === "weekly" || repeat === "monthly" ? repeat : "none",
          repeatWeekday: typeof args.repeatWeekday === "number" ? args.repeatWeekday : null,
          timeMinutes: typeof args.timeMinutes === "number" ? args.timeMinutes : null,
        });
        if (!result.ok) return { ok: false, summary: result.error, changed: false };
        return { ok: true, summary: result.summary, changed: true };
      }
      case "update_task": {
        const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
        if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
        const result = await updateTaskFields(userId, task.id, {
          title: str(args.title),
          notes: args.notes === null ? null : str(args.notes),
          bucketName: str(args.bucketName),
          estimateMinutes: typeof args.estimateMinutes === "number" ? args.estimateMinutes : undefined,
          importance: args.importance === "low" || args.importance === "medium" || args.importance === "high" ? args.importance : undefined,
          waitingOn: args.waitingOn === null ? null : str(args.waitingOn),
        });
        if (!result.ok) return { ok: false, summary: result.error, changed: false };
        return { ok: true, summary: result.summary, changed: true };
      }
      case "complete_task": {
        const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
        if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
        const result = await completeTask(userId, task.id, "occurrence");
        if (!result.ok) return { ok: false, summary: result.error, changed: false };
        return { ok: true, summary: result.summary, changed: true };
      }
      case "reopen_task": {
        const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
        if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
        const result = await reopenTask(userId, task.id);
        if (!result.ok) return { ok: false, summary: result.error, changed: false };
        return { ok: true, summary: result.summary, changed: true };
      }
      case "reschedule_task": {
        const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
        if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
        const when = horizon(args.horizon);
        if (when) {
          const result = await setHorizon(userId, task.id, when);
          if (!result.ok) return { ok: false, summary: result.error, changed: false };
          return { ok: true, summary: result.summary, changed: true };
        }
        if (typeof args.until === "string") {
          const until = new Date(args.until);
          if (Number.isNaN(until.getTime())) return { ok: false, summary: "That time was not usable.", changed: false };
          const result = await snoozeTask(userId, task.id, until);
          if (!result.ok) return { ok: false, summary: result.error, changed: false };
          return { ok: true, summary: result.summary, changed: true };
        }
        return { ok: false, summary: "Say today, tomorrow, next week, later, or a time.", changed: false };
      }
      case "drop_task": {
        const token = str(args.confirmationToken);
        if (!token) {
          const task = await resolveOwnedTask(userId, str(args.taskId), str(args.query));
          if (!task) return { ok: false, summary: "Couldn't tell which task you meant.", changed: false };
          const issued = issueDropToken(userId, task.id);
          return {
            ok: false,
            confirmation_required: true,
            confirmationToken: issued,
            summary: `Drop "${task.title}"? Wait for a clear yes, then call drop_task again with confirmationToken.`,
            changed: false,
          };
        }
        const taskId = takeDropToken(userId, token);
        if (!taskId) return { ok: false, summary: "That confirmation expired. Ask again before removing anything.", changed: false };
        const result = await dropTask(userId, taskId);
        if (!result.ok) return { ok: false, summary: result.error, changed: false };
        return { ok: true, summary: result.summary, changed: true };
      }
      default:
        return { ok: false, summary: "That action is not available.", changed: false };
    }
  } catch (error) {
    console.error("live tool failed", name, error);
    return { ok: false, summary: "That did not go through.", changed: false };
  }
}

export async function noteToolResult(conversationId: string, outcome: ToolOutcome) {
  if (!outcome.changed && !outcome.confirmation_required) return;
  await prisma.assistantMessage.create({
    data: {
      conversationId,
      role: "assistant",
      channel: "voice",
      content: outcome.summary,
      actions: [outcome] as object[],
    },
  });
}

export function safetyId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function" as const,
  name,
  description,
  parameters: { type: "object", properties, additionalProperties: false, required },
});

export const LIVE_TOOLS = [
  fn("list_tasks", "Read tasks. Use before answering what is on the list.", {
    horizon: { type: "string", enum: ["today", "tomorrow", "nextWeek", "later", "all"] },
    bucketName: { type: "string" },
    status: { type: "string", enum: ["captured", "active", "completed", "dropped"] },
    limit: { type: "integer" },
  }),
  fn("search_tasks", "Find one task by words in the title. Ambiguous results are not a match.", {
    query: { type: "string" },
  }, ["query"]),
  fn("get_task", "Read one task by id or by a title query.", {
    taskId: { type: "string" },
    query: { type: "string" },
  }),
  fn("list_easy_wins", "Only when asked for a short window. Tasks with a fitting estimate or effort. A blank estimate is not short.", {
    minutes: { type: "integer" },
    bucketName: { type: "string" },
  }),
  fn("create_task", "Create a task only for an explicit request. Never for a hypothetical or a someday idea. Omit horizon to put it on today.", {
    title: { type: "string" },
    horizon: { type: "string", enum: ["today", "tomorrow", "nextWeek", "later"] },
    bucketName: { type: "string" },
    estimateMinutes: { type: "integer" },
    importance: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "string" },
    repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly"] },
    repeatWeekday: { type: "integer" },
    timeMinutes: { type: "integer", description: "Minutes after local midnight. 3pm is 900. Omit when no clock time was named." },
  }, ["title"]),
  fn("update_task", "Change title, notes, bucket, estimate, importance, or waitingOn.", {
    taskId: { type: "string" },
    query: { type: "string" },
    title: { type: "string" },
    notes: { type: "string" },
    bucketName: { type: "string" },
    estimateMinutes: { type: "integer" },
    importance: { type: "string", enum: ["low", "medium", "high"] },
    waitingOn: { type: "string" },
  }),
  fn("complete_task", "Mark a task done. Recurring tasks complete the current occurrence only.", {
    taskId: { type: "string" },
    query: { type: "string" },
  }),
  fn("reopen_task", "Reopen a completed or removed task.", {
    taskId: { type: "string" },
    query: { type: "string" },
  }),
  fn("reschedule_task", "Move a task to a horizon or snooze it until a time.", {
    taskId: { type: "string" },
    query: { type: "string" },
    horizon: { type: "string", enum: ["today", "tomorrow", "nextWeek", "later"] },
    until: { type: "string" },
  }),
  fn("drop_task", "Remove a task. First call returns confirmation_required. Second call needs confirmationToken after the person agrees.", {
    taskId: { type: "string" },
    query: { type: "string" },
    confirmationToken: { type: "string" },
  }),
];
