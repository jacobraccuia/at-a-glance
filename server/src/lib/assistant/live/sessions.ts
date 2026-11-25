import { prisma } from "../../../db/client.js";
import { personalityById } from "../../../config/personalities.js";
import { getCurrentDateInTimeZone } from "../../timezone.js";
import { backendInstructions, liveInstructions } from "./prompts.js";
import { memoryPacket, saveMemories, type MemoryDraft } from "./memory.js";
import { LIVE_TOOLS, safetyId } from "./tools.js";
import { createResponse, liveKey } from "./openaiHttp.js";
import { LiveSideband, sidebandFor } from "./sideband.js";

const LIVE_URL = "https://api.openai.com/v1/live/sessions";
const BACKEND_MODEL = "gpt-6-luna";

async function prefsFor(userId: string) {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  return {
    timezone: prefs?.timezone ?? "UTC",
    personalityId: prefs?.personalityId ?? "puck",
  };
}

export async function conversationFor(userId: string, conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.assistantConversation.findFirst({
      where: { id: conversationId, userId, mode: "conversation" },
    });
    if (existing) return existing;
  }
  const prefs = await prefsFor(userId);
  return prisma.assistantConversation.create({
    data: { userId, mode: "conversation", personalityId: prefs.personalityId },
  });
}

function historyItems(rows: { role: string; content: string }[]) {
  return rows.slice(-6).map((row) => ({
    type: "message",
    role: row.role === "assistant" ? "assistant" : "user",
    content: [
      {
        type: row.role === "assistant" ? "output_text" : "input_text",
        text: row.content.slice(0, 500),
      },
    ],
  }));
}

export async function openLiveSession(userId: string, sdp: string, conversationId?: string) {
  const key = liveKey();
  if (!key) return { ok: false as const, status: 503, error: "live_unavailable" };
  const conversation = await conversationFor(userId, conversationId);
  const prefs = await prefsFor(userId);
  const personality = personalityById(prefs.personalityId);
  const packet = await memoryPacket(userId);
  const buckets = await prisma.bucket.findMany({ where: { userId, archivedAt: null } });
  const todayISO = getCurrentDateInTimeZone(prefs.timezone);
  const prior = await prisma.assistantMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 12,
  });
  const input = [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: packet || "No saved memory yet." }],
    },
    ...historyItems(prior),
  ];
  const res = await fetch(LIVE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        model: "gpt-live-1.1",
        instructions: liveInstructions(personality),
        audio: { output: { voice: personality.voice } },
        wake_policy: { type: "speech" },
        idle_timeout_s: 15,
        safety_identifier: safetyId(userId),
        input,
        delegation: {
          type: "responses",
          responses: {
            model: BACKEND_MODEL,
            instructions: backendInstructions({
              personality,
              todayISO,
              timezone: prefs.timezone,
              bucketNames: buckets.map((bucket) => bucket.name),
              memoryPacket: packet,
            }),
            tools: LIVE_TOOLS,
            tool_choice: "auto",
            parallel_tool_calls: false,
          },
        },
      },
      transport: { type: "webrtc", sdp },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("live session create failed", res.status, detail.slice(0, 400));
    return { ok: false as const, status: 502, error: "live_failed" };
  }
  const json = (await res.json()) as { session?: { id?: string }; transport?: { sdp?: string } };
  const providerSessionId = json.session?.id;
  const answer = json.transport?.sdp;
  if (!providerSessionId || !answer) return { ok: false as const, status: 502, error: "live_failed" };
  const row = await prisma.liveSession.create({
    data: {
      userId,
      conversationId: conversation.id,
      providerSessionId,
      personalityId: personality.id,
    },
  });
  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: { personalityId: personality.id, endedAt: null },
  });
  const band = new LiveSideband(providerSessionId, row.id, conversation.id, userId);
  band.attach(key);
  return {
    ok: true as const,
    sdp: answer,
    sessionId: providerSessionId,
    conversationId: conversation.id,
    personalityId: personality.id,
  };
}

export async function closeLiveSession(userId: string, providerSessionId: string) {
  const row = await prisma.liveSession.findFirst({ where: { providerSessionId, userId } });
  if (!row) return null;
  const band = sidebandFor(providerSessionId);
  if (band) await band.finish();
  await prisma.liveSession.update({
    where: { id: row.id },
    data: { status: "closed", closedAt: row.closedAt ?? new Date() },
  });
  await summarizeConversation(row.conversationId, userId);
  return row;
}

