// Phase 2, core slice: turns free-form quick-capture text into structured,
// *suggested* task fields (bucket, importance, estimate, rough date).
//
// Design principles (see CURSOR_MASTER_PROMPT.md "Universal conversational
// assistant" + "Prioritization"):
// - Deterministic command execution stays separate from LLM parsing. This
//   module ONLY returns a validated suggestion; it never touches the
//   database. The caller (tasks.ts) decides what to actually do with it.
// - The model never invents a bucket -- it may only pick from the caller's
//   own existing bucket names, or return null.
// - The model never resolves absolute dates itself (LLM date arithmetic is
//   unreliable). It returns a small integer day-offset from "today" (which
//   the caller supplies); the caller computes the real date deterministically.
// - Any missing API key, network failure, timeout, or malformed/invalid
//   response results in `null` -- the caller must have a deterministic
//   fallback. This must never throw and never block capture for long.
import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

const CaptureIntentSchema = z.object({
  cleanTitle: z
    .string()
    .describe("A short, actionable task title derived from the input. If the input is already a good title, return it unchanged."),
  bucketName: z
    .string()
    .nullable()
    .describe("Best-matching bucket name from the provided list of existing buckets, or null if none clearly fits."),
  importance: z.enum(["low", "medium", "high"]).nullable(),
  estimateMinutes: z
    .number()
    .int()
    .nullable()
    .describe("Only set if the user explicitly stated a duration (e.g. '30 min', '2 hours'). Otherwise null."),
  waitingOn: z
    .string()
    .nullable()
    .describe("Who or what this task is blocked on, only if the text clearly implies waiting on someone/something."),
  dateKind: z
    .enum(["none", "soft", "hard"])
    .describe(
      "'hard' only if the text explicitly uses deadline language (due, deadline, by <day>, has to be done by). " +
        "'soft' if it vaguely references a timeframe (this week, sometime soon, this weekend). 'none' if no timeframe at all."
    ),
  dateDaysFromNow: z
    .number()
    .int()
    .min(0)
    .max(365)
    .nullable()
    .describe("Integer days from the provided reference date this task refers to. Null if dateKind is 'none'."),
});

export type CaptureIntent = z.infer<typeof CaptureIntentSchema>;

// "Dump several things at once" support: the model decides whether the
// input describes one task or several (newlines, "and", commas joining
// distinct actions, or just back-to-back statements all count), and
// extracts the same per-field structure for each one in a single call.
// A plain one-task input still comes back as a single-element array, so
// this is a strict superset of the single-task schema above -- callers
// that only ever send one task at a time don't need to think about this.
const MultiCaptureSchema = z.object({
  items: z
    .array(CaptureIntentSchema)
    .min(1)
    .max(20)
    .describe("One entry per distinct task found in the input, in the order they were mentioned."),
});

export interface ParseCaptureContext {
  /** Reference "today" date (YYYY-MM-DD, in the user's own timezone) so the
   *  model's day-offset is computed relative to the right day. */
  todayISO: string;
  /** Weekday name for todayISO (e.g. "Tuesday"). Given explicitly so the
   *  model never has to derive day-of-week from a bare ISO date itself --
   *  that calculation is exactly the kind of silent LLM date-math error
   *  this design is meant to avoid (see "next Friday" bug, Phase 2 smoke test). */
  todayWeekday: string;
  /** This user's existing, non-archived bucket names. The model may only
   *  choose from this list (or null) -- never invent a new one. */
  bucketNames: string[];
}

const PARSE_TIMEOUT_MS = 6000;
// Splitting + extracting several items is a heavier call than a single
// item; give it more room before giving up and falling back.
const MULTI_PARSE_TIMEOUT_MS = 10000;

let cachedClient: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  cachedClient = apiKey ? new OpenAI({ apiKey }) : null;
  return cachedClient;
}

function buildSystemPrompt(context: ParseCaptureContext): string {
  return (
    "Be conservative: when unsure, prefer null over guessing. Never fabricate a deadline the user didn't imply. " +
    `Today's reference date is ${context.todayISO} (a ${context.todayWeekday}). ` +
    "When the text says \"next <weekday>\", treat it as the soonest upcoming occurrence of that weekday " +
    "strictly after today (if today itself is that weekday, use the one 7 days later, not today). " +
    `Existing buckets the user can be matched to (choose exactly one of these or null, never invent a new one): ${
      context.bucketNames.length > 0 ? context.bucketNames.join(", ") : "(none yet)"
    }.`
  );
}

/**
 * Attempts to parse free-form capture text into structured suggestions.
 * Returns null (never throws) if AI assistance is unavailable, disabled,
 * slow, or returns something that doesn't validate -- callers must always
 * have a deterministic fallback for the null case.
 */
export async function parseCaptureText(text: string, context: ParseCaptureContext): Promise<CaptureIntent | null> {
  const client = getClient();
  if (!client) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        // This is a structured-extraction task, not a creative one -- pin
        // temperature to 0 for consistent, repeatable field detection.
        // (Verified during Phase 2 smoke testing: at default temperature,
        // identical input to this exact prompt missed an explicit "next
        // friday" date reference in 3 of 4 back-to-back calls.)
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract structured task metadata from a single line of free-form text a user typed into a quick-capture box. " +
              buildSystemPrompt(context),
          },
          { role: "user", content: text },
        ],
        response_format: zodResponseFormat(CaptureIntentSchema, "capture_intent"),
      },
      { signal: controller.signal }
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    const result = CaptureIntentSchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;

    // Defense in depth: even though the model was told the valid bucket
    // list, double-check it didn't invent one anyway.
    if (result.data.bucketName && !context.bucketNames.includes(result.data.bucketName)) {
      return { ...result.data, bucketName: null };
    }

    return result.data;
  } catch {
    // Network error, timeout, invalid JSON, API error -- always degrade
    // to "no suggestion" rather than let a flaky external API break capture.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Like parseCaptureText, but the input may describe one task or several
 * ("call mom, pay rent, and email John" / a pasted multi-line list / a
 * stream-of-consciousness dump). Returns an array -- a plain one-task
 * input still comes back as a single-element array. Returns null (never
 * throws) under the exact same unavailable/slow/invalid conditions as
 * parseCaptureText; callers must have a deterministic fallback for that
 * case (see the quick-capture route's newline-based fallback).
 */
export async function parseMultiCaptureText(text: string, context: ParseCaptureContext): Promise<CaptureIntent[] | null> {
  const client = getClient();
  if (!client) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MULTI_PARSE_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "A user typed free-form text into a quick-capture box. It may describe ONE task, or SEVERAL distinct " +
              "tasks (separated by line breaks, numbering, \"and\"/commas joining separate actions, or just stated " +
              "back-to-back). Split it into one entry per distinct task, preserving the order mentioned, and extract " +
              "the same structured fields for each one independently -- each task's bucket/importance/date is its " +
              "own, don't let one task's details leak into another's. If it's really just one task, return a single " +
              "entry. Cap at 20 entries even if more are implied. " +
              buildSystemPrompt(context),
          },
          { role: "user", content: text },
        ],
        response_format: zodResponseFormat(MultiCaptureSchema, "multi_capture_intent"),
      },
      { signal: controller.signal }
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;

    const result = MultiCaptureSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.items.length === 0) return null;

    // Defense in depth, same as the single-task path.
    return result.data.items.map((item) =>
      item.bucketName && !context.bucketNames.includes(item.bucketName) ? { ...item, bucketName: null } : item
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
