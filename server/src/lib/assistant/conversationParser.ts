// Phase 2 full assistant: turns a free-form user message (+ recent chat
// context + a snapshot of their tasks) into a *suggested* plan of actions
// the deterministic executor will run. The model never touches the DB.
//
// Same design principles as intentParser.ts: structured Zod output,
// temperature 0, never invent buckets, day-offsets not absolute dates,
// degrade to null on any failure so the route can fall back safely.
import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { CaptureIntent } from "./intentParser.js";

const CaptureItemSchema = z.object({
  cleanTitle: z.string(),
  bucketName: z.string().nullable(),
  importance: z.enum(["low", "medium", "high"]).nullable(),
  estimateMinutes: z.number().int().nullable(),
  waitingOn: z.string().nullable(),
  dateKind: z.enum(["none", "soft", "hard"]),
  dateDaysFromNow: z.number().int().min(0).max(365).nullable(),
});

const AssistantActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_tasks"),
    items: z.array(CaptureItemSchema).min(1).max(20),
  }),
  z.object({
    type: z.literal("complete"),
    // Free-text reference the executor will resolve against the user's tasks.
    taskQuery: z.string().min(1),
  }),
  z.object({
    type: z.literal("drop"),
    taskQuery: z.string().min(1),
  }),
  z.object({
    type: z.literal("snooze"),
    taskQuery: z.string().min(1),
    daysFromNow: z.number().int().min(0).max(365),
  }),
  z.object({
    type: z.literal("reopen"),
    taskQuery: z.string().min(1),
  }),
  z.object({
    type: z.literal("add_to_today"),
    taskQuery: z.string().min(1),
  }),
  z.object({
    type: z.literal("list"),
    scope: z.enum(["today", "upcoming", "later", "all"]),
  }),
  z.object({
    // Surface short, unblocked tasks that fit a time budget ("I have 25 minutes").
    // The server ranks them with transparent rules -- you just pick this action
    // and optionally pass the minute budget the user mentioned (null = 25).
    type: z.literal("easy_wins"),
    minutes: z.number().int().min(1).max(240).nullable(),
  }),
  z.object({
    // Ask the user something instead of guessing. Prefer this over a wrong
    // complete/drop when the task reference is ambiguous.
    type: z.literal("clarify"),
    question: z.string().min(1),
  }),
  z.object({
    // Pure chat / acknowledgment with no side effects.
    type: z.literal("none"),
  }),
]);

const AssistantPlanSchema = z.object({
  // Short, natural reply shown in the chat bubble. Speaks as the assistant.
  reply: z.string().min(1).max(1000),
  // Zero or more actions to attempt, in order. Usually one; multi-intent
  // messages (create three things AND snooze another) can produce several.
  actions: z.array(AssistantActionSchema).max(10),
});

export type AssistantAction = z.infer<typeof AssistantActionSchema>;
export type AssistantPlan = z.infer<typeof AssistantPlanSchema>;
export type CaptureItem = CaptureIntent;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  status: string;
  attentionDate: string | null;
  hardDeadline: string | null;
  importance: string;
  estimateMinutes: number | null;
  waitingOn: string | null;
}

export interface ParseConversationContext {
  todayISO: string;
  todayWeekday: string;
  upcomingWeekdayOffsets: Record<string, number>;
  bucketNames: string[];
  tasks: TaskSnapshot[];
  history: ConversationTurn[];
}

const PARSE_TIMEOUT_MS = 12000;

let cachedClient: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  cachedClient = apiKey ? new OpenAI({ apiKey }) : null;
  return cachedClient;
}

function formatTaskSnapshot(tasks: TaskSnapshot[]): string {
  if (tasks.length === 0) return "(no open tasks)";
  return tasks
    .map((t) => {
      const bits = [`id=${t.id}`, `status=${t.status}`, `importance=${t.importance}`];
      if (t.estimateMinutes != null) bits.push(`~${t.estimateMinutes}m`);
      if (t.waitingOn) bits.push(`waiting=${t.waitingOn}`);
      if (t.attentionDate) bits.push(`attention=${t.attentionDate.slice(0, 10)}`);
      if (t.hardDeadline) bits.push(`due=${t.hardDeadline.slice(0, 10)}`);
      return `- "${t.title}" (${bits.join(", ")})`;
    })
    .join("\n");
}