export async function summarizeConversation(conversationId: string, userId: string) {
  const messages = await prisma.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  if (messages.length === 0) return;
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 8000);
  let parsed: {
    title?: string;
    decisions?: string;
    unresolved?: string;
    commitments?: string;
    carryForward?: string;
    memories?: MemoryDraft[];
  } | null = null;
  try {
    const result = await createResponse({
      model: BACKEND_MODEL,
      instructions:
        "Summarize this personal conversation as JSON with keys title, decisions, unresolved, commitments, carryForward, memories. memories is an array of {kind, text, source}. kind is preference, responsibility, routine, interest, communication, goal, or pattern. source is stated or inferred. Do not store task completion as memory. Do not treat a passing mood as a trait. Return JSON only.",
      input: [{ role: "user", content: transcript }],
    });
    if (result?.outputText) {
      const start = result.outputText.indexOf("{");
      const end = result.outputText.lastIndexOf("}");
      if (start >= 0 && end > start) parsed = JSON.parse(result.outputText.slice(start, end + 1));
    }
  } catch (error) {
    console.error("conversation summary failed", error);
  }
  if (!parsed) return;
  const carry = [parsed.carryForward, parsed.unresolved].filter(Boolean).join(" ");
  await prisma.conversationSummary.upsert({
    where: { conversationId },
    create: {
      conversationId,
      decisions: parsed.decisions ?? "",
      unresolved: parsed.unresolved ?? "",
      commitments: parsed.commitments ?? "",
      carryForward: parsed.carryForward ?? "",
      modelId: BACKEND_MODEL,
    },
    update: {
      decisions: parsed.decisions ?? "",
      unresolved: parsed.unresolved ?? "",
      commitments: parsed.commitments ?? "",
      carryForward: parsed.carryForward ?? "",
      modelId: BACKEND_MODEL,
    },
  });
  await prisma.assistantConversation.update({
    where: { id: conversationId },
    data: {
      title: parsed.title?.slice(0, 120) || undefined,
      summary: carry.slice(0, 1000) || parsed.decisions?.slice(0, 1000) || undefined,
      endedAt: new Date(),
    },
  });
  if (Array.isArray(parsed.memories)) await saveMemories(userId, parsed.memories);
}

export async function textTurn(userId: string, text: string, conversationId?: string) {
  const conversation = await conversationFor(userId, conversationId);
  await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: "user", content: text, channel: "text" },
  });
  const prefs = await prefsFor(userId);
  const personality = personalityById(prefs.personalityId);
  const packet = await memoryPacket(userId);
  const buckets = await prisma.bucket.findMany({ where: { userId, archivedAt: null } });
  const todayISO = getCurrentDateInTimeZone(prefs.timezone);
  if (!liveKey()) {
    const message = await prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        channel: "text",
        content: "I can't reach the assistant right now. Nothing was added.",
      },
    });
    return { conversationId: conversation.id, message, tasksChanged: false };
  }
  const history = await prisma.assistantMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 12,
  });
  let responseId = "";
  let tasksChanged = false;
  let spoken = "";
  try {
    let result = await createResponse({
      model: BACKEND_MODEL,
      instructions: backendInstructions({
        personality,
        todayISO,
        timezone: prefs.timezone,
        bucketNames: buckets.map((bucket) => bucket.name),
        memoryPacket: packet,
      }),
      tools: LIVE_TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
      input: history.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
    });
    for (let round = 0; round < 4 && result; round++) {
      responseId = result.id;
      if (result.calls.length === 0) {
        spoken = result.outputText;
        break;
      }
      const outputs = [];
      for (const call of result.calls) {
        const outcome = await executeToolForText(userId, conversation.id, call.name, call.arguments);
        if (outcome.changed) tasksChanged = true;
        outputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify(outcome),
        });
      }
      spoken = result.outputText || spoken;
      result = await createResponse({
        model: BACKEND_MODEL,
        previous_response_id: responseId,
        input: outputs,
      });
      if (result?.outputText) spoken = result.outputText;
      if (!result || result.calls.length === 0) break;
    }
  } catch (error) {
    console.error("live text turn failed", error);
    spoken = "I couldn't finish that. Nothing was changed unless I already said it was.";
  }
  if (!spoken) spoken = "Okay.";
  const message = await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: "assistant", channel: "text", content: spoken },
  });
  await prisma.assistantConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date(), personalityId: personality.id },
  });
  return { conversationId: conversation.id, message, tasksChanged };
}

async function executeToolForText(userId: string, conversationId: string, name: string, args: string) {
  const { executeTool, noteToolResult } = await import("./tools.js");
  const outcome = await executeTool(userId, name, args);
  if (outcome.changed) await noteToolResult(conversationId, outcome);
  return outcome;
}
