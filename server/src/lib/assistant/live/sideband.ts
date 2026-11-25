import { WebSocket } from "ws";
import { prisma } from "../../../db/client.js";
import { estimateLiveUsd } from "./pricing.js";
import {
  flushRemainder,
  freshLiveState,
  reduceLiveEvent,
  type LiveReduceState,
  type LiveUsageSnapshot,
} from "./events.js";
import {
  MAX_MUTATIONS_PER_DELEGATION,
  cachedToolResult,
  executeTool,
  isMutatingTool,
  noteToolResult,
  rememberToolResult,
} from "./tools.js";

const bands = new Map<string, LiveSideband>();

export function sidebandFor(providerSessionId: string): LiveSideband | undefined {
  return bands.get(providerSessionId);
}

export class LiveSideband {
  private ws: WebSocket | null = null;
  private state: LiveReduceState = freshLiveState();
  private mutations = new Map<string, number>();
  private usage: LiveUsageSnapshot = { seconds: 0, activeSeconds: 0, pausedSeconds: 0 };
  private inputTokens = 0;
  private outputTokens = 0;
  private closed = false;
  private closeWait: (() => void) | null = null;

  constructor(
    private readonly providerSessionId: string,
    private readonly liveSessionId: string,
    private readonly conversationId: string,
    private readonly userId: string
  ) {}

  attach(apiKey: string) {
    const url = `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(this.providerSessionId)}/attach`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    this.ws = ws;
    bands.set(this.providerSessionId, this);
    ws.on("message", (data) => {
      void this.onMessage(String(data));
    });
    ws.on("close", () => {
      void this.persistUsage(false);
      this.closed = true;
      this.closeWait?.();
      bands.delete(this.providerSessionId);
    });
    ws.on("error", (error) => {
      console.error("live sideband error", error);
    });
  }

  private send(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private async onMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const effects = reduceLiveEvent(this.state, parsed);
    for (const effect of effects) {
      if (effect.type === "flush") {
        await prisma.assistantMessage.create({
          data: {
            conversationId: this.conversationId,
            role: effect.role,
            content: effect.text,
            channel: "voice",
          },
        });
        await prisma.assistantConversation.update({
          where: { id: this.conversationId },
          data: { updatedAt: new Date() },
        });
      } else if (effect.type === "tool") {
        await this.runTool(effect.delegationId, effect.callId, effect.name, effect.arguments);
      } else if (effect.type === "continue") {
        this.send({ type: "response.create", event_id: `cont-${Date.now()}` });
      } else if (effect.type === "usage") {
        this.usage = effect.usage;
        await this.persistUsage(false);
      } else if (effect.type === "tokens") {
        this.inputTokens += effect.input;
        this.outputTokens += effect.output;
        await this.persistUsage(false);
      } else if (effect.type === "closed") {
        if (effect.usage) this.usage = effect.usage;
        await this.persistUsage(true);
        this.closed = true;
        this.closeWait?.();
      }
    }
  }

  private async runTool(delegationId: string | null, callId: string, name: string, args: string) {
    const key = delegationId ?? "session";
    let outcomeJson = cachedToolResult(callId);
    if (!outcomeJson) {
      const used = this.mutations.get(key) ?? 0;
      if (isMutatingTool(name) && used >= MAX_MUTATIONS_PER_DELEGATION) {
        outcomeJson = JSON.stringify({
          ok: false,
          changed: false,
          summary: "That's enough changes for this moment.",
        });
      } else {
        const outcome = await executeTool(this.userId, name, args);
        if (outcome.changed) {
          this.mutations.set(key, used + 1);
          await prisma.liveSession.update({
            where: { id: this.liveSessionId },
            data: { changeSeq: { increment: 1 } },
          });
          await noteToolResult(this.conversationId, outcome);
        }
        outcomeJson = JSON.stringify(outcome);
      }
      rememberToolResult(callId, outcomeJson);
    }
    this.send({
      type: "response.item.create",
      event_id: `tool-${callId}`,
      item: { type: "function_call_output", call_id: callId, output: outcomeJson },
    });
  }

  private async persistUsage(finalized: boolean) {
    const estimatedUsd = estimateLiveUsd({
      ...this.usage,
      backendInputTokens: this.inputTokens,
      backendOutputTokens: this.outputTokens,
    });
    await prisma.liveUsage.upsert({
      where: { liveSessionId: this.liveSessionId },
      create: {
        liveSessionId: this.liveSessionId,
        userId: this.userId,
        seconds: this.usage.seconds,
        activeSeconds: this.usage.activeSeconds,
        pausedSeconds: this.usage.pausedSeconds,
        backendInputTokens: this.inputTokens,
        backendOutputTokens: this.outputTokens,
        estimatedUsd,
        finalized,
      },
      update: {
        seconds: this.usage.seconds,
        activeSeconds: this.usage.activeSeconds,
        pausedSeconds: this.usage.pausedSeconds,
        backendInputTokens: this.inputTokens,
        backendOutputTokens: this.outputTokens,
        estimatedUsd,
        finalized,
      },
    });
    if (finalized) {
      await prisma.liveSession.update({
        where: { id: this.liveSessionId },
        data: { status: "closed", closedAt: new Date() },
      });
    }
  }

  async finish(): Promise<void> {
    if (this.closed || !this.ws) {
      await this.flushTail();
      return;
    }
    const done = new Promise<void>((resolve) => {
      this.closeWait = resolve;
      setTimeout(resolve, 3000);
    });
    this.send({ type: "session.close", event_id: "close-session" });
    await done;
    await this.flushTail();
    this.ws.close();
    bands.delete(this.providerSessionId);
  }

  private async flushTail() {
    for (const effect of flushRemainder(this.state)) {
      if (effect.type !== "flush") continue;
      await prisma.assistantMessage.create({
        data: {
          conversationId: this.conversationId,
          role: effect.role,
          content: effect.text,
          channel: "voice",
        },
      });
    }
  }
}
