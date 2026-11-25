import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { PERSONALITIES, personalityById } from "../config/personalities.js";
import { MONTHLY_BUDGET_USD } from "../lib/assistant/live/pricing.js";
import { acceptMemory } from "../lib/assistant/live/memory.js";
import { liveKey } from "../lib/assistant/live/openaiHttp.js";
import { closeLiveSession, conversationFor, openLiveSession, textTurn } from "../lib/assistant/live/sessions.js";

export const liveRouter = Router();

const sessionSchema = z.object({
  sdp: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});

liveRouter.get("/live/ready", (_req, res) => {
  res.json({ ready: Boolean(liveKey()) });
});

liveRouter.post("/live/sessions", async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await openLiveSession(req.session.userId!, parsed.data.sdp, parsed.data.conversationId);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({
      sdp: result.sdp,
      sessionId: result.sessionId,
      conversationId: result.conversationId,
      personalityId: result.personalityId,
    });
  } catch (error) {
    console.error("open live session", error);
    res.status(502).json({ error: "live_failed" });
  }
});

liveRouter.get("/live/sessions/:id", async (req, res) => {
  const row = await prisma.liveSession.findFirst({
    where: { providerSessionId: req.params.id, userId: req.session.userId! },
  });
  if (!row) return res.status(404).json({ error: "Session not found" });
  res.json({
    sessionId: row.providerSessionId,
    conversationId: row.conversationId,
    changeSeq: row.changeSeq,
    status: row.status,
    personalityId: row.personalityId,
  });
});

liveRouter.delete("/live/sessions/:id", async (req, res) => {
  const row = await closeLiveSession(req.session.userId!, req.params.id);
  if (!row) return res.status(404).json({ error: "Session not found" });
  res.status(204).end();
});

liveRouter.get("/live/conversation", async (req, res) => {
  const userId = req.session.userId!;
  let conversation = await prisma.assistantConversation.findFirst({
    where: { userId, mode: "conversation" },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 100 },
      summaryRow: true,
    },
  });
  if (!conversation) {
    const created = await conversationFor(userId);
    conversation = await prisma.assistantConversation.findUniqueOrThrow({
      where: { id: created.id },
      include: { messages: true, summaryRow: true },
    });
  }
  res.json(conversation);
});

liveRouter.post("/live/conversation", async (req, res) => {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId: req.session.userId! } });
  const conversation = await prisma.assistantConversation.create({
    data: {
      userId: req.session.userId!,
      mode: "conversation",
      personalityId: prefs?.personalityId ?? "puck",
    },
    include: { messages: true, summaryRow: true },
  });
  res.status(201).json(conversation);
});

const textSchema = z.object({
  text: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
});

liveRouter.post("/live/text", async (req, res) => {
  const parsed = textSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await textTurn(req.session.userId!, parsed.data.text.trim(), parsed.data.conversationId);
  res.status(201).json(result);
});

liveRouter.get("/live/usage", async (req, res) => {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.liveUsage.findMany({
    where: { userId: req.session.userId!, createdAt: { gte: start } },
  });
  const estimatedUsd = Math.round(rows.reduce((sum, row) => sum + row.estimatedUsd, 0) * 100) / 100;
  const seconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  res.json({
    estimatedUsd,
    seconds,
    budgetUsd: MONTHLY_BUDGET_USD,
    warning: estimatedUsd >= MONTHLY_BUDGET_USD,
  });
});

liveRouter.get("/personalities", (_req, res) => {
  res.json(
    PERSONALITIES.map((personality) => ({
      id: personality.id,
      name: personality.name,
      description: personality.description,
      voice: personality.voice,
    }))
  );
});

const personalitySchema = z.object({ id: z.string().min(1) });
const focusSchema = z.object({ focus: z.enum(["task", "both", "chat"]) });

liveRouter.patch("/focus", async (req, res) => {
  const parsed = focusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.session.userId!;
  const prefs = await prisma.userPreferences.upsert({
    where: { userId },
    update: { assistantFocus: parsed.data.focus },
    create: { userId, assistantFocus: parsed.data.focus },
  });
  res.json({ assistantFocus: prefs.assistantFocus });
});

liveRouter.patch("/personality", async (req, res) => {
  const parsed = personalitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const personality = personalityById(parsed.data.id);
  if (personality.id !== parsed.data.id) return res.status(400).json({ error: "Unknown personality" });
  const userId = req.session.userId!;
  const prefs = await prisma.userPreferences.upsert({
    where: { userId },
    update: { personalityId: personality.id },
    create: { userId, personalityId: personality.id },
  });
  const latest = await prisma.assistantConversation.findFirst({
    where: { userId, mode: "conversation" },
    orderBy: { updatedAt: "desc" },
  });
  if (latest && latest.personalityId !== personality.id) {
    await prisma.assistantConversation.update({
      where: { id: latest.id },
      data: { personalityId: personality.id },
    });
  }
  res.json({ personalityId: prefs.personalityId });
});

liveRouter.get("/memory", async (req, res) => {
  const rows = await prisma.personalMemory.findMany({
    where: { userId: req.session.userId!, status: { not: "rejected" } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

const memorySchema = z.object({
  kind: z.string(),
  text: z.string().min(1).max(280),
  source: z.enum(["stated", "inferred"]).default("stated"),
});

liveRouter.post("/memory", async (req, res) => {
  const parsed = memorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!acceptMemory(parsed.data)) return res.status(400).json({ error: "That memory was rejected" });
  const row = await prisma.personalMemory.create({
    data: { userId: req.session.userId!, ...parsed.data, status: "active" },
  });
  res.status(201).json(row);
});

liveRouter.patch("/memory/:id", async (req, res) => {
  const parsed = memorySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.personalMemory.findFirst({
    where: { id: req.params.id, userId: req.session.userId! },
  });
  if (!existing) return res.status(404).json({ error: "Memory not found" });
  const next = {
    kind: parsed.data.kind ?? existing.kind,
    text: parsed.data.text ?? existing.text,
    source: parsed.data.source ?? existing.source,
  };
  if (!acceptMemory(next)) return res.status(400).json({ error: "That memory was rejected" });
  const row = await prisma.personalMemory.update({ where: { id: existing.id }, data: next });
  res.json(row);
});

liveRouter.delete("/memory", async (req, res) => {
  await prisma.personalMemory.deleteMany({ where: { userId: req.session.userId! } });
  res.status(204).end();
});

liveRouter.delete("/memory/:id", async (req, res) => {
  const existing = await prisma.personalMemory.findFirst({
    where: { id: req.params.id, userId: req.session.userId! },
  });
  if (!existing) return res.status(404).json({ error: "Memory not found" });
  await prisma.personalMemory.delete({ where: { id: existing.id } });
  res.status(204).end();
});