/**
 * Ask the model for a structured assistant plan. Returns null (never throws)
 * if AI is unavailable / slow / invalid -- callers must fall back.
 */
export async function parseConversationMessage(
  userMessage: string,
  context: ParseConversationContext
): Promise<AssistantPlan | null> {
  const client = getClient();
  if (!client) return null;

  const offsetTable = Object.entries(context.upcomingWeekdayOffsets)
    .map(([day, offset]) => `${day}=${offset}`)
    .join(", ");

  const system = [
    "You are the user's personal task assistant inside the Taskr app.",
    "You understand natural language and turn it into structured actions the app will execute.",
    "You are NOT a dictation bar. Creating tasks is only one of the things you can do.",
    "Be concise, calm, and useful. Reply in plain conversational English.",
    "",
    `Today is ${context.todayISO} (a ${context.todayWeekday}).`,
    `Weekday day-offsets (look these up, do NOT compute them): ${offsetTable}.`,
    `Existing buckets (match exactly or null, never invent): ${
      context.bucketNames.length > 0 ? context.bucketNames.join(", ") : "(none yet)"
    }.`,
    "",
    "The user's current open tasks (use these to resolve references like \"that drop party thing\"):",
    formatTaskSnapshot(context.tasks),
    "",
    "Action rules:",
    "- create_tasks: for new commitments (\"Call Gastro\", \"buy milk\"). Just create — do NOT ask",
    "  \"would you like me to add that?\". They don't need to say \"add a task\".",
    "  One item per distinct task. Never fabricate a hard deadline;",
    "  use dateKind 'hard' only with explicit deadline language (due/by/deadline).",
    "  Scheduling: dateKind 'none' = Today (default when no date clues).",
    "  \"later\" / \"someday\" / \"not today\" / \"backlog\" → dateKind 'soft' with dateDaysFromNow null (inbox).",
    "  Named days (Friday, next week) → soft/hard with the weekday offset table.",
    "- complete / drop / snooze / reopen / add_to_today: set taskQuery to a short phrase from the user's",
    "  words that identifies the task. Prefer clarify if more than one open task could match.",
    "- list: when they ask what's on today / upcoming / later / everything.",
    "- easy_wins: when they have a short window (\"I have 25 minutes\", \"what can I knock out quick\",",
    "  \"easy wins\"). Pass minutes if they named a budget, otherwise null (defaults to 25).",
    "  Do NOT invent which tasks are easy -- the server ranks them with transparent rules.",
    "- clarify: ask ONE short question ONLY when something is odd/ambiguous (two possible tasks,",
    "  unclear if they mean complete vs create). NEVER combine clarify with create/complete/drop",
    "  in the same plan — either ask OR act, never both.",
    "- none: greetings, thanks, or chat with no side effects.",
    "- You may return multiple actions for multi-intent messages (e.g. create two tasks and snooze another).",
    "- Never invent a task id. Never claim you did something you didn't put in actions.",
    "- If you create/complete/drop, your reply must state what you did — not ask permission for it.",
  ].join("\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...context.history.slice(-8).map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user", content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0,
        messages,
        response_format: zodResponseFormat(AssistantPlanSchema, "assistant_plan"),
      },
      { signal: controller.signal }
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    const result = AssistantPlanSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;

    // Defense in depth on bucket names inside create_tasks.
    const actions = result.data.actions.map((action) => {
      if (action.type !== "create_tasks") return action;
      return {
        ...action,
        items: action.items.map((item) =>
          item.bucketName && !context.bucketNames.includes(item.bucketName)
            ? { ...item, bucketName: null }
            : item
        ),
      };
    });

    return { reply: result.data.reply, actions };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
