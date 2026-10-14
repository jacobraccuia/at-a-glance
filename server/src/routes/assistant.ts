import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { logTaskEvent } from "../lib/taskEvents.js";
import {
  getCurrentDateInTimeZone,
  getUpcomingWeekdayOffsets,
  getWeekdayName,
} from "../lib/timezone.js";
import { parseConversationMessage } from "../lib/assistant/conversationParser.js";
import { executeAssistantPlan, fallbackPlanFromText } from "../lib/assistant/executor.js";
import { DEFAULT_EASY_WIN_MINUTES, rankEasyWins } from "../lib/assistant/easyWins.js";
import { synthesizeSpeech } from "../lib/assistant/tts.js";

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

async function getUserTimezone(userId: string): Promise<string> {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  return prefs?.timezone ?? "UTC";
}

async function getOrCreateConversation(userId: string, conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.assistantConversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (existing) return existing;
  }
  return prisma.assistantConversation.create({ data: { userId } });
}

// ---------- Get / create the latest conversation + messages ----------

assistantRouter.get("/conversation", async (req, res) => {
  const userId = req.session.userId!;
  let conversation = await prisma.assistantConversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
  });
  if (!conversation) {
    conversation = await prisma.assistantConversation.create({
      data: { userId },
      include: { messages: true },
    });
  }
  res.json(conversation);
});

assistantRouter.post("/conversation/new", async (req, res) => {
  const userId = req.session.userId!;
  const conversation = await prisma.assistantConversation.create({
    data: { userId },
    include: { messages: true },
  });
  res.status(201).json(conversation);
});

// ---------- Send a message ----------

const messageSchema = z.object({
  text: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

assistantRouter.post("/message", async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.session.userId!;
  const text = parsed.data.text.trim();
  const conversation = await getOrCreateConversation(userId, parsed.data.conversationId);

  // Persist the user turn first so history is durable even if AI fails mid-way.
  await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: "user", content: text },
  });

  const tz = await getUserTimezone(userId);
  const todayISO = getCurrentDateInTimeZone(tz);
  const buckets = await prisma.bucket.findMany({ where: { userId, archivedAt: null } });
  const openTasks = await prisma.task.findMany({
    where: { userId, status: { in: ["captured", "active", "completed"] } },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  const historyRows = await prisma.assistantMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 16,
  });
  // Exclude the user message we just wrote -- it's passed separately.
  const history = historyRows.slice(0, -1).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const plan =
    (await parseConversationMessage(text, {
      todayISO,
      todayWeekday: getWeekdayName(todayISO),
      upcomingWeekdayOffsets: getUpcomingWeekdayOffsets(todayISO),
      bucketNames: buckets.map((b) => b.name),
      tasks: openTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        attentionDate: t.attentionDate?.toISOString() ?? null,
        hardDeadline: t.hardDeadline?.toISOString() ?? null,
        importance: t.importance,
        estimateMinutes: t.estimateMinutes,
        waitingOn: t.waitingOn,
      })),
      history,
    })) ?? fallbackPlanFromText(text);

  const result = await executeAssistantPlan(plan, {
    prisma,
    userId,
    todayISO,
    tz,
    buckets,
    // Spoken / typed creates with no date clues land on Today.
    addToTodayDefault: true,
  });

  const assistantMsg = await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: result.reply,
      actions: result.executed as object[],
    },
  });

  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  res.status(201).json({
    conversationId: conversation.id,
    message: assistantMsg,
    executed: result.executed,
  });
});

// ---------- Text-to-speech for Talk sheet replies ----------

const speakSchema = z.object({
  text: z.string().min(1).max(2000),
});

assistantRouter.post("/speak", async (req, res) => {
  const parsed = speakSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const audio = await synthesizeSpeech(parsed.data.text);
    if (!audio) {
      // No OPENAI_API_KEY — client falls back to browser speechSynthesis.
      return res.status(503).json({ error: "tts_unavailable" });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(audio);
  } catch (e) {
    console.error("TTS failed", e);
    return res.status(502).json({ error: "tts_failed" });
  }
});

// ---------- Easy Wins (also used by the home strip without a chat turn) ----------

assistantRouter.get("/easy-wins", async (req, res) => {
  const userId = req.session.userId!;
  const raw = typeof req.query.minutes === "string" ? parseInt(req.query.minutes, 10) : DEFAULT_EASY_WIN_MINUTES;
  const minutes = Number.isFinite(raw) ? Math.max(1, Math.min(240, raw)) : DEFAULT_EASY_WIN_MINUTES;
  const openTasks = await prisma.task.findMany({
    where: { userId, status: { in: ["captured", "active"] } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  res.json({ minutes, wins: rankEasyWins(openTasks, minutes) });
});

// ---------- One-tap undo of the last consequential action ----------

const undoSchema = z.object({
  kind: z.enum(["complete", "drop", "snooze", "reopen"]),
  taskId: z.string().uuid(),
});

assistantRouter.post("/undo", async (req, res) => {
  const parsed = undoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.session.userId!;
  const { kind, taskId } = parsed.data;
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  let updated;
  if (kind === "complete") {
    updated = await prisma.task.update({
      where: { id: taskId },
      data: { status: "active", completedAt: null },
    });
    await logTaskEvent(prisma, { taskId, userId, type: "uncompleted", payload: { via: "assistant-undo" } });
  } else if (kind === "drop") {
    updated = await prisma.task.update({
      where: { id: taskId },
      data: { status: "active", droppedAt: null },
    });
    await logTaskEvent(prisma, { taskId, userId, type: "reopened", payload: { via: "assistant-undo" } });
  } else if (kind === "snooze") {
    updated = await prisma.task.update({
      where: { id: taskId },
      data: { snoozedUntil: null },
    });
    await logTaskEvent(prisma, { taskId, userId, type: "updated", payload: { via: "assistant-undo", snoozedUntil: null } });
  } else {
    // undo reopen -> put it back to completed (best-effort)
    updated = await prisma.task.update({
      where: { id: taskId },
      data: { status: "completed", completedAt: new Date() },
    });
    await logTaskEvent(prisma, { taskId, userId, type: "completed", payload: { via: "assistant-undo" } });
  }

  res.json({ ok: true, task: updated });
});
