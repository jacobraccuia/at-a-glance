import { prisma } from "../../../db/client.js";

const KINDS = new Set(["preference", "responsibility", "routine", "interest", "communication", "goal", "pattern"]);

export interface MemoryDraft {
  kind: string;
  text: string;
  source: string;
}

export function acceptMemory(row: MemoryDraft): boolean {
  if (!KINDS.has(row.kind)) return false;
  if (row.source !== "stated" && row.source !== "inferred") return false;
  const text = row.text.trim();
  if (text.length < 3 || text.length > 280) return false;
  if (/\b(completed|marked done|dropped|task is|tasks are)\b/i.test(text)) return false;
  if (
    row.kind === "pattern" &&
    row.source === "inferred" &&
    /\b(today|right now|this morning|overwhelmed|anxious|tired|stressed)\b/i.test(text)
  ) {
    return false;
  }
  return true;
}

export async function memoryPacket(userId: string): Promise<string> {
  const memories = await prisma.personalMemory.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
    take: 24,
  });
  const stated = memories.filter((row) => row.source === "stated").slice(0, 12);
  const inferred = memories.filter((row) => row.source === "inferred").slice(0, 6);
  const latest = await prisma.assistantConversation.findFirst({
    where: { userId, mode: "conversation", summary: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  const lines = [
    stated.length ? `Stated:\n${stated.map((row) => `- ${row.text}`).join("\n")}` : "",
    inferred.length ? `Inferred, not facts:\n${inferred.map((row) => `- ${row.text}`).join("\n")}` : "",
    latest?.summary ? `Last conversation:\n${latest.summary}` : "",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1500);
}

export async function saveMemories(userId: string, drafts: MemoryDraft[]) {
  for (const draft of drafts) {
    if (!acceptMemory(draft)) continue;
    const text = draft.text.trim();
    const existing = await prisma.personalMemory.findFirst({
      where: { userId, text, status: "active" },
    });
    if (existing) continue;
    await prisma.personalMemory.create({
      data: { userId, kind: draft.kind, text, source: draft.source, status: "active" },
    });
  }
}
