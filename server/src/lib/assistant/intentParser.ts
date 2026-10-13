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

let cachedClient: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  cachedClient = apiKey ? new OpenAI({ apiKey }) : null;
  return cachedClient;
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
              "Be conservative: when unsure, prefer null over guessing. Never fabricate a deadline the user didn't imply. " +
              `Today's reference date is ${context.todayISO} (a ${context.todayWeekday}). ` +
              "When the text says \"next <weekday>\", treat it as the soonest upcoming occurrence of that weekday " +
              "strictly after today (if today itself is that weekday, use the one 7 days later, not today). " +
              `Existing buckets the user can be matched to (choose exactly one of these or null, never invent a new one): ${
                context.bucketNames.length > 0 ? context.bucketNames.join(", ") : "(none yet)"
              }.`,
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
